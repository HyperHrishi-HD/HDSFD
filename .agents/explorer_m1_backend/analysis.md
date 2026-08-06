# Analysis & Design Report: Stateless Backend & Google Drive Backup

## 1. Codebase Investigation Summary

### 1.1 SQLite Database Initialization & Access
* **File Location**: `backend/app.py`
* **Current Access Model**: 
  - Database connections are retrieved on-demand via `get_db_connection()` (lines 14-18) using `sqlite3.connect(DB_PATH)`.
  - Row factory is set to `sqlite3.Row` to allow column-name-based lookups.
  - Databases are initialized via `init_db()` (lines 19-48), creating tables `users`, `data`, and `ephemeral_chat` if they do not exist.
  - Connections are opened, processed, committed (on write), and explicitly closed within each Flask route.
* **Limitations**:
  - The database is not currently configured for high-concurrency. There is no WAL mode or query optimization enabled.
  - Concurrent writes from multiple clients or asynchronous tasks will block each other, potentially causing SQLite "database is locked" errors.

### 1.2 Frontend Backup Trigger
* **File Location**: `src/main.js` (lines 2386-2418) and `index.html` (lines 653-667)
* **Trigger Mechanism**:
  - The frontend features a "Dropbox Synchronization Gateway" inside the Settings tab, composed of:
    - An input field `#dropbox-token-input` where the user inputs their Dropbox access token.
    - A button `#backup-db-btn` with a click listener calling `triggerBackup()`.
    - A status text paragraph `#backup-status-msg`.
  - The `triggerBackup()` function sends a `POST` request to `${API_URL}/settings/backup` containing the JSON payload:
    ```json
    { "username": "username", "dropbox_token": "token" }
    ```
  - On success, it displays the success message returned from the backend in green. If there is an error, it displays it in red.

---

## 2. SQLite Performance Optimization (WAL & Sync Settings)

To prepare HDSFD V2 for concurrent user sessions and background backup operations, we must configure the SQLite connection for optimal throughput and safety.

### Recommended Pragmas
Immediately after establishing any SQLite connection inside `get_db_connection()`, we should execute:
1. **`PRAGMA journal_mode=WAL;` (Write-Ahead Logging)**:
   - Replaces the default rollback journal with a Write-Ahead Log.
   - Allows reader connections to query the database concurrently without blocking or being blocked by writer connections.
2. **`PRAGMA synchronous=NORMAL;`**:
   - Reduces synchronization operations. In WAL mode, `NORMAL` is fully crash-safe because writes are synced to the WAL file rather than the main database file on every commit. This dramatically improves write performance.
3. **`PRAGMA busy_timeout=5000;`**:
   - Tells SQLite to wait for up to 5000ms (5 seconds) before throwing a "database is locked" exception if another thread/process is writing. This handles lock contention gracefully.

---

## 3. Dependencies & requirements.txt
To implement the Google Drive OAuth2 flow and API integration, the following libraries are required:
* **`google-auth`**: Provides the base authentication classes.
* **`google-auth-oauthlib`**: Offers integration helpers for the standard OAuth 2.0 flow.
* **`google-api-python-client`**: The official client library to interact with Google API services, including the Drive API.
* **`cryptography`**: Required to encrypt/decrypt Google OAuth tokens at rest in the SQLite database.

### Proposed Additions to `requirements.txt`:
```text
google-auth>=2.29.0
google-auth-oauthlib>=1.2.0
google-api-python-client>=2.125.0
cryptography>=42.0.0
```

---

## 4. Google Drive OAuth2 Flow & Secure Storage Design

Because the Flask backend is stateless, we will store the user's OAuth tokens securely in SQLite and use a signed parameter to securely transmit context across the OAuth redirect lifecycle.

### 4.1 Schema for Token Storage
We will create a table `gdrive_credentials` in SQLite:
```sql
CREATE TABLE IF NOT EXISTS gdrive_credentials (
    username TEXT PRIMARY KEY,
    credentials_json TEXT NOT NULL,  -- Encrypted credentials JSON
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users (username)
);
```

### 4.2 Secure Encryption at Rest
To protect user OAuth tokens (which include long-lived `refresh_token` credentials), we must encrypt the credentials JSON string before storing it in SQLite:
* **Secret Key**: Loaded from an environment variable `ENCRYPTION_KEY`. A 32-byte urlsafe base64 key is generated using `cryptography.fernet.Fernet.generate_key()`.
* **Encryption Layer**: Before inserting/updating in the database, credentials are encrypted using `Fernet`. When loaded, they are decrypted.

### 4.3 Endpoint Designs
#### 1. Auth Endpoint: `GET /api/gdrive/auth`
* **Query Parameters**: `username`
* **Flow**:
  1. Generate a secure, tamper-proof state token by signing the `username` using Flask's `SECRET_KEY` or a signature key:
     ```python
     import hmac, hashlib, base64, json
     # Construct state containing username and hash signature
     state_data = {"username": username}
     state_str = base64.urlsafe_b64encode(json.dumps(state_data).encode()).decode()
     ```
  2. Initialize the Google OAuth flow:
     ```python
     from google_auth_oauthlib.flow import Flow
     # Client configuration loaded from environment variables
     client_config = json.loads(os.environ.get('GOOGLE_CLIENT_SECRETS_JSON'))
     flow = Flow.from_client_config(
         client_config,
         scopes=[
             'https://www.googleapis.com/auth/drive.file',
             'https://www.googleapis.com/auth/userinfo.email'
         ]
     )
     flow.redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'
     ```
  3. Generate the authorization URL:
     ```python
     auth_url, _ = flow.authorization_url(
         access_type='offline',
         include_granted_scopes='true',
         state=state_str,
         prompt='consent'
     )
     ```
  4. Redirect the user (or return a JSON redirect URL if initiated via API).

#### 2. Redirect Endpoint: `GET /api/gdrive/callback`
* **Query Parameters**: `code`, `state`
* **Flow**:
  1. Base64 decode and verify the signature of the `state` parameter to extract the authenticated `username`.
  2. Rebuild the `Flow` object and fetch the credentials:
     ```python
     flow.fetch_token(authorization_response=request.url)
     creds = flow.credentials
     ```
  3. Retrieve user profile information using the `userinfo` service to get the linked email address (optional, for UI rendering).
  4. Encrypt the credentials JSON string:
     ```python
     encrypted_json = encrypt_credentials(creds.to_json())
     ```
  5. Store the encrypted credentials in `gdrive_credentials` table:
     ```sql
     INSERT INTO gdrive_credentials (username, credentials_json) 
     VALUES (?, ?) 
     ON CONFLICT(username) DO UPDATE SET credentials_json=excluded.credentials_json, updated_at=CURRENT_TIMESTAMP;
     ```
  6. Return a success HTML page that post-messages the parent tab and closes itself:
     ```html
     <script>
       if (window.opener) {
         window.opener.postMessage({ type: 'gdrive_linked', username: 'username' }, '*');
       }
       window.close();
     </script>
     ```

#### 3. Status Endpoint: `GET /api/gdrive/status`
* **Query Parameters**: `username`
* **Flow**:
  1. Query `gdrive_credentials` to see if a token exists for the user.
  2. Return JSON indicating connection status:
     ```json
     { "linked": true, "email": "user@gmail.com" }
     ```

#### 4. Refactored Backup Endpoint: `POST /api/settings/backup`
* **JSON Payload**: `{ "username": "username" }`
* **Flow**:
  1. Retrieve encrypted credentials for the user from `gdrive_credentials`.
  2. Decrypt the JSON string and load it into a `google.oauth2.credentials.Credentials` object.
  3. If expired, automatically refresh it:
     ```python
     from google.auth.transport.requests import Request
     if creds.expired and creds.refresh_token:
         creds.refresh(Request())
         # Save refreshed credentials
         update_credentials(username, creds.to_json())
     ```
  4. Execute the SQLite hot backup (see Section 5).
  5. Upload the compressed snapshot to Google Drive.
  6. Clean up temporary local files.
  7. Return a success JSON payload.

---

## 5. Hot Backup & Streaming Design

Because we are in WAL mode, we must not use direct file copying (`shutil.copyfile`), as it can result in corrupted backups. Instead, we use the SQLite online backup API to copy pages safely.

### Step-by-Step Hot Backup Protocol:
1. **Initialize Backup File**:
   Generate a unique filename: `backup_<username>_<timestamp>.db`
   Create a temporary directory for local output.
2. **Execute Online Backup**:
   Use `sqlite3.Connection.backup()` to transfer the live DB content into a new temporary file:
   ```python
   src_conn = sqlite3.connect(DB_PATH)
   dst_conn = sqlite3.connect(temp_backup_path)
   with src_conn:
       src_conn.backup(dst_conn)
   dst_conn.close()
   src_conn.close()
   ```
3. **Compress**:
   Compress the database backup using gzip:
   ```python
   import gzip
   compressed_backup_path = temp_backup_path + '.gz'
   with open(temp_backup_path, 'rb') as f_in:
       with gzip.open(compressed_backup_path, 'wb') as f_out:
           f_out.writelines(f_in)
   os.remove(temp_backup_path) # delete uncompressed copy immediately
   ```
4. **Google Drive Folder Check & Create**:
   Initialize the Drive service: `service = build('drive', 'v3', credentials=creds)`
   Query Drive for a folder named `HDSFD_Backups`:
   ```python
   query = "name = 'HDSFD_Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
   results = service.files().list(q=query, fields="files(id)").execute()
   folders = results.get('files', [])
   if folders:
       folder_id = folders[0]['id']
   else:
       # Create folder
       folder_metadata = {
           'name': 'HDSFD_Backups',
           'mimeType': 'application/vnd.google-apps.folder'
       }
       folder = service.files().create(body=folder_metadata, fields='id').execute()
       folder_id = folder.get('id')
   ```
5. **Stream to Google Drive**:
   Upload using the media uploader:
   ```python
   from googleapiclient.http import MediaFileUpload
   
   media = MediaFileUpload(compressed_backup_path, mimetype='application/gzip', resumable=True)
   file_metadata = {
       'name': f"backup_{username}_{timestamp}.db.gz",
       'parents': [folder_id]
   }
   file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
   ```
6. **Local Clean Up**:
   Delete the temporary compressed backup file: `os.remove(compressed_backup_path)`
   This keeps the backend completely stateless between requests.

---

## 6. Step-by-Step Implementation Plan for the Worker

### Step 1: Install Dependencies & Update Requirements
1. Run `pip install google-auth google-auth-oauthlib google-api-python-client cryptography`.
2. Append these libraries with recommended versions to `requirements.txt`.

### Step 2: Configure SQLite Connection settings
1. Modify `get_db_connection()` in `backend/app.py`:
   - Execute `conn.execute("PRAGMA journal_mode=WAL;")`
   - Execute `conn.execute("PRAGMA synchronous=NORMAL;")`
   - Execute `conn.execute("PRAGMA busy_timeout=5000;")`
2. Add table creation for `gdrive_credentials` within `init_db()` in `backend/app.py`.

### Step 3: Implement Encryption Helpers
1. Add helper functions in `backend/app.py` utilizing `cryptography.fernet.Fernet` to handle encryption and decryption of tokens using an `ENCRYPTION_KEY` environment variable. Add a fallback key/warning for local development.

### Step 4: Implement Google OAuth Endpoints
1. Implement `/api/gdrive/auth` route:
   - Handle `username` input.
   - Generate secure, signed state string.
   - Construct Flow, generate authorization URL, and redirect.
2. Implement `/api/gdrive/callback` route:
   - Receive authorization code and state.
   - Decode/verify state to confirm `username`.
   - Perform code exchange, fetch tokens, encrypt them, and save them to `gdrive_credentials`.
   - Render redirect-success HTML targeting the parent window.
3. Implement `/api/gdrive/status` route:
   - Query DB and check link status for UI.

### Step 5: Refactor /api/settings/backup Route
1. Replace legacy Dropbox logic in `settings_backup()` in `backend/app.py`.
2. Retrieve and decrypt the user's Google Drive credentials.
3. Initialize the Google API client, refreshing the token if expired.
4. Execute `sqlite3.Connection.backup()`, gzip compress the backup, locate/create `HDSFD_Backups` folder in Google Drive, stream upload it, and clean up local temporary files.

### Step 6: Update UI Template (index.html)
1. Replace the legacy "Dropbox Synchronization Gateway" HTML card (lines 653-667 in `index.html`) with a "Google Drive Synchronization Gateway".
2. Create:
   - Status indicators showing connection state (e.g. "Linked as ..." or "Not Linked").
   - A button pointing to `/api/gdrive/auth` flow (e.g. "Link Google Drive").
   - A button to trigger the backup (e.g., "Backup Now").
   - Status text area for success/error messages.

### Step 7: Update UI Controller (src/main.js)
1. Add check for Google Drive link status on dashboard login (`executeLogin` / settings load).
2. Attach listeners:
   - "Link Google Drive" opens a popup window pointing to `/api/gdrive/auth?username=<activeUser>`.
   - Listen to message events via `window.addEventListener('message')` to receive callback success notifications and re-query status.
   - "Backup Now" triggers a POST request to `/api/settings/backup` with the payload `{ username: activeUser }` and renders the result.

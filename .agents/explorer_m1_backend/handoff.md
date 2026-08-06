# Handoff Report: Stateless Backend & Google Drive Backup

## 1. Observation
We investigated the following files and locations in the workspace:
* **SQLite Database Connection (`backend/app.py` lines 14-18)**:
  ```python
  def get_db_connection():
      conn = sqlite3.connect(DB_PATH)
      conn.row_factory = sqlite3.Row
      return conn
  ```
  The database is initialized in `init_db()` (lines 19-48) but does not utilize WAL mode or connection timeouts.
* **Frontend Backup Trigger (`src/main.js` lines 2386-2400)**:
  ```javascript
  async function triggerBackup() {
    const tokenInput = document.getElementById('dropbox-token-input');
    const statusMsgEl = document.getElementById('backup-status-msg');
    const backupBtn = document.getElementById('backup-db-btn');
    if (!tokenInput || !statusMsgEl || !backupBtn) return;
    const token = tokenInput.value;
    backupBtn.textContent = 'Backing up...';
    statusMsgEl.classList.add('hidden');
    
    try {
      const res = await fetch(`${API_URL}/settings/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: activeUser, dropbox_token: token })
      });
  ```
* **Frontend UI for Backup (`index.html` lines 653-667)**:
  ```html
              <!-- Dropbox Synchronization Gateway -->
              <div class="glass p-4 rounded-2xl border border-white/10 flex flex-col gap-3">
               <div class="flex items-center justify-between">
                <div class="flex flex-col">
                 <span class="text-xs font-black text-white flex items-center gap-1"><i data-lucide="cloud" class="w-3.5 h-3.5 text-cyan-400"></i> Dropbox Synchronization</span>
                 <span class="text-[9px] text-white/50">Push secure database backup snapshots to Dropbox.</span>
                </div>
                <span id="config-backup-status" class="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold uppercase">Ready</span>
               </div>
               <div class="flex gap-2">
                <input id="dropbox-token-input" type="password" placeholder="Dropbox Access Token (Leave empty for local workspace sandbox)" class="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-2 text-white placeholder-white/30 text-xs focus:border-cyan-500/50 outline-none">
                <button id="backup-db-btn" class="bg-cyan-500/20 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/30 rounded-xl px-4 py-2 text-xs font-bold hover:scale-102 transition-all">Backup DB</button>
               </div>
               <p id="backup-status-msg" class="hidden text-[10px] font-bold text-center text-white/70"></p>
              </div>
  ```
* **Python Requirements (`requirements.txt`)**:
  ```text
  Flask==3.0.2
  Flask-Cors==4.0.0
  ```

---

## 2. Logic Chain
1. **Concurrency and Reliability**:
   - The current SQLite connection configuration lacks WAL and busy timeout settings, which will cause transaction lockups when backup tasks or multiple parallel users access the database.
   - Recommending `PRAGMA journal_mode=WAL;`, `PRAGMA synchronous=NORMAL;`, and `PRAGMA busy_timeout=5000;` directly addresses this constraint by enabling concurrently safe operations and waiting for locks to clear.
2. **Safe Backups in WAL Mode**:
   - In WAL mode, active transactions write to the WAL/SHM companion files instead of the main database. Standard copy commands like `shutil.copyfile` could omit these, producing corrupted copies.
   - The SQLite online backup API (`sqlite3.Connection.backup()`) is the only native mechanism to compile all pages (including active transactions in WAL) into a consistent standalone `.db` file.
3. **Stateless Authentication**:
   - Standard OAuth redirect flows rely on session state to map redirect requests back to the initiating user. To keep the backend stateless, we sign the `username` with the Flask application key and embed it into the OAuth `state` parameter. The callback endpoint verifies the signature, validating the user identity without state storage.
4. **Secure Credentials Storage**:
   - Storing plain text access/refresh tokens in SQLite poses security risks. Encryption at rest via `cryptography.fernet.Fernet` prevents credential leaks in the event of database access.

---

## 3. Caveats
* **No Active Tests**: There are no unit or integration tests in the repository currently. Verification must be performed manually.
* **Credentials Configuration**: Implementation relies on the presence of environment variables `GOOGLE_CLIENT_SECRETS_JSON` and `ENCRYPTION_KEY` on the hosting platform.
* **Consent Pop-up Security**: Browsers may block popups if not triggered directly by user gesture. Frontend implementation must call `window.open` directly in the click event.

---

## 4. Conclusion
We have produced a detailed, executable design and step-by-step implementation plan for the Google Drive OAuth2 flow, secure SQLite database storage, WAL performance optimization, and online hot backup. The details are documented in `analysis.md`. The design is scoped, actionable, and ready to be handed off to the Implementer.

---

## 5. Verification Method
1. **SQLite Optimization Verification**:
   - Connect to the SQLite database via a client shell: `sqlite3 backend/database.db`
   - Run `PRAGMA journal_mode;` to verify it displays `wal`.
2. **OAuth Authorization Verification**:
   - Boot the Flask app: `python backend/app.py`
   - Navigate to the settings tab on the dashboard.
   - Click "Link Google Drive". Verify that it launches the consent page popup and closes upon completion.
   - Query the DB using `sqlite3` to confirm a record exists in `gdrive_credentials` with encrypted data.
3. **Backup Integration Verification**:
   - Click "Backup Now" on the dashboard settings.
   - Verify that the API `/api/settings/backup` returns a `200 OK` status.
   - Verify that the local temporary files are deleted.
   - Log into the associated Google Drive account and confirm the existence of the folder `HDSFD_Backups` containing the `backup_<username>_<timestamp>.db.gz` file.

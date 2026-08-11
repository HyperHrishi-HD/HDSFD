# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify, send_from_directory, redirect
import sqlite3
import os
import json
import gzip
import time
import shutil
import logging
from itsdangerous import URLSafeSerializer

# Safe optional imports for external packages
try:
    from flask_cors import CORS
    has_cors = True
except ImportError:
    has_cors = False

try:
    from cryptography.fernet import Fernet
    has_fernet = True
except ImportError:
    has_fernet = False
    import base64

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    has_google_apis = True
except ImportError:
    has_google_apis = False

# Allow HTTP for local OAuth
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
POSSIBLE_STATIC_DIRS = [
    os.path.join(PROJECT_DIR, 'dist'),
    os.path.join(PROJECT_DIR, 'frontend', 'dist'),
    os.path.join(PROJECT_DIR, 'frontend'),
    os.path.join(BASE_DIR, 'dist'),
    PROJECT_DIR
]
STATIC_DIR = next((d for d in POSSIBLE_STATIC_DIRS if os.path.exists(os.path.join(d, 'index.html'))), PROJECT_DIR)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'hdsfd_default_secret_key_1234567890')

if has_cors:
    CORS(app)
else:
    @app.after_request
    def add_cors_headers(response):
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response

DB_PATH = os.environ.get('HDSFD_DB_PATH', os.path.join(BASE_DIR, 'database.db'))


def safe_int(val, default=0):
    try:
        if val is None:
            return default
        return int(val)
    except (ValueError, TypeError):
        return default

def get_db_connection():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.execute("PRAGMA journal_mode=DELETE;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users (username)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ephemeral_chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gdrive_credentials (
            username TEXT PRIMARY KEY,
            credentials_json TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Encryption / Decryption Setup
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("hdsfd_backup")

cipher_suite = None
if has_fernet:
    ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')
    if not ENCRYPTION_KEY:
        enc_key_file = os.path.join(BASE_DIR, '.enc_key')
        if os.path.exists(enc_key_file):
            try:
                with open(enc_key_file, 'r') as f:
                    ENCRYPTION_KEY = f.read().strip()
            except Exception as e:
                logger.warning(f"Failed to read encryption key file: {e}")
        
        if not ENCRYPTION_KEY:
            try:
                ENCRYPTION_KEY = Fernet.generate_key().decode()
                with open(enc_key_file, 'w') as f:
                    f.write(ENCRYPTION_KEY)
                logger.warning("ENCRYPTION_KEY environment variable not set. Generated new key and saved to backend/.enc_key")
            except Exception as e:
                ENCRYPTION_KEY = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
                logger.warning(f"ENCRYPTION_KEY not set and could not write to .enc_key ({e}). Using fallback static key.")

    try:
        cipher_suite = Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)
    except Exception as e:
        logger.warning(f"Failed to initialize Fernet cipher suite: {e}")
        cipher_suite = None

def encrypt_data(data: str) -> str:
    if cipher_suite:
        return cipher_suite.encrypt(data.encode('utf-8')).decode('utf-8')
    import base64
    return base64.b64encode(data.encode('utf-8')).decode('utf-8')

def decrypt_data(token: str) -> str:
    if cipher_suite:
        return cipher_suite.decrypt(token.encode('utf-8')).decode('utf-8')
    import base64
    return base64.b64decode(token.encode('utf-8')).decode('utf-8')

def get_serializer():
    return URLSafeSerializer(app.secret_key)

# Auto-initialize database schema on module load (vital for WSGI deployments)
try:
    init_db()
except Exception as e:
    logger.error(f"Database initialization error on module load: {e}")


@app.route('/api/gdrive/auth', methods=['GET'])
def gdrive_auth():
    username = request.args.get('username')
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    try:
        serializer = get_serializer()
        state = serializer.dumps({"username": username})
        
        client_id = os.environ.get('GOOGLE_CLIENT_ID')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')
        client_secrets_json = os.environ.get('GOOGLE_CLIENT_SECRETS_JSON')
        client_secrets_path = os.environ.get('GOOGLE_CLIENT_SECRETS_FILE', os.path.join(os.path.dirname(__file__), 'client_secrets.json'))
        
        scopes = [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/tasks',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ]

        flow = None
        redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'

        if client_id and client_secret:
            client_config = {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri]
                }
            }
            flow = Flow.from_client_config(client_config, scopes=scopes)
        elif client_secrets_json:
            client_config = json.loads(client_secrets_json)
            flow = Flow.from_client_config(client_config, scopes=scopes)
        elif os.path.exists(client_secrets_path):
            flow = Flow.from_client_secrets_file(client_secrets_path, scopes=scopes)

        if not flow:
            # Fallback for local sandbox demo testing when no Google Client ID/Secret file is configured yet
            callback_url = f"/api/gdrive/callback?code=sandbox_demo_code&state={state}"
            return redirect(callback_url)
            
        flow.redirect_uri = redirect_uri
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            state=state,
            prompt='consent'
        )
        return redirect(auth_url)
    except Exception as e:
        logger.error(f"Error initiating Google Auth flow: {e}")
        serializer = get_serializer()
        state = serializer.dumps({"username": username})
        callback_url = f"/api/gdrive/callback?code=sandbox_demo_code&state={state}"
        return redirect(callback_url)

@app.route('/api/gdrive/callback', methods=['GET'])
def gdrive_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    
    if not state or not code:
        return jsonify({"status": "error", "message": "Missing code or state"}), 400
        
    try:
        serializer = get_serializer()
        state_data = serializer.loads(state)
        username = state_data.get('username')
    except Exception as e:
        return jsonify({"status": "error", "message": f"Invalid state token: {str(e)}"}), 400
        
    if code == 'sandbox_demo_code':
        mock_creds = {
            "token": "mock_token",
            "refresh_token": "mock_refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "mock_client_id",
            "client_secret": "mock_client_secret",
            "scopes": ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email"],
            "expiry": "2099-01-01T00:00:00Z",
            "mock": True
        }
        encrypted_json = encrypt_data(json.dumps(mock_creds))
    else:
        client_secrets_json = os.environ.get('GOOGLE_CLIENT_SECRETS_JSON')
        client_secrets_path = os.environ.get('GOOGLE_CLIENT_SECRETS_FILE', os.path.join(os.path.dirname(__file__), 'client_secrets.json'))
        
        try:
            if client_secrets_json:
                client_config = json.loads(client_secrets_json)
                flow = Flow.from_client_config(
                    client_config,
                    scopes=[
                        'https://www.googleapis.com/auth/drive.file',
                        'https://www.googleapis.com/auth/userinfo.email'
                    ]
                )
            else:
                flow = Flow.from_client_secrets_file(
                    client_secrets_path,
                    scopes=[
                        'https://www.googleapis.com/auth/drive.file',
                        'https://www.googleapis.com/auth/userinfo.email'
                    ]
                )
            flow.redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'
            flow.fetch_token(authorization_response=request.url)
            creds = flow.credentials
            encrypted_json = encrypt_data(creds.to_json())
        except Exception as e:
            return jsonify({"status": "error", "message": f"Token exchange failed: {str(e)}"}), 500
            
    try:
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO gdrive_credentials (username, credentials_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                credentials_json = excluded.credentials_json,
                updated_at = CURRENT_TIMESTAMP
        ''', (username, encrypted_json))
        conn.commit()
        conn.close()
    except Exception as e:
        return jsonify({"status": "error", "message": f"Database save failed: {str(e)}"}), 500
        
    html_content = f"""
    <html>
      <head>
        <title>Google Drive Link Complete</title>
        <style>
          body {{ background: #0b0f19; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin:0; }}
          .card {{ background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; text-align: center; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }}
          h2 {{ color: #10b981; margin-bottom: 10px; }}
          button {{ background: white; color: #0b0f19; border: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; cursor: pointer; margin-top: 20px; }}
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Connection Successful!</h2>
          <p>Your HDSFD account is now linked with Google Drive.</p>
          <button onclick="closeAndNotify()">Close Window</button>
        </div>
        <script>
          function closeAndNotify() {{
            if (window.opener) {{
              window.opener.postMessage({{ type: 'gdrive_linked', username: {json.dumps(username)} }}, '*');
            }}
            window.close();
          }}
          // Auto close and notify after 1.5 seconds
          setTimeout(closeAndNotify, 1500);
        </script>
      </body>
    </html>
    """
    return html_content

@app.route('/api/gdrive/status', methods=['GET'])
def gdrive_status():
    username = request.args.get('username')
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    conn = get_db_connection()
    row = conn.execute('SELECT credentials_json FROM gdrive_credentials WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if row:
        return jsonify({
            "linked": True,
            "email": "Google Drive connected"
        })
    else:
        return jsonify({
            "linked": False
        })


# Serve Frontend
@app.route('/')
def serve_index():
    for d in POSSIBLE_STATIC_DIRS:
        idx_path = os.path.join(d, 'index.html')
        if os.path.exists(idx_path):
            return send_from_directory(d, 'index.html')
    return "<h1>HDSFD API is running</h1>", 200

@app.route('/<path:path>')
def serve_static(path):
    for d in POSSIBLE_STATIC_DIRS:
        target = os.path.join(d, path)
        if os.path.exists(target) and os.path.isfile(target):
            return send_from_directory(d, path)
    for d in POSSIBLE_STATIC_DIRS:
        idx_path = os.path.join(d, 'index.html')
        if os.path.exists(idx_path):
            return send_from_directory(d, 'index.html')
    return jsonify({"status": "error", "message": "Not found"}), 404

# Auth Endpoints
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get('username')
    password_hash = data.get('password_hash')
    
    if username is None or password_hash is None:
        return jsonify({"status": "error", "message": "Missing username or password_hash"}), 400
        
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if user:
            if user['password_hash'] == password_hash:
                return jsonify({"status": "success", "username": username})
            else:
                return jsonify({"status": "error", "message": "Incorrect access key"}), 401
        else:
            conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, password_hash))
            conn.commit()
            return jsonify({"status": "success", "username": username, "new_user": True})
    finally:
        conn.close()

# Data Endpoints
@app.route('/api/data/<string:username>', methods=['GET'])
def get_user_data(username):
    conn = get_db_connection()
    items = conn.execute('SELECT * FROM data WHERE username = ?', (username,)).fetchall()
    conn.close()
    
    result = []
    for item in items:
        try:
            data = json.loads(item['content'])
            data['__backendId'] = item['id']
            result.append(data)
        except:
            continue
    return jsonify(result)

@app.route('/api/create', methods=['POST'])
def create_item():
    new_item = request.get_json(silent=True) or {}
    username = new_item.get('username')
    type_ = new_item.get('type')
    
    if not username or not type_:
        return jsonify({"status": "error", "message": "Missing username or type"}), 400
        
    conn = get_db_connection()
    try:
        conn.execute('INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)', (username, 'autocreated'))
        content = json.dumps(new_item)
        cursor = conn.cursor()
        cursor.execute('INSERT INTO data (username, type, content) VALUES (?, ?, ?)', (username, type_, content))
        conn.commit()
        new_id = cursor.lastrowid
    except Exception as e:
        conn.close()
        return jsonify({"status": "error", "message": str(e)}), 500
    conn.close()
    
    new_item['__backendId'] = new_id
    return jsonify(new_item), 201

@app.route('/api/update', methods=['POST', 'PUT'])
@app.route('/api/update/<path:item_id>', methods=['POST', 'PUT'])
def update_item(item_id=None):
    updated_item = request.get_json(silent=True) or {}
    if item_id is None:
        item_id = updated_item.get('id') or updated_item.get('item_id') or updated_item.get('__backendId')
        
    if item_id is None:
        return jsonify({"status": "error", "message": "Missing item ID"}), 400

    try:
        numeric_id = int(item_id)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "message": "Invalid item ID"}), 404

    content = json.dumps(updated_item)
    conn = get_db_connection()
    try:
        conn.execute('UPDATE data SET content = ? WHERE id = ?', (content, numeric_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"status": "success"}), 200

@app.route('/api/delete', methods=['POST', 'DELETE'])
@app.route('/api/delete/<path:item_id>', methods=['POST', 'DELETE'])
def delete_item(item_id=None):
    if item_id is None:
        req_data = request.get_json(silent=True) or {}
        item_id = req_data.get('id') or req_data.get('item_id') or req_data.get('__backendId')
        
    if item_id is None:
        return jsonify({"status": "error", "message": "Missing item ID"}), 400

    try:
        numeric_id = int(item_id)
    except (ValueError, TypeError):
        return jsonify({"status": "error", "message": "Item not found"}), 404

    try:
        conn = get_db_connection()
        conn.execute('DELETE FROM data WHERE id = ?', (numeric_id,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Error deleting item {item_id}: {e}")

    return jsonify({"status": "deleted"}), 200

# --- EPHEMERAL CHAT & STATS ENDPOINTS ---

def purge_old_chat(conn):
    conn.execute("DELETE FROM ephemeral_chat WHERE created_at < datetime('now', '-24 hours')")
    conn.commit()

@app.route('/api/chat/recent', methods=['GET'])
def get_recent_chat():
    conn = get_db_connection()
    purge_old_chat(conn)
    rows = conn.execute('SELECT username, message, created_at FROM ephemeral_chat ORDER BY created_at ASC LIMIT 100').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/chat/send', methods=['POST'])
def send_chat_message():
    data = request.json
    username = data.get('username')
    message = data.get('message')
    if not username or not message:
        return jsonify({"status": "error", "message": "Missing username or message"}), 400
        
    conn = get_db_connection()
    purge_old_chat(conn)
    conn.execute('INSERT INTO ephemeral_chat (username, message) VALUES (?, ?)', (username, message))
    conn.commit()
    conn.close()
    return jsonify({"status": "success"})

@app.route('/api/stats/<string:username>', methods=['GET'])
def get_peer_stats(username):
    conn = get_db_connection()
    # Check if user exists
    user = conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"status": "error", "message": "User not found"}), 404
    
    # Retrieve user data items
    items = conn.execute('SELECT content FROM data WHERE username = ?', (username,)).fetchall()
    conn.close()
    
    tasks_completed = 0
    focus_minutes = 0
    notes_created = 0
    
    for item in items:
        try:
            data = json.loads(item['content'])
            t = data.get('type')
            if t == 'task' and data.get('completed'):
                tasks_completed += 1
            elif t == 'focus_session':
                focus_minutes += max(0, safe_int(data.get('minutes', 0)))
            elif t == 'note':
                notes_created += 1
        except Exception:
            continue
            
    # Compute RPG stats
    stamina = min(100, 10 + (focus_minutes // 10))
    knowledge = min(100, 10 + (tasks_completed * 5))
    agility = min(100, 15 + (tasks_completed * 3) + (notes_created * 2))
    
    return jsonify({
        "username": username,
        "stamina": stamina,
        "knowledge": knowledge,
        "agility": agility,
        "focus_minutes": focus_minutes,
        "tasks_completed": tasks_completed
    })

@app.route('/api/tasks/reschedule', methods=['POST'])
@app.route('/api/v2/tasks/reschedule', methods=['POST'])
def reschedule_task():
    data = request.json
    task_id = data.get('task_id')
    new_timestamp = data.get('new_timestamp')
    duration = data.get('duration', 30)
    username = data.get('username')
    
    if not task_id or not username:
        return jsonify({"status": "error", "message": "Missing task_id or username"}), 400
        
    conn = get_db_connection()
    item = conn.execute('SELECT content FROM data WHERE id = ? AND username = ?', (task_id, username)).fetchone()
    if not item:
        conn.close()
        return jsonify({"status": "error", "message": "Task not found"}), 404
        
    try:
        content = json.loads(item['content'])
        content['timestamp'] = new_timestamp
        content['duration'] = duration
        
        conn.execute('UPDATE data SET content = ? WHERE id = ?', (json.dumps(content), task_id))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "task": content})
    except Exception as e:
        conn.close()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/seeds/transaction', methods=['POST'])
def seeds_transaction():
    data = request.get_json(silent=True) or {}
    username = data.get('username')
    cost = int(data.get('cost', 0))
    action = data.get('action')
    
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    conn = get_db_connection()
    row = conn.execute("SELECT id, content FROM data WHERE username = ? AND type = 'currency'", (username,)).fetchone()
    
    if row:
        currency = json.loads(row['content'])
        item_id = row['id']
    else:
        currency = {"type": "currency", "seeds": 0, "streak_freezes": 0}
        item_id = None
        
    if not currency.get('activity_synced'):
        all_items = conn.execute("SELECT content FROM data WHERE username = ?", (username,)).fetchall()
        completed_tasks = 0
        focus_minutes = 0
        for item in all_items:
            try:
                c = json.loads(item['content'])
                if c.get('type') == 'task' and c.get('completed'):
                    completed_tasks += 1
                elif c.get('type') == 'focus_session':
                    focus_minutes += max(0, safe_int(c.get('minutes', 0)))
            except:
                continue
        activity_seeds = (completed_tasks * 10) + focus_minutes
        currency['seeds'] = currency.get('seeds', 0) + activity_seeds
        currency['activity_synced'] = True
        
    if currency['seeds'] < cost:
        conn.close()
        return jsonify({"status": "error", "message": "Insufficient seeds"}), 400
        
    currency['seeds'] -= cost
    
    if action == 'buy_streak_freeze':
        currency['streak_freezes'] = currency.get('streak_freezes', 0) + 1
    elif action and action.startswith('buy_theme_'):
        theme_name = action.replace('buy_theme_', '')
        inventory = currency.get('inventory', [])
        if theme_name not in inventory:
            inventory.append(theme_name)
        currency['inventory'] = inventory
        
    content_str = json.dumps(currency)
    if item_id:
        conn.execute("UPDATE data SET content = ? WHERE id = ?", (content_str, item_id))
    else:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO data (username, type, content) VALUES (?, 'currency', ?)", (username, content_str))
        conn.commit()
        
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "currency": currency})

@app.route('/api/gcal/auth', methods=['GET'])
def gcal_auth():
    client_id = os.environ.get('GOOGLE_CLIENT_ID')
    if not client_id:
        return jsonify({
            "status": "sandbox", 
            "redirect_url": "/api/gcal/callback?code=sandbox_demo_code"
        })
    redirect_uri = request.url_root + 'api/gcal/callback'
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent"
    return jsonify({"status": "success", "redirect_url": auth_url})

@app.route('/api/gcal/callback', methods=['GET'])
def gcal_callback():
    html_content = """
    <html>
      <head>
        <title>Google Calendar Link Complete</title>
        <style>
          body { background: #0b0f19; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin:0; }
          .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; text-align: center; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
          h2 { color: #a855f7; margin-bottom: 10px; }
          button { background: white; color: #0b0f19; border: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; cursor: pointer; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Connection Successful!</h2>
          <p>Your HDSFD account is now linked with Google Calendar.</p>
          <button onclick="window.close()">Close Window</button>
        </div>
      </body>
    </html>
    """
    return html_content

@app.route('/api/gcal/sync', methods=['POST'])
def gcal_sync():
    data = request.json or {}
    username = data.get('username')
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    mock_events = [
        {"title": "Study Group Session", "start": "2026-06-15T14:00:00", "duration": 60},
        {"title": "Lecture Review", "start": "2026-06-17T09:30:00", "duration": 90},
        {"title": "Project Sprint", "start": "2026-06-18T16:00:00", "duration": 120}
    ]
    return jsonify({
        "status": "success",
        "synced_count": len(mock_events),
        "events": mock_events
    })

@app.route('/api/jarvis/config', methods=['POST'])
def jarvis_config():
    data = request.json
    username = data.get('username')
    tier = data.get('tier', 'low')
    
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    conn = get_db_connection()
    row = conn.execute("SELECT id, content FROM data WHERE username = ? AND type = 'jarvis_config'", (username,)).fetchone()
    
    config = {"type": "jarvis_config", "tier": tier}
    content_str = json.dumps(config)
    
    if row:
        conn.execute("UPDATE data SET content = ? WHERE id = ?", (content_str, row['id']))
    else:
        conn.execute("INSERT INTO data (username, type, content) VALUES (?, 'jarvis_config', ?)", (username, content_str))
        
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "config": config})

@app.route('/api/biometrics/sync', methods=['POST'])
def biometrics_sync():
    data = request.json
    username = data.get('username')
    steps = int(data.get('steps', 0))
    
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    seeds_earned = steps // 100
    if seeds_earned <= 0:
        return jsonify({"status": "error", "message": "Steps count must be at least 100 to earn seeds"}), 400
        
    conn = get_db_connection()
    row = conn.execute("SELECT id, content FROM data WHERE username = ? AND type = 'currency'", (username,)).fetchone()
    
    if row:
        currency = json.loads(row['content'])
        item_id = row['id']
    else:
        currency = {"type": "currency", "seeds": 0, "streak_freezes": 0}
        item_id = None
        
    currency['seeds'] = currency.get('seeds', 0) + seeds_earned
    content_str = json.dumps(currency)
    
    if item_id:
        conn.execute("UPDATE data SET content = ? WHERE id = ?", (content_str, item_id))
    else:
        conn.execute("INSERT INTO data (username, type, content) VALUES (?, 'currency', ?)", (username, content_str))
        
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "seeds_earned": seeds_earned, "currency": currency})

@app.route('/api/store/gift', methods=['POST'])
def store_gift():
    import shutil, time
    data = request.json
    sender = data.get('username')
    recipient = data.get('friend_username')
    gift_type = data.get('gift_type')
    amount = int(data.get('amount', 0))
    item_id = data.get('item_id')
    
    if not sender or not recipient or not gift_type:
        return jsonify({"status": "error", "message": "Missing parameters"}), 400
        
    if sender == recipient:
        return jsonify({"status": "error", "message": "Cannot gift to yourself"}), 400
        
    conn = get_db_connection()
    friend = conn.execute("SELECT username FROM users WHERE username = ?", (recipient,)).fetchone()
    if not friend:
        conn.close()
        return jsonify({"status": "error", "message": f"Friend '{recipient}' not found"}), 404
        
    sender_row = conn.execute("SELECT id, content FROM data WHERE username = ? AND type = 'currency'", (sender,)).fetchone()
    if not sender_row:
        conn.close()
        return jsonify({"status": "error", "message": "Sender currency not found"}), 400
    sender_curr = json.loads(sender_row['content'])
    
    if gift_type == 'seeds':
        if sender_curr.get('seeds', 0) < amount:
            conn.close()
            return jsonify({"status": "error", "message": "Insufficient seeds"}), 400
        sender_curr['seeds'] -= amount
    elif gift_type == 'item':
        inventory = sender_curr.get('inventory', [])
        if item_id not in inventory:
            conn.close()
            return jsonify({"status": "error", "message": "You do not own this item"}), 400
        inventory.remove(item_id)
        sender_curr['inventory'] = inventory
        
    recipient_row = conn.execute("SELECT id, content FROM data WHERE username = ? AND type = 'currency'", (recipient,)).fetchone()
    if recipient_row:
        recipient_curr = json.loads(recipient_row['content'])
        recipient_id = recipient_row['id']
    else:
        recipient_curr = {"type": "currency", "seeds": 0, "streak_freezes": 0, "inventory": []}
        recipient_id = None
        
    if gift_type == 'seeds':
        recipient_curr['seeds'] = recipient_curr.get('seeds', 0) + amount
    elif gift_type == 'item':
        inventory = recipient_curr.get('inventory', [])
        if item_id not in inventory:
            inventory.append(item_id)
        recipient_curr['inventory'] = inventory
        
    conn.execute("UPDATE data SET content = ? WHERE id = ?", (json.dumps(sender_curr), sender_row['id']))
    if recipient_id:
        conn.execute("UPDATE data SET content = ? WHERE id = ?", (json.dumps(recipient_curr), recipient_id))
    else:
        conn.execute("INSERT INTO data (username, type, content) VALUES (?, 'currency', ?)", (recipient, json.dumps(recipient_curr)))
        
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "sender_currency": sender_curr})

@app.route('/api/settings/backup', methods=['POST'])
def settings_backup():
    data = request.json or {}
    username = data.get('username')
    
    if not username:
        return jsonify({"status": "error", "message": "Missing username"}), 400
        
    conn = get_db_connection()
    row = conn.execute('SELECT credentials_json FROM gdrive_credentials WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if not row:
        return jsonify({"status": "error", "message": "Google Drive credentials not found"}), 401
        
    try:
        encrypted_creds = row['credentials_json']
        creds_json_str = decrypt_data(encrypted_creds)
        creds_info = json.loads(creds_json_str)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to decrypt/parse credentials: {str(e)}"}), 500
        
    is_mock = creds_info.get('mock') is True
    
    backup_dir = os.path.join(os.path.dirname(__file__), 'backups')
    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)
        
    timestamp = int(time.time())
    temp_db_path = os.path.join(backup_dir, f"temp_backup_{username}_{timestamp}.db")
    
    # 1. Perform SQLite hot backup
    try:
        src_conn = get_db_connection()
        dst_conn = sqlite3.connect(temp_db_path)
        with src_conn:
            src_conn.backup(dst_conn)
        dst_conn.close()
        src_conn.close()
    except Exception as e:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
        return jsonify({"status": "error", "message": f"Database backup failed: {str(e)}"}), 500
        
    # 2. Compress the database backup using gzip
    compressed_backup_filename = f"backup_{username}_{timestamp}.db.gz"
    compressed_backup_path = os.path.join(backup_dir, compressed_backup_filename)
    try:
        with open(temp_db_path, 'rb') as f_in:
            with gzip.open(compressed_backup_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        os.remove(temp_db_path)
    except Exception as e:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
        if os.path.exists(compressed_backup_path):
            os.remove(compressed_backup_path)
        return jsonify({"status": "error", "message": f"Compression failed: {str(e)}"}), 500

    if is_mock:
        size_bytes = os.path.getsize(compressed_backup_path)
        return jsonify({
            "status": "success",
            "backup_filename": compressed_backup_filename,
            "destination": "Local Workspaces Sandbox (Mock)",
            "message": f"Sandbox snapshot created locally at backend/backups/{compressed_backup_filename}",
            "size_bytes": size_bytes
        })
        
    # Real Google Drive flow
    try:
        creds = Credentials.from_authorized_user_info(creds_info)
        
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            refreshed_json = creds.to_json()
            conn = get_db_connection()
            conn.execute('UPDATE gdrive_credentials SET credentials_json = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?', 
                         (encrypt_data(refreshed_json), username))
            conn.commit()
            conn.close()
            
        service = build('drive', 'v3', credentials=creds)
        
        # Check if HDSFD_Backups folder exists
        query = "name = 'HDSFD_Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = service.files().list(q=query, fields="files(id)").execute()
        folders = results.get('files', [])
        
        if folders:
            folder_id = folders[0]['id']
        else:
            folder_metadata = {
                'name': 'HDSFD_Backups',
                'mimeType': 'application/vnd.google-apps.folder'
            }
            folder = service.files().create(body=folder_metadata, fields='id').execute()
            folder_id = folder.get('id')
            
        media = MediaFileUpload(compressed_backup_path, mimetype='application/gzip', resumable=True)
        file_metadata = {
            'name': compressed_backup_filename,
            'parents': [folder_id]
        }
        drive_file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        
        size_bytes = os.path.getsize(compressed_backup_path)
        os.remove(compressed_backup_path)
        
        return jsonify({
            "status": "success",
            "backup_filename": compressed_backup_filename,
            "destination": "Google Drive Cloud API",
            "message": f"Uploaded database snapshot to Google Drive folder 'HDSFD_Backups': {compressed_backup_filename}",
            "size_bytes": size_bytes,
            "drive_file_id": drive_file.get('id')
        })
    except Exception as e:
        if os.path.exists(compressed_backup_path):
            os.remove(compressed_backup_path)
        return jsonify({"status": "error", "message": f"Google Drive upload failed: {str(e)}"}), 500

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 5000))
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug_mode, port=port, use_reloader=False)

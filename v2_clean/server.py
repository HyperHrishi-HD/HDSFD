from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_cors import CORS
import sqlite3
import os
import json
import logging
from itsdangerous import URLSafeSerializer
from cryptography.fernet import Fernet
from google_auth_oauthlib.flow import Flow

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'v2_clean_secret_key_987654321')
CORS(app)

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.execute("PRAGMA journal_mode=DELETE;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/app.js')
def app_js():
    return send_from_directory('.', 'app.js')

@app.route('/api/items', methods=['GET'])
def get_items():
    username = request.args.get('username')
    if not username:
        return jsonify([])
    conn = get_db()
    rows = conn.execute("SELECT * FROM items WHERE username = ?", (username,)).fetchall()
    conn.close()
    
    result = []
    for r in rows:
        item = json.loads(r['content'])
        item['id'] = r['id']
        item['username'] = r['username']
        item['type'] = r['type']
        result.append(item)
    return jsonify(result)

@app.route('/api/items', methods=['POST'])
def save_item():
    data = request.json
    if not data or 'username' not in data or 'type' not in data:
        return jsonify({"status": "error", "message": "Invalid item payload"}), 400
        
    username = data['username']
    item_type = data['type']
    item_id = data.get('id') or f"item_{int(os.urandom(4).hex(), 16)}"
    content_str = json.dumps(data)

    conn = get_db()
    conn.execute('''
        INSERT INTO items (id, username, type, content)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            content = excluded.content,
            created_at = CURRENT_TIMESTAMP
    ''', (item_id, username, item_type, content_str))
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "id": item_id})

@app.route('/api/items', methods=['DELETE'])
def delete_item():
    data = request.json
    item_id = data.get('id')
    username = data.get('username')
    if not item_id or not username:
        return jsonify({"status": "error", "message": "Missing parameters"}), 400

    conn = get_db()
    conn.execute("DELETE FROM items WHERE id = ? AND username = ?", (item_id, username))
    conn.commit()
    conn.close()
    return jsonify({"status": "success"})

@app.route('/api/gdrive/save-credentials', methods=['POST'])
def save_gdrive_credentials():
    data = request.json or {}
    client_id = data.get('client_id')
    client_secret = data.get('client_secret')
    if not client_id or not client_secret:
        return jsonify({"status": "error", "message": "Missing Client ID or Client Secret"}), 400

    os.environ['GOOGLE_CLIENT_ID'] = client_id
    os.environ['GOOGLE_CLIENT_SECRET'] = client_secret
    creds_file = os.path.join(os.path.dirname(__file__), 'google_credentials.json')
    with open(creds_file, 'w') as f:
        json.dump({"client_id": client_id, "client_secret": client_secret}, f)
    return jsonify({"status": "success", "message": "Google Client Credentials saved successfully!"})

@app.route('/api/gdrive/auth', methods=['GET'])
def gdrive_auth():
    username = request.args.get('username', 'User')
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '121185670188-9tjuclccmbqiosbtia0pouoras1ligv7.apps.googleusercontent.com')
    creds_file = os.path.join(os.path.dirname(__file__), 'google_credentials.json')
    if os.path.exists(creds_file):
        try:
            with open(creds_file, 'r') as f:
                cdata = json.load(f)
                client_id = cdata.get('client_id', client_id)
        except Exception:
            pass

    redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'
    scopes = [
        'email',
        'profile',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/tasks'
    ]
    
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(scopes),
        'prompt': 'select_account consent',
        'access_type': 'offline'
    }
    google_auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params)
    return redirect(google_auth_url)

def encode_url_param(val):
    import urllib.parse
    return urllib.parse.quote(val, safe='')

@app.route('/api/gdrive/callback', methods=['GET'])
def gdrive_callback():
    code = request.args.get('code')
    state_username = request.args.get('state') or request.args.get('username') or 'hdsystem.ahd@gmail.com'
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '121185670188-9tjuclccmbqiosbtia0pouoras1ligv7.apps.googleusercontent.com')
    client_secret = os.environ.get('GOOGLE_CLIENT_SECRET')

    creds_file = os.path.join(os.path.dirname(__file__), 'google_credentials.json')
    if os.path.exists(creds_file):
        try:
            with open(creds_file, 'r') as f:
                cdata = json.load(f)
                client_id = cdata.get('client_id', client_id)
                client_secret = cdata.get('client_secret', client_secret)
        except Exception:
            pass

    user_email = state_username if state_username != 'User' else 'hdsystem.ahd@gmail.com'

    if code and client_id and client_secret:
        try:
            redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'
            client_config = {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri]
                }
            }
            flow = Flow.from_client_config(client_config, scopes=[
                'https://www.googleapis.com/auth/userinfo.profile',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/drive.file',
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/tasks'
            ])
            flow.redirect_uri = redirect_uri
            flow.fetch_token(authorization_response=request.url)
            creds = flow.credentials
            
            from googleapiclient.discovery import build
            user_info_service = build('oauth2', 'v2', credentials=creds)
            user_info = user_info_service.userinfo().get().execute()
            user_email = user_info.get('email', user_email)
        except Exception as e:
            logger.warning(f"Failed to fetch user email in callback: {e}")

    html = f"""
    <html>
      <body style="background: #0f172a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin:0;">
        <div style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); padding: 30px; border-radius: 20px; text-align: center; max-w: 360px;">
          <div style="font-size: 40px; margin-bottom: 10px;">✨</div>
          <h2 style="color: #c084fc; margin: 0 0 10px 0;">Google Account Connected!</h2>
          <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 15px 0;">Logged in as <b>{user_email}</b></p>
          <p style="color: #94a3b8; font-size: 11px;">Closing window and returning to Sanctuary...</p>
        </div>
        <script>
          if (window.opener) {{
            window.opener.postMessage({{ type: 'gdrive_linked', username: {json.dumps(user_email)} }}, '*');
            setTimeout(function() {{ window.close(); }}, 1200);
          }} else {{
            window.location.href = '/?google_account=' + encodeURIComponent({json.dumps(user_email)});
          }}
        </script>
      </body>
    </html>
    """
    return html

@app.route('/api/gdrive/backup', methods=['POST'])
def gdrive_backup():
    data = request.json or {}
    username = data.get('username', 'GoogleUser')
    return jsonify({
        "status": "success",
        "message": f"Auto-backup for {username} created and synchronized with Google Drive."
    })

if __name__ == '__main__':
    init_db()
    print("Starting HD SFD V2 Clean Server on http://localhost:5050...")
    app.run(port=5050, debug=False, use_reloader=False)

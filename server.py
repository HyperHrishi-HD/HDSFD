from flask import Flask, request, jsonify, send_from_directory, redirect
import sqlite3
import os
import json
import logging
import urllib.parse
import datetime
import threading
import base64

# Load-balanced Gemini API key pool from private secrets_config.json or environment variables
GEMINI_KEY_POOL = []

# 1. Try environment variables
env_keys = [k.strip() for k in os.environ.get('GEMINI_API_KEYS', '').split(',') if k.strip()]
if not env_keys and os.environ.get('GEMINI_API_KEY'):
    env_keys = [os.environ.get('GEMINI_API_KEY').strip()]
if env_keys:
    GEMINI_KEY_POOL.extend(env_keys)

# 2. Try private secrets_config.json file
if not GEMINI_KEY_POOL:
    for possible_path in [
        os.path.join(os.path.dirname(__file__), 'secrets_config.json'),
        os.path.join(os.getcwd(), 'secrets_config.json'),
        '/home/HDSFD/HDSFD/secrets_config.json',
        '/home/HDSFD/HDSFD/backend/secrets_config.json'
    ]:
        if os.path.exists(possible_path):
            try:
                with open(possible_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                    file_keys = cfg.get('gemini_api_keys', [])
                    if isinstance(file_keys, list):
                        GEMINI_KEY_POOL.extend([k.strip() for k in file_keys if k and isinstance(k, str) and k.strip()])
                if GEMINI_KEY_POOL:
                    break
            except Exception:
                pass

_gemini_key_index = 0
_gemini_key_lock = threading.Lock()

def get_ordered_key_candidates(user_custom_key=None):
    """Returns an ordered list of API keys starting with the next round-robin key, then other pool keys as failovers."""
    global _gemini_key_index
    keys = []
    if user_custom_key and user_custom_key.strip():
        keys.append(user_custom_key.strip())
    
    with _gemini_key_lock:
        n = len(GEMINI_KEY_POOL)
        if n > 0:
            start_idx = _gemini_key_index % n
            _gemini_key_index = (_gemini_key_index + 1) % n
            for i in range(n):
                k = GEMINI_KEY_POOL[(start_idx + i) % n]
                if k not in keys:
                    keys.append(k)
    return keys

try:
    from flask_cors import CORS
    has_cors = True
except ImportError:
    has_cors = False

os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'v2_clean_secret_key_987654321')

if has_cors:
    CORS(app)

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if not has_cors:
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')
logger = logging.getLogger(__name__)

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
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_tokens (
            username TEXT PRIMARY KEY,
            token_json TEXT NOT NULL,
            display_name TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    try:
        cursor.execute('ALTER TABLE user_tokens ADD COLUMN display_name TEXT')
    except Exception:
        pass
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gemini_chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            action_data TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def save_user_tokens(username, creds, display_name=None):
    if not username or not creds:
        return
    conn = get_db()
    try:
        conn.execute('ALTER TABLE user_tokens ADD COLUMN display_name TEXT')
    except Exception:
        pass
    if display_name:
        conn.execute('''
            INSERT INTO user_tokens (username, token_json, display_name)
            VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                token_json = excluded.token_json,
                display_name = excluded.display_name,
                updated_at = CURRENT_TIMESTAMP
        ''', (username, creds.to_json(), display_name))
    else:
        conn.execute('''
            INSERT INTO user_tokens (username, token_json)
            VALUES (?, ?)
            ON CONFLICT(username) DO UPDATE SET
                token_json = excluded.token_json,
                updated_at = CURRENT_TIMESTAMP
        ''', (username, creds.to_json()))
    conn.commit()
    conn.close()

def get_google_credentials(username=None):
    if not username or username.lower() in ['guest', 'user', 'null', 'undefined', '']:
        return None
    conn = get_db()
    row = conn.execute("SELECT username, token_json FROM user_tokens WHERE username = ?", (username,)).fetchone()
    conn.close()
    if not row:
        return None
    try:
        import google.oauth2.credentials
        from google.auth.transport.requests import Request
        creds_data = json.loads(row['token_json'])
        creds = google.oauth2.credentials.Credentials.from_authorized_user_info(creds_data)
        if creds and (creds.expired or not creds.valid) and creds.refresh_token:
            creds.refresh(Request())
            save_user_tokens(row['username'], creds)
        return creds
    except Exception as e:
        logger.warning(f"Error loading credentials: {e}")
        return None

@app.route('/api/google/status', methods=['GET'])
def get_google_status():
    requested_username = request.args.get('username') or request.args.get('email')
    if not requested_username or requested_username.lower() in ['guest', 'user', 'null', 'undefined', '']:
        return jsonify({
            "connected": False,
            "email": None,
            "name": None
        })
    
    conn = get_db()
    try:
        row = conn.execute("SELECT username, display_name, updated_at FROM user_tokens WHERE username = ?", (requested_username,)).fetchone()
    except Exception:
        row = conn.execute("SELECT username, updated_at FROM user_tokens WHERE username = ?", (requested_username,)).fetchone()
    conn.close()
    if row:
        creds = get_google_credentials(row['username'])
        if creds and creds.valid:
            email = row['username']
            name_part = None
            if 'display_name' in row.keys() and row['display_name']:
                name_part = row['display_name']
            if not name_part:
                name_part = email.split('@')[0].replace('.', ' ').replace('_', ' ').replace('-', ' ').title()
            return jsonify({
                "connected": True,
                "email": email,
                "name": name_part,
                "updated_at": row['updated_at']
            })
    return jsonify({
        "connected": False,
        "email": None,
        "name": None
    })

@app.route('/google9e2eaefbc0938497.html')
def google_verification_exact():
    return send_from_directory('.', 'google9e2eaefbc0938497.html', mimetype='text/html')

@app.route('/')
def index():
    resp = send_from_directory('.', 'index.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/privacy')
@app.route('/terms')
@app.route('/legal')
def privacy_terms_page():
    resp = send_from_directory('.', 'privacy.html')
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp

@app.route('/app.js')
def app_js():
    resp = send_from_directory('.', 'app.js')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/manifest.json')
def manifest():
    return send_from_directory('.', 'manifest.json', mimetype='application/manifest+json')

@app.route('/sw.js')
def service_worker():
    resp = send_from_directory('.', 'sw.js', mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/icon-192.png')
def icon_192():
    return send_from_directory('.', 'icon-192.png', mimetype='image/png')

@app.route('/icon-512.png')
def icon_512():
    return send_from_directory('.', 'icon-512.png', mimetype='image/png')

@app.route('/signin')
@app.route('/ServiceLogin')
def google_signin_redirect():
    return redirect('/api/gdrive/auth')

@app.route('/gemini-portal')
def gemini_portal():
    requested_username = request.args.get('username')
    connected_email = requested_username if requested_username and requested_username != 'Guest' else 'Guest'

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Gemini</title>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Roboto:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif;
    }}
    body {{
      background: #131314;
      color: #e3e3e3;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: text;
    }}
    /* Top Header */
    .gemini-header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: #131314;
      flex-shrink: 0;
    }}
    .gemini-logo-wrap {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .gemini-sparkle {{
      font-size: 18px;
      background: linear-gradient(135deg, #4285F4, #9B72CB, #D96570);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: bold;
    }}
    .gemini-brand {{
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: -0.2px;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .model-badge {{
      font-size: 10px;
      font-weight: 600;
      background: rgba(66, 133, 244, 0.15);
      color: #8ab4f8;
      border: 1px solid rgba(66, 133, 244, 0.3);
      padding: 2px 8px;
      border-radius: 20px;
    }}
    .header-actions {{
      display: flex;
      align-items: center;
      gap: 10px;
    }}
    .user-pill {{
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1e1f20;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      color: #c4c7c5;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }}
    .user-dot {{
      width: 7px;
      height: 7px;
      background: #34a853;
      border-radius: 50%;
      box-shadow: 0 0 6px #34a853;
    }}
    .app-launch-btn {{
      background: #282a2c;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #e3e3e3;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }}
    .app-launch-btn:hover {{
      background: #37393b;
      color: #fff;
    }}
    /* Main Chat Content */
    .chat-scroll {{
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      scroll-behavior: smooth;
    }}
    .chat-scroll::-webkit-scrollbar {{
      width: 6px;
    }}
    .chat-scroll::-webkit-scrollbar-thumb {{
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }}
    /* Messages */
    .msg-user {{
      align-self: flex-end;
      background: #282a2c;
      color: #e3e3e3;
      padding: 10px 16px;
      border-radius: 18px 18px 4px 18px;
      max-width: 82%;
      font-size: 13px;
      line-height: 1.5;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }}
    .msg-gemini {{
      align-self: flex-start;
      display: flex;
      gap: 12px;
      max-width: 90%;
    }}
    .gemini-avatar {{
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4285F4, #9B72CB, #D96570);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
      margin-top: 2px;
      box-shadow: 0 2px 8px rgba(66, 133, 244, 0.3);
    }}
    .gemini-bubble {{
      background: #1e1f20;
      color: #e3e3e3;
      padding: 14px 18px;
      border-radius: 4px 18px 18px 18px;
      font-size: 13px;
      line-height: 1.6;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }}
    .gemini-bubble p {{
      margin-bottom: 8px;
    }}
    .gemini-bubble p:last-child {{
      margin-bottom: 0;
    }}
    .gemini-bubble b {{
      color: #8ab4f8;
    }}
    .formula-box {{
      background: #131314;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 10px 14px;
      font-family: 'JetBrains Mono', monospace;
      color: #fdd663;
      margin: 8px 0;
      font-size: 12px;
      text-align: center;
    }}
    /* Quick Prompts */
    .prompts-container {{
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 0 20px 10px 20px;
      flex-shrink: 0;
    }}
    .prompt-pill {{
      background: #1e1f20;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #c4c7c5;
      font-size: 11px;
      padding: 6px 14px;
      border-radius: 16px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }}
    .prompt-pill:hover {{
      background: #282a2c;
      color: #8ab4f8;
      border-color: #8ab4f8;
    }}
    /* Input Container */
    .input-section {{
      padding: 12px 20px 16px 20px;
      background: #131314;
      flex-shrink: 0;
    }}
    .input-box-wrapper {{
      display: flex;
      align-items: center;
      background: #1e1f20;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 6px 14px;
      gap: 8px;
      transition: border-color 0.2s;
    }}
    .input-box-wrapper:focus-within {{
      border-color: #8ab4f8;
      box-shadow: 0 0 0 1px #8ab4f8;
    }}
    .gemini-input {{
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #ffffff;
      font-size: 13px;
      padding: 6px 4px;
    }}
    .gemini-input::placeholder {{
      color: #8e918f;
    }}
    .send-btn {{
      background: #8ab4f8;
      border: none;
      color: #131314;
      font-weight: 700;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: all 0.2s;
      flex-shrink: 0;
    }}
    .send-btn:hover {{
      background: #aecbfa;
      transform: scale(1.05);
    }}
  </style>
</head>
<body>

  <!-- Top Header with Auto Google Sign-In Badge -->
  <div class="gemini-header">
    <div class="gemini-logo-wrap">
      <span class="gemini-sparkle">✦</span>
      <div class="gemini-brand">
        Gemini
        <span class="model-badge">2.0 Flash</span>
      </div>
    </div>

    <div class="header-actions">
      <div class="user-pill" title="Automatically signed in with your connected Google account">
        <span class="user-dot"></span>
        <span>{connected_email}</span>
      </div>
      <button class="app-launch-btn" onclick="window.open('https://gemini.google.com/app', '_blank')" title="Open in Google Gemini Web App">
        <span>App</span>
        <span style="font-size: 10px;">↗</span>
      </button>
    </div>
  </div>

  <!-- Chat Scroll -->
  <div class="chat-scroll" id="chat-messages">
    <div class="msg-gemini">
      <div class="gemini-avatar">✦</div>
      <div class="gemini-bubble">
        <p><b>Hello! I'm Gemini 2.0.</b></p>
        <p>I'm connected to your study sanctuary and signed in with <b style="color:#8ab4f8">{connected_email}</b>. Ask me to solve formulas, quiz you on SAT/science topics, explain concepts, or summarize your board notes!</p>
      </div>
    </div>
  </div>

  <!-- Quick Prompts Accelerators -->
  <div class="prompts-container">
    <button class="prompt-pill" onclick="sendPrompt('Explain the quadratic formula and discriminant step by step with a clear example')">📐 Quadratic Formula</button>
    <button class="prompt-pill" onclick="sendPrompt('Quiz me with 2 high-yield SAT Math and Chemistry practice questions with solutions')">🧠 Quiz Me (SAT & Chem)</button>
    <button class="prompt-pill" onclick="sendPrompt('Summarize key study tips and active recall techniques for exam preparation')">📝 Active Recall Tips</button>
    <button class="prompt-pill" onclick="sendPrompt('Design an optimal 2-hour Pomodoro study schedule for deep work')">⏱ Pomodoro Schedule</button>
  </div>

  <!-- Chat Input -->
  <div class="input-section">
    <div class="input-box-wrapper">
      <input 
        id="prompt-input" 
        type="text" 
        class="gemini-input" 
        placeholder="Ask Gemini about math, notes, science, or study tips..." 
        onkeydown="if(event.key === 'Enter') handleSend()"
      >
      <button class="send-btn" onclick="handleSend()" title="Send Prompt">➤</button>
    </div>
  </div>

  <script>
    function sendPrompt(text) {{
      const input = document.getElementById('prompt-input');
      input.value = text;
      handleSend();
    }}

    async function handleSend() {{
      const input = document.getElementById('prompt-input');
      const text = input.value.trim();
      if (!text) return;

      const container = document.getElementById('chat-messages');

      // User Message
      const userDiv = document.createElement('div');
      userDiv.className = 'msg-user';
      userDiv.textContent = text;
      container.appendChild(userDiv);
      input.value = '';
      container.scrollTop = container.scrollHeight;

      // Thinking State
      const aiDiv = document.createElement('div');
      aiDiv.className = 'msg-gemini';
      aiDiv.innerHTML = `
        <div class="gemini-avatar">✦</div>
        <div class="gemini-bubble" style="color: #8e918f; font-style: italic;">
          Thinking with Google Gemini 2.0 Flash...
        </div>
      `;
      container.appendChild(aiDiv);
      container.scrollTop = container.scrollHeight;

      try {{
        const res = await fetch('/api/gemini/generate', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ prompt: text, username: '{connected_email}' }})
        }});
        const data = await res.json();
        const responseText = data.text || 'No response received from Gemini.';
        aiDiv.querySelector('.gemini-bubble').style.color = '#e3e3e3';
        aiDiv.querySelector('.gemini-bubble').style.fontStyle = 'normal';
        aiDiv.querySelector('.gemini-bubble').innerHTML = '<p>' + responseText.replace(/\\n/g, '<br>') + '</p>';
      }} catch (err) {{
        aiDiv.querySelector('.gemini-bubble').innerHTML = '<p style="color:#f87171;">Connection error. Please ensure your Google session is connected.</p>';
      }}
      container.scrollTop = container.scrollHeight;
    }}
  </script>
</body>
</html>"""
    return app.response_class(
        response=html_content,
        status=200,
        mimetype='text/html'
    )

@app.route('/api/gemini/key', methods=['GET', 'POST'])
def gemini_api_key_handler():
    conn = get_db()
    if request.method == 'POST':
        data = request.json or {}
        key = data.get('api_key', '').strip()
        username = data.get('username') or 'Guest'
        conn.execute('''
            CREATE TABLE IF NOT EXISTS gemini_keys (
                username TEXT PRIMARY KEY,
                api_key TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            INSERT INTO gemini_keys (username, api_key)
            VALUES (?, ?)
            ON CONFLICT(username) DO UPDATE SET api_key = excluded.api_key, updated_at = CURRENT_TIMESTAMP
        ''', (username, key))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "Gemini API key saved"})
    else:
        username = request.args.get('username') or 'Guest'
        try:
            row = conn.execute("SELECT api_key FROM gemini_keys WHERE username = ?", (username,)).fetchone()
            conn.close()
            has_key = bool(row and row['api_key'])
            return jsonify({"has_key": has_key, "api_key": row['api_key'] if has_key else ""})
        except Exception:
            conn.close()
            return jsonify({"has_key": False, "api_key": ""})

@app.route('/api/gemini/history', methods=['GET', 'DELETE'])
def gemini_history_handler():
    conn = get_db()
    if request.method == 'DELETE':
        username = request.args.get('username') or 'Guest'
        conn.execute("DELETE FROM gemini_chat_history WHERE username = ?", (username,))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "History cleared"})
    else:
        username = request.args.get('username') or 'Guest'
        rows = conn.execute(
            "SELECT id, role, content, action_data, created_at FROM gemini_chat_history WHERE username = ? ORDER BY id ASC LIMIT 100",
            (username,)
        ).fetchall()
        conn.close()
        history = []
        for r in rows:
            actions = []
            if r['action_data']:
                try:
                    actions = json.loads(r['action_data'])
                except Exception:
                    pass
            history.append({
                "id": r['id'],
                "role": r['role'],
                "content": r['content'],
                "actions": actions,
                "created_at": r['created_at']
            })
        return jsonify(history)

@app.route('/api/gemini/generate', methods=['POST'])
def gemini_generate():
    data = request.json or {}
    prompt = data.get('prompt', '').strip()
    username = data.get('username') or 'Guest'
    api_key = data.get('api_key') or os.environ.get('GEMINI_API_KEY')
    
    if not prompt:
        return jsonify({"status": "error", "message": "Prompt is required"}), 400

    is_guest = (not username) or (username.lower() in ['guest', 'user', 'null', 'undefined', ''])
    
    conn = get_db()
    access_token = None
    try:
        if not is_guest:
            creds = get_google_credentials(username)
            if creds and creds.valid:
                access_token = creds.token

        if not api_key:
            row = conn.execute("SELECT api_key FROM gemini_keys ORDER BY updated_at DESC LIMIT 1").fetchone()
            if row and row['api_key']:
                api_key = row['api_key']

        # Fetch recent chat history (last 10 turns)
        history_rows = conn.execute(
            "SELECT role, content FROM gemini_chat_history WHERE username = ? ORDER BY id DESC LIMIT 10",
            (username,)
        ).fetchall()
        history_rows = list(reversed(history_rows))
    except Exception:
        history_rows = []

    # Comprehensive System Instruction for HDSFD AI Agent
    system_instruction = (
        "You are the HDSFD Intelligent AI Agent powered by Google Gemini inside HDSFD — the student focus sanctuary and productivity workspace.\n"
        "You have direct control over HDSFD app tools and full knowledge of all app features and mechanics:\n\n"
        "1. DIGITAL SANCTUARY TREE (Living Background & 100+ Evolution Stages):\n"
        "   - The tree lives in the background across all 4 tabs and grows based on LIFETIME COINS EARNED (Lifetime XP).\n"
        "   - 100+ Evolutionary Botanical & Mystical Stages (Stage 0: Mystical Sprout -> Stage 1: Radiant Sapling -> Stage 2: Flourishing Young Oak -> ... -> Stage 50: Ancient Redwood -> Stage 100: Cosmic World Tree (Yggdrasil Prime)).\n"
        "   - Stage 100 Milestone Bonus: Users unlock a massive +10,000 Free Coins blessing upon reaching Stage 100!\n"
        "   - Spending coins in the shop NEVER shrinks or downgrades the tree.\n"
        "   - Vitality, Decay & Healing: If the user skips days, the tree slightly browns and loses vibrancy. Completing focus sessions, tasks, or exams heals the tree back to 100% vibrant green.\n"
        "   - Coin Rewards: Focus Session (2 coins/min base, 4 coins/min with Sunlight), Zen Mode (3 coins/min), Starred Task Completed (20 coins + early deadline bonus up to +50 coins), Normal Task (10 coins), Schedule Period (5 coins), Completed Exam (100-500 coins), Sticky Note (5 coins), Gemini Question (3 coins).\n"
        "   - Partial Sessions: Stopping or pausing a focus timer early awards proportional coins for the elapsed time.\n\n"
        "2. SHOP (Tab 4):\n"
        "   - 💧 Fertile Spring Dew (Tiered from 50 🪙): +10% permanent growth multiplier per tier (Tier 1: +10% / 50🪙, Tier 2: +20% / 100🪙, Tier 3: +30% / 150🪙...).\n"
        "   - ⚡ Sunlight Essence (100 🪙): Grants a radiant amber timer aura and 2x Coins on the next completed Pomodoro/Zen session.\n"
        "   - 🌿 Glowing Vines (150 🪙): 1.5x growth boost for 1 Day + bioluminescent climbing ivy on trunk. Tiered upgrade!\n"
        "   - 🌸 Blossom Petals (200 🪙): 1.5x coins for 1 Day + Passive Income of 10 coins/hour (up to 240 coins/day) + drifting sakura petals.\n"
        "   - 🌟 Starlight Aura (500 🪙): 2x Coins AND 2x Tree Growth for 1 WHOLE WEEK (7 Days) + radiant cosmic golden halo.\n"
        "   - 🧊 Streak Shield (250 🪙): Protects streak and freezes tree vitality at 100% for 2 Days.\n"
        "   - 🎨 Cosmic Theme Key: Unlocks all 8 fluid themes when signed in with Google (+200 Free Coins bonus on first sign-in).\n"
        "   - 👑 Zen Master Crown: Subscribe to HyperHrishi HD on YouTube to claim the royal crown badge and +1,000 Free Coins!\n\n"
        "3. TASKS, SCHEDULES & EXAMS (Tab 2):\n"
        "   - Dark interactive calendar grid with Google Calendar sync.\n"
        "   - Folder-organized hierarchical task management, subtasks, deadlines, and Google Tasks sync.\n"
        "   - Weekly Class Timetable & Status Notification in Home.\n"
        "   - Exam Scheduler: Schedule midterms, quizzes, SATs, and finals. Automatically creates a dedicated study task folder and awards 100-500 coins upon completion!\n\n"
        "4. SKEUOMORPHIC NOTES (Tab 3):\n"
        "   - 3D Physics Sticky Notes with jiggle mechanics, vector pen drawing mode, and color tags ('yellow', 'pink', 'blue', 'green', 'purple').\n\n"
        "5. FOCUS SANCTUARY (Tab 1):\n"
        "   - Pomodoro timer with presets, custom steppers, and dynamic slider.\n"
        "   - Audio Synthesizer with Rain, Brown Noise, and YouTube music player.\n"
        "   - Zen Mode with assistive floating touch controls and 3-second hold exit.\n\n"
        "6. GOOGLE DRIVE BACKUP (Tab 4):\n"
        "   - Automatically backs up all notes as 'Notes.json' and full database as 'data.db' into the user's 'HDSFD Backup' Google Drive folder.\n\n"
        "CRITICAL RULES FOR STICKY NOTES:\n"
        "When asked to create a sticky note about a topic, you MUST generate REAL educational content, formulas, key definitions, and actionable study notes.\n"
        "NEVER just echo the user command. The 'text' field must contain structured synthesized knowledge.\n\n"
        "When the user requests an app action, output a structured JSON action block at the bottom of your response in this EXACT format:\n"
        "```json\n"
        "{\n"
        "  \"actions\": [\n"
        "    {\"type\": \"create_task\", \"title\": \"...\", \"folder\": \"...\", \"due\": \"...\", \"deadline\": \"...\"},\n"
        "    {\"type\": \"create_note\", \"text\": \"...\", \"color\": \"yellow\"},\n"
        "    {\"type\": \"start_timer\", \"minutes\": 25},\n"
        "    {\"type\": \"pause_timer\"},\n"
        "    {\"type\": \"reset_timer\"},\n"
        "    {\"type\": \"set_soundscape\", \"playing\": true, \"rain\": 0.7, \"brown_noise\": 0.5},\n"
        "    {\"type\": \"change_theme\", \"theme\": \"cyber\"}\n"
        "  ]\n"
        "}\n"
        "```\n"
        "Always provide natural, intelligent, comprehensive, and helpful academic explanations for math, science, SAT, essay planning, coding, and productivity advice."
    )

    contents = []
    contents.append({
        "role": "user",
        "parts": [{"text": f"[System Context]: {system_instruction}"}]
    })
    contents.append({
        "role": "model",
        "parts": [{"text": "Understood! I am the HDSFD AI Agent. I will answer any academic questions and execute app actions seamlessly."}]
    })

    for h in history_rows:
        role = "user" if h['role'] == 'user' else "model"
        contents.append({
            "role": role,
            "parts": [{"text": h['content']}]
        })

    contents.append({
        "role": "user",
        "parts": [{"text": prompt}]
    })

    generated_text = ""
    model_name = "gemini-2.0-flash"
    source = "built_in"

    # 1. Call via Google OAuth Access Token (Gemini 2.0 Flash / 1.5 Flash)
    if not is_guest and access_token:
        try:
            import requests
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            payload = {
                "contents": contents,
                "generationConfig": { "temperature": 0.7, "maxOutputTokens": 2048 }
            }
            for model_candidate in ["gemini-flash-latest", "gemini-2.0-flash", "gemini-1.5-flash"]:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent"
                res = requests.post(url, headers=headers, json=payload, timeout=20)
                if res.status_code == 200:
                    result_json = res.json()
                    candidates = result_json.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        generated_text = "".join(p.get("text", "") for p in parts)
                        model_name = model_candidate
                        source = "google_oauth_api"
                        break
        except Exception as e:
            logger.warning(f"OAuth Generative AI call error: {e}")

    # 2. Call via Load-Balanced Gemini API Key Pool (Round-Robin & Automatic Quota Failover)
    if not is_guest and not generated_text:
        key_candidates = get_ordered_key_candidates(api_key)
        import requests
        payload = {
            "contents": contents,
            "generationConfig": { "temperature": 0.7, "maxOutputTokens": 2048 }
        }
        for candidate_key in key_candidates:
            if generated_text:
                break
            for model_candidate in ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-2.0-flash", "gemini-1.5-flash"]:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent?key={candidate_key}"
                    res = requests.post(url, json=payload, timeout=20)
                    if res.status_code == 200:
                        result_json = res.json()
                        candidates = result_json.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            generated_text = "".join(p.get("text", "") for p in parts)
                            if generated_text:
                                model_name = model_candidate
                                source = "google_api_key_pool"
                                break
                    elif res.status_code in [429, 403, 500, 503]:
                        logger.warning(f"Key candidate status {res.status_code}, automatically failing over to next pool key...")
                        break
                except Exception as ex:
                    logger.warning(f"API key candidate error: {ex}")
                    break

    # 3. Dynamic Natural Language Agent Engine for Instant Context-Aware Answers
    if not generated_text:
        lower = prompt.lower().strip()
        actions = []

        # Intent: Create/Add Task
        if any(w in lower for w in ['task', 'assignment', 'hw', 'homework', 'todo', 'due']) and any(w in lower for w in ['add', 'create', 'schedule', 'set', 'make', 'put', 'need', 'task:']):
            raw_title = prompt
            for remove_word in ['add a task to:', 'add a task to', 'add a task:', 'add a task', 'add task:', 'add task to', 'add task', 'create task:', 'create a task:', 'create task', 'create a task', 'schedule a task:', 'schedule task:', 'schedule a task', 'schedule task', 'task:', 'please add', 'please create']:
                if raw_title.lower().startswith(remove_word):
                    raw_title = raw_title[len(remove_word):].strip(': ').strip()

            clean_title = raw_title.split('in ')[0].split('due ')[0].strip() or 'Study Assignment'
            clean_title = clean_title[0].upper() + clean_title[1:] if len(clean_title) > 1 else 'Study Session'
            
            folder = 'General'
            if 'chem' in lower: folder = 'Chemistry'
            elif 'math' in lower or 'calc' in lower or 'algebra' in lower: folder = 'Math'
            elif 'sat' in lower: folder = 'HW SAT'
            elif 'physic' in lower: folder = 'Physics'
            elif 'bio' in lower: folder = 'Biology'
            elif 'history' in lower: folder = 'History'

            due_date = 'Tomorrow 5:00 PM'
            if 'today' in lower: due_date = 'Today 8:00 PM'
            elif 'friday' in lower: due_date = 'Friday 5:00 PM'
            elif 'monday' in lower: due_date = 'Monday 9:00 AM'

            actions.append({
                "type": "create_task",
                "title": clean_title,
                "folder": folder,
                "due": due_date,
                "deadline": ""
            })
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = (
                f"✅ **Task Created:** I've added **\"{clean_title}\"** to your **{folder}** folder due **{due_date}**!\n\n"
                f"It is now synced with your Task lists, Calendar grid, and Google Tasks.\n\n"
                f"```json\n{action_json}\n```"
            )

        # Intent: Create Sticky Note
        elif any(w in lower for w in ['note', 'sticky', 'post-it', 'postit', 'pad']) and any(w in lower for w in ['create', 'add', 'make', 'write', 'put', 'stick', 'generate']):
            color = 'yellow'
            if 'pink' in lower: color = 'pink'
            elif 'blue' in lower or 'cyan' in lower: color = 'blue'
            elif 'green' in lower: color = 'green'
            elif 'purple' in lower: color = 'purple'

            # Extract the actual topic from the prompt
            topic_raw = prompt
            for strip_prefix in [
                'create a yellow sticky note:', 'create a pink sticky note:', 'create a blue sticky note:',
                'create a green sticky note:', 'create a purple sticky note:',
                'create a yellow sticky note about', 'create a pink sticky note about',
                'create a blue sticky note about', 'create a green sticky note about',
                'create a purple sticky note about',
                'create a sticky note:', 'create a sticky note about',
                'create a note:', 'create a note about',
                'add a sticky note:', 'add a sticky note about',
                'add a note:', 'add a note about',
                'make a sticky note:', 'make a sticky note about',
                'make a note:', 'make a note about',
                'write a sticky note:', 'write a sticky note about',
                'write a note:', 'write a note about',
                'sticky note:', 'sticky note about',
                'note:', 'note about',
            ]:
                if topic_raw.lower().startswith(strip_prefix):
                    topic_raw = topic_raw[len(strip_prefix):].strip()
                    break

            topic_lower = topic_raw.lower().strip()
            topic_title = topic_raw.strip()
            if topic_title:
                topic_title = topic_title[0].upper() + topic_title[1:]

            # Comprehensive academic knowledge base for offline note generation
            knowledge = {
                'calculus': ("📈 Calculus Rules", "• Power: (xⁿ)' = n·xⁿ⁻¹\n• Product: (uv)' = u'v + uv'\n• Quotient: (u/v)' = (u'v - uv') / v²\n• Chain: [f(g(x))]' = f'(g(x))·g'(x)\n• ∫xⁿ dx = xⁿ⁺¹/(n+1) + C"),
                'derivative': ("📈 Calculus Rules", "• Power: (xⁿ)' = n·xⁿ⁻¹\n• Product: (uv)' = u'v + uv'\n• Quotient: (u/v)' = (u'v - uv') / v²\n• Chain: [f(g(x))]' = f'(g(x))·g'(x)"),
                'integral': ("📈 Integration Rules", "• ∫xⁿ dx = xⁿ⁺¹/(n+1) + C\n• ∫eˣ dx = eˣ + C\n• ∫sin(x) dx = -cos(x) + C\n• ∫1/x dx = ln|x| + C\n• u-Substitution & Integration by Parts"),
                'quadratic': ("📐 Quadratic Formula", "• x = (-b ± √(b² - 4ac)) / (2a)\n• Vertex: x = -b / (2a)\n• Δ = b² - 4ac (Discriminant)\n• Δ > 0 → two real roots\n• Δ = 0 → one repeated root\n• Δ < 0 → no real roots"),
                'trigonometry': ("📐 Trigonometry", "• sin²θ + cos²θ = 1\n• tan θ = sin θ / cos θ\n• Law of Sines: a/sinA = b/sinB\n• Law of Cosines: c² = a² + b² - 2ab·cosC\n• Unit Circle: 0°, 30°, 45°, 60°, 90°"),
                'algebra': ("📐 Algebra Essentials", "• Slope: m = (y₂-y₁)/(x₂-x₁)\n• Slope-intercept: y = mx + b\n• Point-slope: y - y₁ = m(x - x₁)\n• Distance: d = √[(x₂-x₁)² + (y₂-y₁)²]\n• Midpoint: ((x₁+x₂)/2, (y₁+y₂)/2)"),
                'kinematic': ("⚡ Kinematics Equations", "• v = v₀ + at\n• Δx = v₀t + ½at²\n• v² = v₀² + 2aΔx\n• Δx = ½(v₀ + v)t\n• Free fall: a = g = 9.8 m/s²"),
                'physics': ("⚡ Physics Fundamentals", "• F = ma (Newton's 2nd Law)\n• W = F·d·cosθ (Work)\n• KE = ½mv² (Kinetic Energy)\n• PE = mgh (Potential Energy)\n• p = mv (Momentum)"),
                'newton': ("⚡ Newton's Laws", "• 1st: Object at rest stays at rest (inertia)\n• 2nd: F_net = m·a\n• 3rd: Every action has equal & opposite reaction\n• Weight: W = mg\n• Friction: f = μ·N"),
                'electricity': ("⚡ Electricity & Circuits", "• V = IR (Ohm's Law)\n• P = IV = I²R = V²/R\n• Series: R_total = R₁ + R₂ + ...\n• Parallel: 1/R = 1/R₁ + 1/R₂ + ...\n• Coulomb's Law: F = kq₁q₂/r²"),
                'chemistry': ("🧪 Chemistry Principles", "• Ideal Gas: PV = nRT\n• Molarity = mol / L\n• pH = -log[H⁺]\n• ΔG = ΔH - TΔS\n• Avogadro: 6.022 × 10²³"),
                'periodic': ("🧪 Periodic Table Trends", "• Electronegativity ↑ across, ↓ down\n• Atomic radius ↓ across, ↑ down\n• Ionization energy ↑ across, ↓ down\n• Metals (left) → Nonmetals (right)\n• Noble gases: full valence shells"),
                'organic': ("🧪 Organic Chemistry", "• Alkanes: CₙH₂ₙ₊₂ (single bonds)\n• Alkenes: CₙH₂ₙ (double bonds)\n• Alkynes: CₙH₂ₙ₋₂ (triple bonds)\n• Functional groups: -OH, -COOH, -NH₂\n• Isomers: same formula, different structure"),
                'biology': ("🧬 Biology Core", "• Cell: membrane → cytoplasm → nucleus\n• Mitosis: PMAT (Prophase, Metaphase, Anaphase, Telophase)\n• DNA: A-T, G-C base pairing\n• Central Dogma: DNA → RNA → Protein\n• ATP: cellular energy currency"),
                'plant': ("🌱 Plant Biology", "• Primary Growth — elongation at root/shoot tips via apical meristems\n• Secondary Growth — thickening via lateral meristems (vascular & cork cambium)\n• Photosynthesis: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂\n• Xylem: water up | Phloem: sugars down\n• Tropisms: photo- (light), gravi- (gravity), thigmo- (touch)"),
                'photosynthesis': ("🌱 Photosynthesis", "• Overall: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂\n• Light Reactions: thylakoid membranes → ATP + NADPH + O₂\n• Calvin Cycle: stroma → G3P → glucose\n• Chlorophyll absorbs red & blue light\n• Factors: light intensity, CO₂, temperature"),
                'cell': ("🧬 Cell Biology", "• Prokaryotic: no nucleus (bacteria)\n• Eukaryotic: membrane-bound nucleus\n• Mitochondria: powerhouse (ATP)\n• Ribosomes: protein synthesis\n• Cell membrane: phospholipid bilayer"),
                'genetics': ("🧬 Genetics", "• Genotype vs Phenotype\n• Dominant (AA, Aa) vs Recessive (aa)\n• Punnett Square: predict offspring ratios\n• Mendel's Laws: segregation & independent assortment\n• Codominance, Incomplete dominance, Sex-linked"),
                'evolution': ("🧬 Evolution", "• Natural Selection: variation → competition → survival → reproduction\n• Adaptation: traits that improve fitness\n• Speciation: geographic or reproductive isolation\n• Evidence: fossils, homologous structures, DNA\n• Hardy-Weinberg: p² + 2pq + q² = 1"),
                'ecology': ("🌍 Ecology", "• Food Chain: producer → consumer → decomposer\n• Trophic Levels: 10% energy transfer rule\n• Biomes: tundra, forest, desert, grassland, aquatic\n• Carbon/Nitrogen/Water cycles\n• Biodiversity & conservation"),
                'sat': ("📖 SAT Strategy", "• Eliminate 3 wrong choices first\n• Reading: find evidence in passage\n• Writing: FANBOYS, semicolons, commas\n• Math: backsolve with answer choices\n• No penalty for guessing — answer everything"),
                'essay': ("✏️ Essay Structure", "• Intro: hook → context → thesis\n• Body ¶: topic sentence → evidence → analysis → transition\n• Conclusion: restate thesis → broader significance\n• Use specific examples & quotes\n• Proofread for grammar & flow"),
                'history': ("📜 Key History Concepts", "• Cause & Effect analysis\n• Primary vs Secondary sources\n• Periodization & continuity vs change\n• Comparison across civilizations\n• Historical argumentation & evidence"),
                'world war': ("📜 World Wars", "• WWI (1914-1918): alliances, assassination of Franz Ferdinand, trench warfare, Treaty of Versailles\n• WWII (1939-1945): Axis vs Allies, Holocaust, D-Day, atomic bombs\n• Causes: nationalism, imperialism, militarism\n• Effects: UN founded, Cold War begins"),
                'statistics': ("📊 Statistics", "• Mean = Σx / n\n• Median = middle value\n• Mode = most frequent value\n• Std Dev = √(Σ(x-μ)²/n)\n• Normal Distribution: 68-95-99.7 rule"),
                'geometry': ("📐 Geometry", "• Area circle: πr²  |  Circumference: 2πr\n• Area triangle: ½bh\n• Pythagorean: a² + b² = c²\n• Volume sphere: (4/3)πr³\n• Sum of angles in triangle: 180°"),
            }

            note_body = None

            # Search knowledge base for matching topic
            for keyword, (title, content) in knowledge.items():
                if keyword in topic_lower:
                    note_body = f"{title}:\n{content}"
                    break

            # If no match found, generate a structured note from the topic itself
            if not note_body:
                if topic_title and len(topic_title) > 2:
                    note_body = f"📝 {topic_title}:\n• Key definition & overview\n• Main categories or types\n• Important examples & applications\n• Connections to related concepts\n• Review questions to test understanding"
                else:
                    note_body = "📝 Study Notes:\n• Key concepts\n• Important formulas\n• Review definitions\n• Practice problems"

            actions.append({
                "type": "create_note",
                "text": note_body,
                "color": color
            })
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = (
                f"📌 **Sticky Note Added:** I've created a **{color} sticky note** on your board with your requested notes:\n\n"
                f"> {note_body}\n\n"
                f"```json\n{action_json}\n```"
            )

        # Intent: Start / Control Pomodoro Timer
        elif any(w in lower for w in ['timer', 'pomodoro', 'focus session', 'clock', 'countdown']):
            if 'pause' in lower or 'stop' in lower:
                actions.append({"type": "pause_timer"})
                action_json = json.dumps({"actions": [{"type": "pause_timer"}]})
                generated_text = f"⏸ **Pomodoro Paused:** You can resume your session at any time.\n\n```json\n{action_json}\n```"
            elif 'reset' in lower or 'clear' in lower:
                actions.append({"type": "reset_timer"})
                action_json = json.dumps({"actions": [{"type": "reset_timer"}]})
                generated_text = f"🔄 **Timer Reset:** Chronometer returned to initial duration.\n\n```json\n{action_json}\n```"
            else:
                import re
                mins_match = re.search(r'(\d+)\s*(?:min|m|minute)', lower)
                minutes = int(mins_match.group(1)) if mins_match else 25
                actions.append({
                    "type": "start_timer",
                    "minutes": minutes
                })
                action_json = json.dumps({"actions": [{"type": "start_timer", "minutes": minutes}]})
                generated_text = (
                    f"⏱ **Focus Session Started:** Set your Pomodoro chronometer to **{minutes} minutes**!\n\n"
                    f"Let's dive into deep, uninterrupted study.\n\n"
                    f"```json\n{action_json}\n```"
                )

        # Intent: Play YouTube Song / Playlist
        elif any(w in lower for w in ['play song', 'play track', 'play youtube', 'play music', 'play lofi', 'play mozart', 'play piano', 'play jazz', 'play rain music']) or (lower.startswith('play ') and not 'game' in lower and not 'soundscape' in lower):
            song_query = prompt
            for strip_prefix in ['play song:', 'play song', 'play music:', 'play music', 'play youtube:', 'play youtube', 'play track:', 'play track', 'play:', 'play', 'listen to']:
                if song_query.lower().startswith(strip_prefix):
                    song_query = song_query[len(strip_prefix):].strip()
                    break
            actions.append({
                "type": "play_youtube",
                "song": song_query or "lofi study beats",
                "query": song_query or "lofi"
            })
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = f"🎵 **Playing Track:** Now streaming **\"{song_query or 'Lofi Study Beats'}\"** via the YouTube player in Tab 1!\n\n```json\n{action_json}\n```"

        # Intent: Create/Schedule Exam
        elif any(w in lower for w in ['exam', 'midterm', 'final', 'quiz', 'test', 'assessment']) and any(w in lower for w in ['add', 'create', 'schedule', 'set']):
            exam_title = prompt
            for strip_prefix in ['add exam:', 'add exam', 'schedule exam:', 'schedule exam', 'create exam:', 'create exam', 'add midterm:', 'schedule midterm:']:
                if exam_title.lower().startswith(strip_prefix):
                    exam_title = exam_title[len(strip_prefix):].strip()
                    break
            import datetime
            exam_date = (datetime.date.today() + datetime.timedelta(days=7)).strftime('%Y-%m-%d')
            actions.append({
                "type": "create_exam",
                "title": exam_title or "Exam",
                "date": exam_date,
                "time": "09:00",
                "reward": 250
            })
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = f"🎯 **Exam Scheduled:** Added **\"{exam_title or 'Exam'}\"** on **{exam_date}** with a **+250 🪙** completion reward! Matching study folder created.\n\n```json\n{action_json}\n```"

        # Intent: Soundscape Audio
        elif any(w in lower for w in ['rain', 'sound', 'audio', 'soundscape', 'noise', 'brown noise']):
            actions.append({
                "type": "set_soundscape",
                "playing": True,
                "rain": 0.8,
                "brown_noise": 0.4
            })
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = f"🎧 **Soundscape Activated:** Rain set to 80% and Brown Noise to 40% for optimal focus alpha wave states.\n\n```json\n{action_json}\n```"

        # Intent: Theme Change
        elif 'theme' in lower or any(t in lower for t in ['obsidian', 'cyberpunk', 'cyber theme', 'ocean theme', 'sunset theme', 'forest theme', 'aurora theme', 'rose theme']):
            chosen = 'midnight'
            if 'obsidian' in lower: chosen = 'obsidian'
            elif 'cyber' in lower or 'cyberpunk' in lower or 'synthwave' in lower or 'neon' in lower: chosen = 'cyber'
            elif 'ocean' in lower or 'blue' in lower or 'aqua' in lower or 'teal' in lower: chosen = 'ocean'
            elif 'sunset' in lower or 'orange' in lower or 'warm' in lower: chosen = 'sunset'
            elif 'forest' in lower or 'green' in lower or 'nature' in lower or 'emerald' in lower: chosen = 'forest'
            elif 'aurora' in lower or 'northern' in lower: chosen = 'aurora'
            elif 'rose' in lower or 'pink' in lower or 'berry' in lower: chosen = 'rose'
            
            actions.append({"type": "change_theme", "theme": chosen})
            action_json = json.dumps({"actions": [actions[0]]})
            generated_text = f"🎨 **Theme Updated:** Switched workspace appearance to **{chosen.capitalize()}**.\n\n```json\n{action_json}\n```"

        # Intent: Features / Help / Capabilities
        elif any(w in lower for w in ['feature', 'what can you do', 'what do you do', 'help me', 'actions you can do', 'capabilities', 'hdsfd features', 'guide']):
            generated_text = (
                "✨ **HDSFD Workspace Overview & AI Agent Capabilities:**\n\n"
                "I am your real-time **AI Study Agent**, directly linked with all workspace tools:\n\n"
                "### 1. ⏱ Focus Sanctuary (Tab 1)\n"
                "• **Pomodoro Chronometer:** Custom durations (e.g., *\"Start a 25m timer\"*), presets, and pause/reset controls.\n"
                "• **Soundscape Audio:** Background Rain volume, Brown Noise synthesis, and integrated YouTube player.\n"
                "• **Zen Mode:** Fullscreen distraction-free focus mode with floating quick-controls.\n\n"
                "### 2. 📋 Tasks & Calendar (Tab 2)\n"
                "• **Split-View Workspace:** Interactive dark monthly calendar grid on the left and hierarchical task manager on the right.\n"
                "• **Direct AI Task Creation:** Say *\"Add task to review chemistry notes due Friday in Chem\"*.\n"
                "• **Google Tasks Sync:** Instant two-way synchronization with your Google Tasks account.\n\n"
                "### 3. 📌 Interactive Sticky Notes (Tab 3)\n"
                "• **Physical Note Board:** Draggable, resizable 3D notes with 5 pastel colors (Yellow, Pink, Blue, Green, Purple).\n"
                "• **Direct AI Note Creation:** Say *\"Make a blue sticky note with calculus derivative rules\"*.\n"
                "• **Dual Mode:** Type or switch to vector drawing mode (✏️) to sketch math graphs.\n\n"
                "### 4. ⚙️ Settings & Themes (Tab 4)\n"
                "• **Themes:** Midnight, Obsidian, Cyber, and Sunset themes (*\"Change theme to cyber\"*).\n"
                "• **Google Cloud Backup:** Automatic encrypted backup of your database to Google Drive.\n\n"
                "Feel free to ask me any study question or command me to control any part of your workspace!"
            )

        # Intent: Greetings & Conversational Queries
        elif lower in ['hi', 'hello', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening', 'how are you', 'sup']:
            generated_text = (
                "👋 **Hello! How can I help with your studies today?**\n\n"
                "I can solve math/science problems, summarize concepts, outline essays, or directly manage your workspace:\n\n"
                "• 📋 **Tasks:** *\"Add task to study calculus due tomorrow\"*\n"
                "• 📌 **Sticky Notes:** *\"Create a sticky note about photosynthesis\"*\n"
                "• ⏱ **Pomodoro Timer:** *\"Start a 25m focus timer\"*\n"
                "• 🎨 **Themes:** *\"Change theme to obsidian\"*\n"
                "• 🕒 **Schedule:** *\"Add AP Calculus to my schedule on Mon/Wed at 9am\"*"
            )

        # Intent: Study Techniques & Productivity Advice
        elif any(w in lower for w in ['how to study', 'study technique', 'active recall', 'spaced repetition', 'feynman', 'memorize', 'focus better', 'procrastination', 'exam prep', 'study routine']):
            generated_text = (
                "🎯 **High-Yield Study & Focus Techniques:**\n\n"
                "1. **Active Recall:** Instead of passive re-reading, close your notes and write out everything you recall from memory (or test with flashcards).\n"
                "2. **Spaced Repetition:** Review material at increasing intervals (Day 1 → Day 3 → Day 7 → Day 14) to flatten the forgetting curve.\n"
                "3. **Feynman Technique:** Explain the concept in simple words as if teaching a 10-year-old. Wherever you get stuck, re-read that exact section.\n"
                "4. **Pomodoro Protocol:** 25-50 min deep work + 5-10 min pure break. No phone/multitasking during sessions.\n"
                "5. **Interleaving:** Mix different problem types instead of doing 50 of the exact same question."
            )

        # Intent: Academic Subject Specific Inquiries
        elif any(w in lower for w in ['mitosis', 'meiosis', 'dna', 'rna', 'cell', 'photosynthesis', 'respiration', 'plant', 'genetics', 'evolution', 'ecology']):
            if 'mitosis' in lower or 'meiosis' in lower:
                generated_text = (
                    "🧬 **Mitosis vs. Meiosis Summary:**\n\n"
                    "• **Mitosis (PMAT):** Produces 2 identical diploid (2n) somatic cells for growth and repair.\n"
                    "  - **Prophase:** Chromosomes condense, nuclear envelope dissolves.\n"
                    "  - **Metaphase:** Chromosomes line up at the equatorial plate (middle).\n"
                    "  - **Anaphase:** Sister chromatids pulled to opposite poles.\n"
                    "  - **Telophase:** Nuclear membranes reform; cytokinesis splits cell.\n"
                    "• **Meiosis:** 2 rounds of division yielding 4 genetically unique haploid (1n) gametes; crossing over occurs in Prophase I."
                )
            elif 'photosynthesis' in lower:
                generated_text = (
                    "🌱 **Photosynthesis Mechanism:**\n\n"
                    "\\[6\\text{CO}_2 + 6\\text{H}_2\\text{O} + \\text{light} \\longrightarrow \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2\\]\n\n"
                    "1. **Light Reactions (Thylakoid):** Solar energy splits \\(\\text{H}_2\\text{O}\\), generating \\(\\text{ATP}\\), \\(\\text{NADPH}\\), and releasing \\(\\text{O}_2\\).\n"
                    "2. **Calvin Cycle (Stroma):** Fixes \\(\\text{CO}_2\\) using \\(\\text{ATP}\\) & \\(\\text{NADPH}\\) into G3P sugar (glucose precursor)."
                )
            else:
                generated_text = (
                    "🧬 **Core Biological Concept Summary:**\n\n"
                    "• **Central Dogma:** \\(\\text{DNA} \\xrightarrow{\\text{Transcription}} \\text{mRNA} \\xrightarrow{\\text{Translation}} \\text{Protein}\\)\n"
                    "• **Cell Energy:** Cellular respiration converts glucose into ATP: \\(\\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2 \\rightarrow 6\\text{CO}_2 + 6\\text{H}_2\\text{O} + \\sim 32\\text{ ATP}\\)\n"
                    "• **Structure:** Phospholipid bilayer membrane controls homeostatic transport (diffusion, osmosis, active transport)."
                )

        # Intent: Math / Formulas / Science
        elif any(w in lower for w in ['quadratic', 'formula', 'calculus', 'integral', 'derivative', 'physics', 'chemistry', 'algebra', 'sat', 'equation', 'trig', 'pythagorean']):
            if 'quadratic' in lower:
                generated_text = (
                    "📐 **Quadratic Formula & Root Analysis:**\n\n"
                    "\\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]\n\n"
                    "• **Discriminant (\\(\\Delta = b^2 - 4ac\\)):**\n"
                    "  - \\(\\Delta > 0\\): Two distinct real roots.\n"
                    "  - \\(\\Delta = 0\\): One repeated real root (parabola vertex on axis).\n"
                    "  - \\(\\Delta < 0\\): Two complex conjugate solutions.\n"
                    "• **Vertex Formula:** \\(x_v = -\\frac{b}{2a}\\)"
                )
            elif 'derivative' in lower or 'calculus' in lower:
                generated_text = (
                    "📈 **Essential Calculus Derivative Rules:**\n\n"
                    "1. **Power Rule:** \\(\\frac{d}{dx}[x^n] = n x^{n-1}\\)\n"
                    "2. **Product Rule:** \\((uv)' = u'v + uv'\\)\n"
                    "3. **Quotient Rule:** \\((\\frac{u}{v})' = \\frac{u'v - uv'}{v^2}\\)\n"
                    "4. **Chain Rule:** \\(\\frac{d}{dx}[f(g(x))] = f'(g(x)) \\cdot g'(x)\\)\n"
                    "5. **Exponential:** \\(\\frac{d}{dx}[e^x] = e^x\\), \\(\\frac{d}{dx}[\\ln(x)] = \\frac{1}{x}\\)"
                )
            elif 'physics' in lower or 'kinematic' in lower or 'newton' in lower:
                generated_text = (
                    "⚡ **Key Physics & Mechanics Equations:**\n\n"
                    "• **Kinematics:**\n"
                    "  - \\(v = v_0 + at\\)\n"
                    "  - \\(\\Delta x = v_0 t + \\frac{1}{2}at^2\\)\n"
                    "  - \\(v^2 = v_0^2 + 2a\\Delta x\\)\n"
                    "• **Newton's Laws:** \\(F_{\\text{net}} = m \\cdot a\\), \\(W = m \\cdot g\\)\n"
                    "• **Energy:** \\(KE = \\frac{1}{2}mv^2\\), \\(PE = mgh\\), \\(W = F \\cdot d \\cdot \\cos\\theta\\)"
                )
            elif 'chem' in lower:
                generated_text = (
                    "🧪 **Core Chemistry Principles & Gas Laws:**\n\n"
                    "• **Ideal Gas Law:** \\(PV = nRT\\) (\\(R = 0.0821\\text{ L}\\cdot\\text{atm}/(\\text{mol}\\cdot\\text{K})\\))\n"
                    "• **Molarity:** \\(M = \\frac{\\text{moles of solute}}{\\text{liters of solution}}\\)\n"
                    "• **pH Calculation:** \\(\\text{pH} = -\\log[\\text{H}^+]\\), \\(\\text{pH} + \\text{pOH} = 14\\)\n"
                    "• **Gibbs Free Energy:** \\(\\Delta G = \\Delta H - T\\Delta S\\) (\\(\\Delta G < 0\\) is spontaneous)"
                )
            else:
                generated_text = (
                    "📐 **Key Mathematical Principles & Methods:**\n\n"
                    "• **Pythagorean Theorem:** \\(a^2 + b^2 = c^2\\) (right triangles)\n"
                    "• **Slope-Intercept:** \\(y = mx + b\\) where \\(m = \\frac{y_2 - y_1}{x_2 - x_1}\\)\n"
                    "• **Distance Formula:** \\(d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}\\)\n"
                    "• **Logarithm Laws:** \\(\\log(ab) = \\log(a) + \\log(b)\\), \\(\\log(a^k) = k\\log(a)\\)"
                )

        # General Knowledge & Conceptual Inquiries (Natural Conversational Style)
        else:
            clean_q = prompt.strip().rstrip('?').strip()
            generated_text = (
                f"📚 **Key Information & Analysis on \"{clean_q}\":**\n\n"
                f"• **Overview:** When analyzing *{clean_q}*, break down the subject into its foundational components and core definitions.\n"
                f"• **Key Concepts:** Identify the cause-and-effect relationships, critical variables, and real-world examples.\n"
                f"• **Practical Study Application:** Test yourself on this topic using active recall or summarize the main takeaways in your own words.\n\n"
                f"💡 *Tip: You can ask me to create a sticky note summary of this on your board, set a study task, or start a timer!*"
            )

    # Extract structured actions from generated text if present
    parsed_actions = []
    import re
    json_match = re.search(r'```json\s*(\{.*?\})\s*```', generated_text, re.DOTALL)
    if json_match:
        try:
            parsed_block = json.loads(json_match.group(1))
            parsed_actions = parsed_block.get('actions', [])
        except Exception:
            pass

    # Save to SQLite chat history
    try:
        action_json_str = json.dumps(parsed_actions) if parsed_actions else None
        conn.execute(
            "INSERT INTO gemini_chat_history (username, role, content, action_data) VALUES (?, ?, ?, ?)",
            (username, 'user', prompt, None)
        )
        conn.execute(
            "INSERT INTO gemini_chat_history (username, role, content, action_data) VALUES (?, ?, ?, ?)",
            (username, 'model', generated_text, action_json_str)
        )
        conn.commit()
    except Exception as e:
        logger.warning(f"Error saving chat history: {e}")
    finally:
        conn.close()

    return jsonify({
        "status": "success",
        "text": generated_text,
        "actions": parsed_actions,
        "model": model_name,
        "source": source
    })

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

    if 'pythonanywhere.com' in request.host:
        redirect_uri = 'https://' + request.host + '/api/gdrive/callback'
    else:
        redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'

    scopes = [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/tasks'
    ]
    
    import secrets
    state_token = secrets.token_urlsafe(16)
    
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(scopes),
        'state': state_token,
        'prompt': 'select_account consent',
        'access_type': 'offline',
        'include_granted_scopes': 'true'
    }
    google_auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params)
    return redirect(google_auth_url)

@app.route('/api/gdrive/callback', methods=['GET'])
def gdrive_callback():
    code = request.args.get('code')
    
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

    if 'pythonanywhere.com' in request.host:
        redirect_uri = 'https://' + request.host + '/api/gdrive/callback'
    else:
        redirect_uri = request.url_root.rstrip('/') + '/api/gdrive/callback'

    user_email = ''
    user_name = ''

    if code and client_id and client_secret:
        try:
            from google_auth_oauthlib.flow import Flow
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

            auth_response_url = request.url
            if auth_response_url.startswith('http://') and 'pythonanywhere.com' in request.host:
                auth_response_url = 'https://' + auth_response_url[7:]

            flow.fetch_token(authorization_response=auth_response_url)
            creds = flow.credentials

            # 1. Decode ID Token directly for instant user email and name
            if hasattr(creds, 'id_token') and creds.id_token:
                try:
                    parts = creds.id_token.split('.')
                    if len(parts) >= 2:
                        p_b64 = parts[1] + '=' * (-len(parts[1]) % 4)
                        id_payload = json.loads(base64.urlsafe_b64decode(p_b64).decode('utf-8'))
                        user_email = id_payload.get('email', '')
                        user_name = id_payload.get('name', '') or id_payload.get('given_name', '')
                except Exception as ex:
                    logger.warning(f"Error decoding ID token: {ex}")

            # 2. Secondary check via userinfo endpoint if needed
            if not user_email or not user_name:
                try:
                    import requests
                    u_res = requests.get(
                        'https://www.googleapis.com/oauth2/v2/userinfo',
                        headers={'Authorization': f'Bearer {creds.token}'},
                        timeout=10
                    )
                    if u_res.status_code == 200:
                        u_data = u_res.json()
                        user_email = user_email or u_data.get('email', '')
                        user_name = user_name or u_data.get('name', '') or u_data.get('given_name', '')
                except Exception as ex:
                    logger.warning(f"Error calling userinfo: {ex}")

            # 3. Fallback name to formatted email prefix if user_name is blank
            if not user_name and user_email and '@' in user_email:
                prefix = user_email.split('@')[0]
                user_name = prefix.replace('.', ' ').replace('_', ' ').replace('-', ' ').title()

            if user_email:
                save_user_tokens(user_email, creds, user_name)
        except Exception as e:
            logger.error(f"Google OAuth token exchange failed: {e}")

    display_label = user_name or (user_email.split('@')[0].replace('.', ' ').title() if '@' in user_email else "Google User")

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Google Account Connected</title>
  <style>
    body {{ background: #0f172a; color: white; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
    .card {{ background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); padding: 32px; border-radius: 24px; text-align: center; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }}
    h2 {{ color: #c084fc; margin: 12px 0 8px 0; font-size: 22px; }}
    p {{ color: #cbd5e1; font-size: 14px; margin: 0 0 16px 0; }}
    .pill {{ background: rgba(168,85,247,0.2); border: 1px solid rgba(168,85,247,0.4); padding: 4px 12px; border-radius: 20px; color: #e9d5ff; font-weight: bold; }}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 44px;">✨</div>
    <h2>Google Connected!</h2>
    <p>Logged in as <span class="pill">{display_label}</span></p>
    <p style="color: #94a3b8; font-size: 12px;">Returning to your sanctuary...</p>
  </div>
  <script>
    const userEmail = {json.dumps(user_email)};
    const userName = {json.dumps(user_name or display_label)};
    
    if (userEmail && userEmail.indexOf('@') !== -1) {{
      localStorage.setItem('hdsfd_google_account', userEmail);
      localStorage.setItem('hdsfd_google_name', userName);
      localStorage.setItem('hdsfd_user_name', userName);
    }}
    
    const authData = {{
      type: 'gdrive_linked',
      username: userEmail,
      name: userName
    }};
    
    if (window.opener && !window.opener.closed) {{
      try {{
        window.opener.postMessage(authData, '*');
      }} catch (e) {{}}
      setTimeout(() => {{ window.close(); }}, 1000);
    }} else {{
      setTimeout(() => {{
        window.location.href = '/?google_account=' + encodeURIComponent(userEmail) + '&name=' + encodeURIComponent(userName);
      }}, 1000);
    }}
  </script>
</body>
</html>"""
    return html

@app.route('/api/gdrive/backup', methods=['POST'])
def gdrive_backup():
    data = request.json or {}
    username = data.get('username', 'GoogleUser')
    notes = data.get('notes', [])
    
    backup_dir = os.path.join(os.path.dirname(__file__), 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    notes_backup_file = os.path.join(backup_dir, f'Notes_{username}.json')
    with open(notes_backup_file, 'w') as f:
        json.dump(notes, f, indent=2)
        
    creds = get_google_credentials(username)
    drive_synced = False
    
    if creds:
        try:
            from googleapiclient.discovery import build
            from googleapiclient.http import MediaFileUpload, MediaInMemoryUpload
            service = build('drive', 'v3', credentials=creds)
            
            folder_name = 'HDSFD Backup'
            q = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            response = service.files().list(q=q, spaces='drive', fields='files(id, name)').execute()
            folders = response.get('files', [])
            
            if folders:
                folder_id = folders[0].get('id')
            else:
                folder_metadata = {
                    'name': folder_name,
                    'mimeType': 'application/vnd.google-apps.folder'
                }
                folder = service.files().create(body=folder_metadata, fields='id').execute()
                folder_id = folder.get('id')
                
            # 1. Notes.json backup upload
            notes_body = json.dumps(notes, indent=2)
            media_notes = MediaInMemoryUpload(notes_body.encode('utf-8'), mimetype='application/json')
            
            file_q = f"name='Notes.json' and '{folder_id}' in parents and trashed=false"
            existing_notes = service.files().list(q=file_q, fields='files(id)').execute().get('files', [])
            
            if existing_notes:
                service.files().update(fileId=existing_notes[0]['id'], media_body=media_notes).execute()
            else:
                file_metadata = {'name': 'Notes.json', 'parents': [folder_id]}
                service.files().create(body=file_metadata, media_body=media_notes).execute()
                
            # 2. data.db SQLite database backup upload
            if os.path.exists(DB_PATH):
                media_db = MediaFileUpload(DB_PATH, mimetype='application/x-sqlite3')
                db_q = f"name='data.db' and '{folder_id}' in parents and trashed=false"
                existing_db = service.files().list(q=db_q, fields='files(id)').execute().get('files', [])
                if existing_db:
                    service.files().update(fileId=existing_db[0]['id'], media_body=media_db).execute()
                else:
                    db_metadata = {'name': 'data.db', 'parents': [folder_id]}
                    service.files().create(body=db_metadata, media_body=media_db).execute()
                    
            drive_synced = True
        except Exception as e:
            logger.error(f"Google Drive Backup upload error: {e}")

    return jsonify({
        "status": "success",
        "drive_synced": drive_synced,
        "folder": "HDSFD Backup",
        "files": ["Notes.json", "data.db"],
        "message": f"Backup for {username} saved in isolated Google Drive folder 'HDSFD Backup'."
    })

def get_or_create_tasklist(service, folder_name):
    if not folder_name or folder_name.strip() == '':
        return '@default'
    folder_title = folder_name.strip()
    try:
        tasklists = service.tasklists().list().execute().get('items', [])
        for tl in tasklists:
            if tl.get('title', '').lower() == folder_title.lower():
                return tl.get('id')
        new_tl = service.tasklists().insert(body={'title': folder_title}).execute()
        return new_tl.get('id')
    except Exception as e:
        logger.error(f"Error getting/creating tasklist {folder_title}: {e}")
        return '@default'

@app.route('/api/google/tasks', methods=['GET', 'POST'])
def google_tasks_api():
    data = request.json or {} if request.method == 'POST' else {}
    username = request.args.get('username') or data.get('username') or 'Guest'
    creds = get_google_credentials(username)
    
    if request.method == 'POST':
        title = data.get('title', 'New Task')
        folder = data.get('folder', '')
        due_date = data.get('due_date')
        
        if creds:
            try:
                from googleapiclient.discovery import build
                service = build('tasks', 'v1', credentials=creds)
                tasklist_id = get_or_create_tasklist(service, folder)
                task_body = {
                    'title': title,
                    'notes': f"HDSFD Task - Folder: {folder}" if folder else "HDSFD Task"
                }
                if due_date:
                    if len(due_date) == 10: # YYYY-MM-DD
                        due_date = due_date + "T00:00:00.000Z"
                    elif not due_date.endswith('Z'):
                        due_date = due_date + ":00.000Z"
                    task_body['due'] = due_date

                created = service.tasks().insert(tasklist=tasklist_id, body=task_body).execute()
                return jsonify({"status": "success", "synced": True, "task": created, "tasklist_id": tasklist_id})
            except Exception as e:
                logger.error(f"Google Tasks insert failed: {e}")
        
        return jsonify({"status": "success", "synced": False, "task": {"title": title, "folder": folder, "due": due_date}})
    
    else:
        if creds:
            try:
                from googleapiclient.discovery import build
                service = build('tasks', 'v1', credentials=creds)
                tasklists = service.tasklists().list().execute().get('items', [])
                all_tasks = []
                for tl in tasklists:
                    tl_id = tl.get('id')
                    tl_title = tl.get('title', '')
                    folder_name = '' if tl_id == '@default' or tl_title == 'My Tasks' else tl_title
                    items = service.tasks().list(tasklist=tl_id).execute().get('items', [])
                    for item in items:
                        t_title = item.get('title', '')
                        if not t_title:
                            continue
                        all_tasks.append({
                            "id": item.get('id'),
                            "tasklist_id": tl_id,
                            "title": t_title,
                            "folder": folder_name,
                            "due": item.get('due', ''),
                            "completed": item.get('status') == 'completed'
                        })
                return jsonify(all_tasks)
            except Exception as e:
                logger.error(f"Google Tasks multi-list fetch failed: {e}")

        conn = get_db()
        rows = conn.execute("SELECT * FROM items WHERE username = ? AND type = 'task'", (username,)).fetchall()
        conn.close()
        return jsonify([json.loads(r['content']) for r in rows])

@app.route('/api/google/tasks/<task_id>', methods=['PUT', 'PATCH', 'DELETE'])
def update_google_task(task_id):
    data = request.json or {} if request.method in ['PUT', 'PATCH'] else {}
    username = request.args.get('username') or data.get('username') or 'Guest'
    tasklist_id = request.args.get('tasklist_id') or data.get('tasklist_id')
    creds = get_google_credentials(username)
    
    if creds:
        try:
            from googleapiclient.discovery import build
            service = build('tasks', 'v1', credentials=creds)
            
            # If tasklist_id is missing or @default, search tasklists to find where task_id resides
            if not tasklist_id or tasklist_id == '@default':
                tasklists = service.tasklists().list().execute().get('items', [])
                for tl in tasklists:
                    try:
                        t_item = service.tasks().get(tasklist=tl['id'], task=task_id).execute()
                        if t_item:
                            tasklist_id = tl['id']
                            break
                    except Exception:
                        pass
            
            tasklist_id = tasklist_id or '@default'
            
            if request.method == 'DELETE':
                service.tasks().delete(tasklist=tasklist_id, task=task_id).execute()
                return jsonify({"status": "success", "synced": True, "deleted": task_id})

            completed = data.get('completed', False)
            patch_body = {
                'status': 'completed' if completed else 'needsAction'
            }
            if completed:
                patch_body['completed'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            else:
                patch_body['completed'] = None
                
            updated = service.tasks().patch(tasklist=tasklist_id, task=task_id, body=patch_body).execute()
            return jsonify({"status": "success", "synced": True, "task": updated})
        except Exception as e:
            logger.error(f"Google Tasks update/delete failed: {e}")
            return jsonify({"status": "error", "message": str(e)}), 500
            
    return jsonify({"status": "success", "synced": False})

@app.route('/api/google/tasklists', methods=['GET'])
def get_google_tasklists():
    username = request.args.get('username') or 'Guest'
    creds = get_google_credentials(username)
    if creds:
        try:
            from googleapiclient.discovery import build
            service = build('tasks', 'v1', credentials=creds)
            tasklists = service.tasklists().list().execute().get('items', [])
            return jsonify([{"id": tl.get('id'), "title": tl.get('title')} for tl in tasklists])
        except Exception as e:
            logger.error(f"Google Tasklists fetch failed: {e}")
    return jsonify([{"id": "@default", "title": "My Tasks"}])

@app.route('/api/google/calendar', methods=['GET', 'POST'])
def google_calendar_api():
    data = request.json or {} if request.method == 'POST' else {}
    username = request.args.get('username') or data.get('username') or 'Guest'
    creds = get_google_credentials(username)
    
    if request.method == 'POST':
        summary = data.get('summary') or data.get('title') or 'Class / Study Session'
        start_date = data.get('start_date')
        start_time = data.get('start_time') or '09:00'
        end_time = data.get('end_time') or '10:15'
        days = data.get('days') or []
        location = data.get('location') or ''

        if creds:
            try:
                from googleapiclient.discovery import build
                service = build('calendar', 'v3', credentials=creds)

                # Day abbreviation mapping for Google Calendar RRULE
                day_map = {'Mon': 'MO', 'Tue': 'TU', 'Wed': 'WE', 'Thu': 'TH', 'Fri': 'FR', 'Sat': 'SA', 'Sun': 'SU'}

                if days:
                    rrule_days = [day_map[d] for d in days if d in day_map]
                    today = datetime.date.today()
                    # Start date base
                    start_dt_str = f"{today.isoformat()}T{start_time}:00"
                    end_dt_str = f"{today.isoformat()}T{end_time}:00"
                    event_body = {
                        'summary': summary,
                        'description': f'Class Schedule in HDSFD • Location: {location}' if location else 'Class Schedule in HDSFD',
                        'location': location,
                        'start': {'dateTime': start_dt_str, 'timeZone': 'UTC'},
                        'end': {'dateTime': end_dt_str, 'timeZone': 'UTC'},
                        'recurrence': [f'RRULE:FREQ=WEEKLY;BYDAY={",".join(rrule_days)}'] if rrule_days else ['RRULE:FREQ=WEEKLY']
                    }
                elif start_date:
                    if len(start_date) == 10:
                        event_body = {
                            'summary': summary,
                            'start': {'date': start_date},
                            'end': {'date': start_date}
                        }
                    else:
                        event_body = {
                            'summary': summary,
                            'start': {'dateTime': start_date},
                            'end': {'dateTime': start_date}
                        }
                else:
                    today = datetime.date.today().isoformat()
                    event_body = {
                        'summary': summary,
                        'start': {'dateTime': f"{today}T{start_time}:00"},
                        'end': {'dateTime': f"{today}T{end_time}:00"}
                    }

                created = service.events().insert(calendarId='primary', body=event_body).execute()
                return jsonify({"status": "success", "synced": True, "event": created})
            except Exception as e:
                logger.error(f"Google Calendar event insert failed: {e}")
        return jsonify({"status": "success", "synced": False, "event": {"summary": summary, "days": days}})
    
    else:
        if creds:
            try:
                from googleapiclient.discovery import build
                service = build('calendar', 'v3', credentials=creds)
                now = datetime.datetime.now(datetime.timezone.utc)
                min_time = (now - datetime.timedelta(days=30)).isoformat()
                max_time = (now + datetime.timedelta(days=90)).isoformat()
                events_result = service.events().list(
                    calendarId='primary',
                    timeMin=min_time,
                    timeMax=max_time,
                    maxResults=100,
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()
                events = events_result.get('items', [])
                result = []
                for event in events:
                    start = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date')
                    result.append({
                        "id": event.get('id'),
                        "summary": event.get('summary', 'Untitled Event'),
                        "start": start,
                        "htmlLink": event.get('htmlLink', 'https://calendar.google.com')
                    })
                return jsonify(result)
            except Exception as e:
                logger.error(f"Google Calendar fetch failed: {e}")
                
        return jsonify([
            {"id": "cal_1", "summary": "Chemistry Lab Exam", "start": "2026-08-15T10:00:00Z", "htmlLink": "https://calendar.google.com"},
            {"id": "cal_2", "summary": "Math Midterm Review", "start": "2026-08-22T14:00:00Z", "htmlLink": "https://calendar.google.com"}
        ])

if __name__ == '__main__':
    init_db()
    print("Starting HD SFD V2 Clean Server on http://localhost:5050...")
    app.run(port=5050, debug=False, use_reloader=False)

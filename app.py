from flask import Flask, request, jsonify, send_from_directory, redirect, session
import sqlite3
import os
import sys
import json
import logging
import urllib.parse
import datetime
import threading
import base64
import hashlib
import secrets
import uuid
from datetime import timedelta, timezone

try:
    from backend.school_connect import (
        SUPPORTED_PROVIDERS,
        clean_text,
        default_source_id,
        ensure_school_tables,
        new_source_id,
        now_iso,
        parse_import,
        public_source,
        record_payload,
        serialize_record,
        validate_source_payload,
    )
except ImportError:
    from school_connect import (
        SUPPORTED_PROVIDERS,
        clean_text,
        default_source_id,
        ensure_school_tables,
        new_source_id,
        now_iso,
        parse_import,
        public_source,
        record_payload,
        serialize_record,
        validate_source_payload,
    )

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

if os.environ.get('FLASK_ENV', '').lower() != 'production':
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

# No static folder on purpose: every public asset has an explicit route below.
# A '.' static folder would expose database.db, credentials and config files.
app = Flask(__name__, static_folder=None)
configured_secret = os.environ.get('FLASK_SECRET_KEY')
if not configured_secret and os.environ.get('FLASK_ENV', '').lower() == 'production':
    raise RuntimeError('FLASK_SECRET_KEY must be configured in production')
app.secret_key = configured_secret or os.environ.get('HDSFD_DEV_SECRET', 'hdsfd-local-development-secret')

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

# HDSFD_DB_PATH lets the integration suites run against a throwaway copy.
DB_PATH = os.environ.get('HDSFD_DB_PATH') or os.path.join(os.path.dirname(__file__), 'database.db')
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
            password_hash TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN password_hash TEXT')
    except Exception:
        pass
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    ensure_school_tables(conn)
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
    try:
        cursor.execute('ALTER TABLE user_tokens ADD COLUMN google_email TEXT')
    except Exception:
        pass
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS oauth_states (
            state_hash TEXT PRIMARY KEY,
            owner TEXT,
            expires_at TIMESTAMP NOT NULL
        )
    ''')
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
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_stats (
            username TEXT PRIMARY KEY,
            coins INTEGER DEFAULT 0,
            lifetime_xp INTEGER DEFAULT 0,
            focus_mins INTEGER DEFAULT 0,
            tasks_done INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 1,
            upgrades_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

SESSION_TTL_SECONDS = int(os.environ.get('HDSFD_SESSION_TTL', str(60 * 60 * 24 * 30)))


def hash_password(password):
    return hashlib.scrypt(
        str(password).encode('utf-8'),
        salt=app.secret_key.encode('utf-8')[:16],
        n=16384,
        r=8,
        p=1,
    ).hex()


def issue_session(username):
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    expires = datetime.datetime.now(timezone.utc) + timedelta(seconds=SESSION_TTL_SECONDS)
    conn = get_db()
    conn.execute(
        'INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)',
        (token_hash, username, expires.isoformat()),
    )
    conn.commit()
    conn.close()
    return raw_token, expires


OAUTH_STATE_TTL_SECONDS = 600


def issue_oauth_state(owner=None):
    """Create a one-time OAuth state value.

    The optional owner is the already signed-in HDSFD account that is linking
    Google. It is stored server-side, never inside the state string itself.
    """
    state = secrets.token_urlsafe(24)
    state_hash = hashlib.sha256(state.encode('utf-8')).hexdigest()
    now = datetime.datetime.now(timezone.utc)
    expires = now + timedelta(seconds=OAUTH_STATE_TTL_SECONDS)
    conn = get_db()
    conn.execute('DELETE FROM oauth_states WHERE expires_at <= ?', (now.isoformat(),))
    conn.execute(
        'INSERT INTO oauth_states (state_hash, owner, expires_at) VALUES (?, ?, ?)',
        (state_hash, owner, expires.isoformat()),
    )
    conn.commit()
    conn.close()
    return state


def consume_oauth_state(state):
    """Validate and burn a one-time OAuth state.

    Returns (ok, owner). A missing, expired or replayed state is always invalid,
    so a callback can never be replayed against another browser.
    """
    state = str(state or '')
    if not state or len(state) > 200:
        return False, None
    state_hash = hashlib.sha256(state.encode('utf-8')).hexdigest()
    conn = get_db()
    row = conn.execute(
        'SELECT owner, expires_at FROM oauth_states WHERE state_hash = ?',
        (state_hash,),
    ).fetchone()
    conn.execute('DELETE FROM oauth_states WHERE state_hash = ?', (state_hash,))
    conn.commit()
    conn.close()
    if not row:
        return False, None
    try:
        if datetime.datetime.fromisoformat(row['expires_at']) <= datetime.datetime.now(timezone.utc):
            return False, None
    except (TypeError, ValueError):
        return False, None
    return True, (row['owner'] or None)


def oauth_error_response(message):
    page = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Connection Failed</title>
  <style>
    body { background: #0b0718; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); padding: 32px; border-radius: 24px; text-align: center; max-width: 420px; }
    h1 { font-size: 20px; color: #fca5a5; margin: 12px 0 8px; }
    p { color: #cbd5e1; font-size: 14px; line-height: 1.5; margin: 0 0 18px; }
    button { background: rgba(168,85,247,0.2); border: 1px solid rgba(168,85,247,0.45); color: #e9d5ff; font-weight: 700; padding: 10px 18px; border-radius: 12px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 40px;">\u26a0\ufe0f</div>
    <h1>Google connection failed</h1>
    <p>__MESSAGE__</p>
    <button onclick="window.close()">Close this window</button>
  </div>
</body>
</html>"""
    safe_message = str(message or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return app.response_class(page.replace('__MESSAGE__', safe_message), status=400, mimetype='text/html')


def current_user():
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        return None
    raw_token = header[7:].strip()
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
    conn = get_db()
    row = conn.execute(
        'SELECT username, expires_at FROM sessions WHERE token_hash = ?',
        (token_hash,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    try:
        if datetime.datetime.fromisoformat(row['expires_at']) <= datetime.datetime.now(timezone.utc):
            return None
    except (TypeError, ValueError):
        return None
    return row['username']


def require_owner(username=None):
    owner = current_user()
    if owner and (username is None or owner == username):
        return owner
    return None


def _session_owner(requested=None):
    """Resolve the signed-in owner for personal data endpoints.

    Returns (owner, error_response): the session decides whose rows are touched,
    and a username that disagrees with the session is rejected rather than obeyed.
    """
    owner = current_user()
    if not owner:
        return None, (jsonify({'status': 'error', 'message': 'Sign in to sync this data'}), 401)
    requested = str(requested or '').strip()
    if requested and requested != owner:
        return None, (jsonify({'status': 'error', 'message': 'This data belongs to another account'}), 403)
    return owner, None


def save_user_tokens(username, creds, display_name=None, google_email=None):
    """Store Google credentials under the HDSFD account that owns them.

    ``username`` is the session owner (a plain HDSFD username for a linked
    account); ``google_email`` keeps the connected Google address for display
    and support. Existing values are preserved when an argument is None.
    """
    if not username or not creds:
        return
    token_str = creds.to_json() if hasattr(creds, 'to_json') else (json.dumps(creds) if isinstance(creds, dict) else str(creds))
    conn = get_db()
    try:
        conn.execute('ALTER TABLE user_tokens ADD COLUMN display_name TEXT')
    except Exception:
        pass
    try:
        conn.execute('ALTER TABLE user_tokens ADD COLUMN google_email TEXT')
    except Exception:
        pass
    conn.execute('''
        INSERT INTO user_tokens (username, token_json, display_name, google_email)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            token_json = excluded.token_json,
            display_name = COALESCE(excluded.display_name, user_tokens.display_name),
            google_email = COALESCE(excluded.google_email, user_tokens.google_email),
            updated_at = CURRENT_TIMESTAMP
    ''', (username, token_str, display_name, google_email))
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
        creds_data = json.loads(row['token_json'])
        if 'client_id' not in creds_data:
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
            creds_data['client_id'] = client_id
            creds_data['client_secret'] = client_secret

        import google.oauth2.credentials
        from google.auth.transport.requests import Request
        creds = google.oauth2.credentials.Credentials.from_authorized_user_info(creds_data)
        if creds and (creds.expired or not creds.valid) and creds.refresh_token:
            creds.refresh(Request())
            save_user_tokens(row['username'], creds)
        return creds
    except Exception as e:
        logger.warning(f"Error loading credentials: {e}")
        return None

@app.route('/api/auth/login', methods=['POST'])
def hdsfd_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username', '')).strip()
    password = data.get('password')
    if len(username) < 3 or len(username) > 120 or not password:
        return jsonify({'status': 'error', 'message': 'A username (3-120 characters) and password are required'}), 400
    if any(char in username for char in '/\\?&#'):
        return jsonify({'status': 'error', 'message': 'Username contains invalid characters'}), 400
    if len(str(password)) < 8:
        return jsonify({'status': 'error', 'message': 'Password must be at least 8 characters'}), 400

    password_hash = hash_password(password)
    conn = get_db()
    try:
        row = conn.execute('SELECT username, password_hash FROM users WHERE username = ?', (username,)).fetchone()
        if row and row['password_hash'] and not secrets.compare_digest(row['password_hash'], password_hash):
            return jsonify({'status': 'error', 'message': 'Incorrect password'}), 401
        if row and not row['password_hash']:
            conn.execute('UPDATE users SET password_hash = ? WHERE username = ?', (password_hash, username))
        elif not row:
            conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, password_hash))
        conn.commit()
    finally:
        conn.close()

    token, expires = issue_session(username)
    # Remember the signed-in account for the Google linking flow only. The cookie
    # is signed by Flask and is never trusted as a bearer session.
    session['hdsfd_owner'] = username
    return jsonify({
        'status': 'success',
        'username': username,
        'token': token,
        'expires_at': expires.isoformat(),
        'new_user': row is None,
    })


@app.route('/api/auth/logout', methods=['POST'])
def hdsfd_logout():
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        token_hash = hashlib.sha256(header[7:].strip().encode('utf-8')).hexdigest()
        conn = get_db()
        conn.execute('DELETE FROM sessions WHERE token_hash = ?', (token_hash,))
        conn.commit()
        conn.close()
    session.pop('hdsfd_owner', None)
    return jsonify({'status': 'success'})


@app.route('/api/health', methods=['GET'])
def health_check():
    """Unauthenticated liveness probe used by CI/CD health checks."""
    db_ok = False
    conn = None
    try:
        conn = get_db()
        conn.execute('SELECT 1')
        db_ok = True
    except Exception:
        logger.exception('Health check database probe failed')
    finally:
        if conn is not None:
            conn.close()
    return jsonify({
        'status': 'ok' if db_ok else 'degraded',
        'database': 'ok' if db_ok else 'error',
    }), 200 if db_ok else 503


@app.route('/api/google/status', methods=['GET'])
def get_google_status():
    # Session-scoped: a username in the query string cannot select another account.
    requested_username = current_user()
    if not requested_username:
        return jsonify({
            "connected": False,
            "email": None,
            "name": None
        })
    
    conn = get_db()
    try:
        row = conn.execute("SELECT username, display_name, google_email, updated_at FROM user_tokens WHERE username = ?", (requested_username,)).fetchone()
    except Exception:
        row = conn.execute("SELECT username, updated_at FROM user_tokens WHERE username = ?", (requested_username,)).fetchone()
    conn.close()
    if row:
        linked_email = row['google_email'] if 'google_email' in row.keys() else None
        email = linked_email or row['username']
        name_part = None
        if 'display_name' in row.keys() and row['display_name']:
            name_part = row['display_name']
        if not name_part and '@' in email:
            name_part = email.split('@')[0].replace('.', ' ').replace('_', ' ').replace('-', ' ').title()
        return jsonify({
            "connected": True,
            "email": email,
            "name": name_part or "Google User",
            "updated_at": row['updated_at']
        })
    return jsonify({
        "connected": False,
        "email": None,
        "name": None
    })


# --- SCHOOL CONNECT: provider-neutral, read-only academic imports ---
SCHOOL_PROVIDER_INFO = {
    "ics": {"label": "Calendar export", "mode": "import", "read_only": True},
    "csv": {"label": "Assignment CSV", "mode": "import", "read_only": True},
    "google_classroom": {"label": "Google Classroom", "mode": "official_oauth", "read_only": True},
    "canvas": {"label": "Canvas", "mode": "official_oauth", "read_only": True},
    "schoology": {"label": "Schoology", "mode": "official_oauth", "read_only": True},
    "classlink": {"label": "ClassLink", "mode": "official_oauth", "read_only": True},
    "clever": {"label": "Clever", "mode": "official_oauth", "read_only": True},
    "hac": {"label": "Home Access Center", "mode": "official_api_required", "read_only": True},
    "powerschool": {"label": "PowerSchool", "mode": "official_api_required", "read_only": True},
}


def school_owner():
    return current_user()


def school_json_payload():
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        return payload
    if request.form:
        return request.form.to_dict()
    return {}


def school_import_input():
    payload = school_json_payload()
    if request.files:
        upload = request.files.get('file')
        if upload:
            content = upload.read()
            filename = upload.filename or ''
            import_format = clean_text(payload.get('format'), 10).lower() or (
                'ics' if filename.lower().endswith('.ics') else 'csv'
            )
            return import_format, content, payload
    content = payload.get('content')
    if content is None:
        raise ValueError('Import content is required')
    return clean_text(payload.get('format'), 10).lower(), content, payload


def school_source_row(conn, owner, source_id):
    return conn.execute(
        'SELECT * FROM school_sources WHERE owner = ? AND id = ?',
        (owner, source_id),
    ).fetchone()


def school_public_records(conn, owner, source_id=None):
    query = 'SELECT id, payload, created_at, updated_at FROM school_records WHERE owner = ?'
    params = [owner]
    if source_id:
        query += ' AND source_id = ?'
        params.append(source_id)
    query += ' ORDER BY updated_at DESC, id ASC LIMIT 1000'
    records = []
    for row in conn.execute(query, params).fetchall():
        try:
            payload = json.loads(row['payload'])
        except (TypeError, ValueError):
            continue
        payload.update({
            'id': row['id'],
            'created_at': row['created_at'],
            'updated_at': row['updated_at'],
        })
        records.append(payload)
    return records


@app.route('/api/school/providers', methods=['GET'])
def school_providers():
    return jsonify([
        {'id': provider, **SCHOOL_PROVIDER_INFO[provider]}
        for provider in SUPPORTED_PROVIDERS
        if provider in SCHOOL_PROVIDER_INFO
    ])


@app.route('/api/school/sources', methods=['GET', 'POST'])
def school_sources():
    owner = school_owner()
    if not owner:
        return jsonify({'status': 'error', 'message': 'Authentication required'}), 401
    conn = get_db()
    try:
        ensure_school_tables(conn)
        if request.method == 'GET':
            rows = conn.execute(
                'SELECT * FROM school_sources WHERE owner = ? ORDER BY updated_at DESC',
                (owner,),
            ).fetchall()
            return jsonify([public_source(row) for row in rows])

        payload = school_json_payload()
        try:
            source_data = validate_source_payload(payload)
        except ValueError as exc:
            return jsonify({'status': 'error', 'message': str(exc)}), 400
        requested_id = clean_text(payload.get('id') or payload.get('source_id'), 100)
        if requested_id and not all(char.isalnum() or char in '_-' for char in requested_id):
            return jsonify({'status': 'error', 'message': 'Invalid source ID'}), 400
        source_id = requested_id or new_source_id()
        existing = conn.execute(
            'SELECT owner FROM school_sources WHERE id = ?', (source_id,)
        ).fetchone()
        if existing and existing['owner'] != owner:
            return jsonify({'status': 'error', 'message': 'Source ID is already in use'}), 409
        conn.execute(
            '''
            INSERT INTO school_sources
              (id, owner, provider, display_name, external_url, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              provider = excluded.provider,
              display_name = excluded.display_name,
              external_url = excluded.external_url,
              status = excluded.status,
              updated_at = CURRENT_TIMESTAMP
            ''',
            (
                source_id,
                owner,
                source_data['provider'],
                source_data['display_name'],
                source_data['external_url'],
                source_data['status'],
            ),
        )
        conn.commit()
        return jsonify(public_source(school_source_row(conn, owner, source_id))), 201
    finally:
        conn.close()


@app.route('/api/school/sources/<path:source_id>', methods=['GET', 'DELETE'])
def school_source_detail(source_id):
    owner = school_owner()
    if not owner:
        return jsonify({'status': 'error', 'message': 'Authentication required'}), 401
    conn = get_db()
    try:
        row = school_source_row(conn, owner, source_id)
        if not row:
            return jsonify({'status': 'error', 'message': 'School source not found'}), 404
        if request.method == 'GET':
            return jsonify({
                'source': public_source(row),
                'records': school_public_records(conn, owner, source_id),
            })
        conn.execute('DELETE FROM school_records WHERE owner = ? AND source_id = ?', (owner, source_id))
        conn.execute('DELETE FROM school_imports WHERE owner = ? AND source_id = ?', (owner, source_id))
        conn.execute('DELETE FROM school_sources WHERE owner = ? AND id = ?', (owner, source_id))
        conn.commit()
        return jsonify({'status': 'deleted', 'source_id': source_id})
    finally:
        conn.close()


@app.route('/api/school/records', methods=['GET'])
def school_records():
    owner = school_owner()
    if not owner:
        return jsonify({'status': 'error', 'message': 'Authentication required'}), 401
    source_id = clean_text(request.args.get('source_id'), 100) or None
    conn = get_db()
    try:
        if source_id and not school_source_row(conn, owner, source_id):
            return jsonify({'status': 'error', 'message': 'School source not found'}), 404
        ensure_school_tables(conn)
        return jsonify(school_public_records(conn, owner, source_id))
    finally:
        conn.close()


@app.route('/api/school/imports', methods=['GET'])
def school_imports():
    owner = school_owner()
    if not owner:
        return jsonify({'status': 'error', 'message': 'Authentication required'}), 401
    conn = get_db()
    try:
        ensure_school_tables(conn)
        rows = conn.execute(
            '''
            SELECT id, source_id, import_format, content_hash, imported_count,
                   created_count, updated_count, warnings_json, created_at
            FROM school_imports
            WHERE owner = ?
            ORDER BY created_at DESC
            LIMIT 100
            ''',
            (owner,),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            try:
                item['warnings'] = json.loads(item.pop('warnings_json'))
            except (TypeError, ValueError):
                item['warnings'] = []
            result.append(item)
        return jsonify(result)
    finally:
        conn.close()


@app.route('/api/school/import', methods=['POST'])
def school_import():
    owner = school_owner()
    if not owner:
        return jsonify({'status': 'error', 'message': 'Authentication required'}), 401
    try:
        import_format, content, payload = school_import_input()
        parsed = parse_import(import_format, content)
    except ValueError as exc:
        return jsonify({'status': 'error', 'message': str(exc)}), 400

    source_id = clean_text(payload.get('source_id'), 100) or default_source_id(owner, parsed['format'])
    if not all(char.isalnum() or char in '_-' for char in source_id):
        return jsonify({'status': 'error', 'message': 'Invalid source ID'}), 400
    conn = get_db()
    try:
        ensure_school_tables(conn)
        source = school_source_row(conn, owner, source_id)
        if not source:
            provider = parsed['format']
            display_name = 'Calendar import' if provider == 'ics' else 'Assignment import'
            conn.execute(
                '''
                INSERT INTO school_sources
                  (id, owner, provider, display_name, status, updated_at)
                VALUES (?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP)
                ''',
                (source_id, owner, provider, display_name),
            )
            source = school_source_row(conn, owner, source_id)

        duplicate = conn.execute(
            '''
            SELECT id, imported_count, created_count, updated_count, warnings_json, created_at
            FROM school_imports
            WHERE owner = ? AND source_id = ? AND content_hash = ?
            ''',
            (owner, source_id, parsed['content_hash']),
        ).fetchone()
        if duplicate:
            return jsonify({
                'status': 'duplicate',
                'duplicate': True,
                'source': public_source(source),
                'import': {
                    'id': duplicate['id'],
                    'imported_count': duplicate['imported_count'],
                    'created_count': duplicate['created_count'],
                    'updated_count': duplicate['updated_count'],
                    'warnings': json.loads(duplicate['warnings_json'] or '[]'),
                    'created_at': duplicate['created_at'],
                },
                'records': school_public_records(conn, owner, source_id),
            })

        imported_at = now_iso()
        created_count = 0
        updated_count = 0
        result_records = []
        for record in parsed['records']:
            payload_record = record_payload(record, owner, source_id, imported_at)
            serialized = serialize_record(payload_record)
            existing = conn.execute(
                'SELECT id FROM school_records WHERE owner = ? AND source_id = ? AND external_id = ?',
                (owner, source_id, record['external_id']),
            ).fetchone()
            if existing:
                record_id = existing['id']
                conn.execute(
                    '''
                    UPDATE school_records
                    SET record_type = ?, payload = ?, content_hash = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE owner = ? AND source_id = ? AND external_id = ?
                    ''',
                    (
                        record['record_type'], serialized, parsed['content_hash'],
                        owner, source_id, record['external_id'],
                    ),
                )
                updated_count += 1
            else:
                record_id = str(uuid.uuid4())
                conn.execute(
                    '''
                    INSERT INTO school_records
                      (id, owner, source_id, external_id, record_type, payload, content_hash, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ''',
                    (
                        record_id, owner, source_id, record['external_id'],
                        record['record_type'], serialized, parsed['content_hash'],
                    ),
                )
                created_count += 1
            output = dict(payload_record)
            output['id'] = record_id
            result_records.append(output)

        import_id = str(uuid.uuid4())
        conn.execute(
            '''
            INSERT INTO school_imports
              (id, owner, source_id, import_format, content_hash, imported_count,
               created_count, updated_count, warnings_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                import_id, owner, source_id, parsed['format'], parsed['content_hash'],
                len(parsed['records']), created_count, updated_count,
                json.dumps(parsed['warnings'], ensure_ascii=True),
            ),
        )
        conn.execute(
            "UPDATE school_sources SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE owner = ? AND id = ?",
            (owner, source_id),
        )
        conn.commit()
        source = school_source_row(conn, owner, source_id)
        return jsonify({
            'status': 'success',
            'duplicate': False,
            'source': public_source(source),
            'import': {
                'id': import_id,
                'imported_count': len(parsed['records']),
                'created_count': created_count,
                'updated_count': updated_count,
                'warnings': parsed['warnings'],
                'content_hash': parsed['content_hash'],
            },
            'records': result_records,
        }), 201
    except Exception:
        conn.rollback()
        logger.exception('School Connect import failed')
        return jsonify({'status': 'error', 'message': 'School import could not be saved'}), 500
    finally:
        conn.close()

@app.route('/api/user/stats', methods=['GET', 'POST'])
def handle_user_stats():
    if request.method == 'GET':
        username, error = _session_owner(request.args.get('username'))
    else:
        username, error = _session_owner((request.get_json(silent=True) or {}).get('username'))
    if error:
        return error
    conn = get_db()
    if request.method == 'GET':
        row = conn.execute("SELECT * FROM user_stats WHERE username = ?", (username,)).fetchone()
        if row:
            upgrades = []
            try:
                if row['upgrades_json']:
                    upgrades = json.loads(row['upgrades_json'])
            except Exception:
                upgrades = []
            return jsonify({
                "status": "success",
                "coins": row['coins'],
                "lifetime_xp": row['lifetime_xp'],
                "focus_mins": row['focus_mins'],
                "tasks_done": row['tasks_done'],
                "streak": row['streak'],
                "upgrades": upgrades
            })
        return jsonify({
            "status": "success",
            "coins": 0,
            "lifetime_xp": 0,
            "focus_mins": 0,
            "tasks_done": 0,
            "streak": 1,
            "upgrades": []
        })
    else:
        data = request.get_json(silent=True) or {}
        coins = int(data.get('coins', 0))
        lifetime_xp = int(data.get('lifetime_xp', 0))
        focus_mins = int(data.get('focus_mins', 0))
        tasks_done = int(data.get('tasks_done', 0))
        streak = int(data.get('streak', 1))
        upgrades_json = json.dumps(data.get('upgrades', []))
        
        conn.execute('''
            INSERT INTO user_stats (username, coins, lifetime_xp, focus_mins, tasks_done, streak, upgrades_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET
                coins = excluded.coins,
                lifetime_xp = excluded.lifetime_xp,
                focus_mins = excluded.focus_mins,
                tasks_done = excluded.tasks_done,
                streak = excluded.streak,
                upgrades_json = excluded.upgrades_json,
                updated_at = CURRENT_TIMESTAMP
        ''', (username, coins, lifetime_xp, focus_mins, tasks_done, streak, upgrades_json))
        conn.commit()
        return jsonify({"status": "success", "message": "Stats saved"})

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

@app.route('/hdsfd-ui.js')
def hdsfd_ui_js():
    resp = send_from_directory('.', 'hdsfd-ui.js', mimetype='text/javascript')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/liquid-glass.js')
def liquid_glass_js():
    resp = send_from_directory('.', 'liquid-glass.js', mimetype='text/javascript')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/vendor/quick-liquid/<path:filename>')
def quick_liquid_vendor(filename):
    if not filename.endswith('.mjs'):
        return ("Not found", 404)
    resp = send_from_directory('vendor/quick-liquid', filename, mimetype='text/javascript')
    resp.headers['Cache-Control'] = 'public, max-age=86400'
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
    username, error = _session_owner(request.args.get('username'))
    if error:
        return error
    conn = get_db()
    if request.method == 'DELETE':
        conn.execute("DELETE FROM gemini_chat_history WHERE username = ?", (username,))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": "History cleared"})
    else:
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

def _answer_from_live_context(lower, context):
    """Context-aware answer built straight from the user's live workspace snapshot.
    Used by the offline engine so answers stay personal even without a Gemini key."""
    if not isinstance(context, dict) or not context:
        return None

    # Never hijack an explicit command — those go to the action engine below.
    imperative_prefixes = (
        'add ', 'create ', 'make ', 'schedule ', 'set ', 'put ', 'new ', 'delete ',
        'remove ', 'complete ', 'mark ', 'start ', 'play ', 'pause ', 'reset ', 'change ',
    )
    if lower.startswith(imperative_prefixes):
        return None

    intents = [
        'what should i', 'what do i have', 'my tasks', 'my day', 'today', 'due',
        'priorit', 'focus on', 'next up', 'my schedule', 'my classes', 'my exams',
        'progress', 'how am i doing', 'what is due', "what's due", 'overview', 'next exam',
    ]
    if not any(word in lower for word in intents):
        return None

    tasks = [item for item in (context.get('tasks') or []) if isinstance(item, dict)]
    open_tasks = [item for item in tasks if not item.get('completed')]
    schedule = [item for item in (context.get('schedule') or []) if isinstance(item, dict)]
    exams = [item for item in (context.get('exams') or []) if isinstance(item, dict)]
    stats = context.get('stats') if isinstance(context.get('stats'), dict) else {}
    if not tasks and not schedule and not exams:
        return None

    import datetime as _dt
    today = _dt.datetime.now().strftime('%a')

    lines = ["🧭 **Your workspace right now:**", ""]
    lines.append(f"• **Tasks:** {len(open_tasks)} open of {len(tasks)} total")
    if schedule:
        lines.append(f"• **Classes on the timetable:** {len(schedule)}")
    if exams:
        lines.append(f"• **Exams scheduled:** {len(exams)}")
    if stats:
        bits = []
        if stats.get('tasks_done') is not None:
            bits.append(f"{stats.get('tasks_done')} tasks done")
        if stats.get('focus_mins') is not None:
            bits.append(f"{stats.get('focus_mins')} focus minutes")
        if stats.get('coins') is not None:
            bits.append(f"{stats.get('coins')} coins")
        if bits:
            lines.append("• **Progress:** " + " · ".join(bits))

    if open_tasks:
        ordered = sorted(open_tasks, key=lambda t: (not bool(t.get('due')), str(t.get('due') or '')))
        lines.append("\n**Start here (nearest deadline first):**")
        for index, task in enumerate(ordered[:5], start=1):
            meta = " · ".join(str(x) for x in (task.get('folder'), task.get('due')) if x)
            lines.append(f"{index}. **{task.get('title')}**" + (f" — {meta}" if meta else ""))

    todays_classes = [item for item in schedule if today in (item.get('days') or [])]
    if todays_classes:
        lines.append("\n**On your timetable today:**")
        for item in todays_classes[:5]:
            lines.append(
                f"• **{item.get('title')}** {item.get('start') or ''}"
                + (f"–{item.get('end')}" if item.get('end') else "")
            )

    if exams:
        upcoming = sorted(exams, key=lambda e: str(e.get('date') or ''))[:3]
        lines.append("\n**Nearest exams:**")
        for item in upcoming:
            lines.append(f"• **{item.get('title')}** — {item.get('date') or 'date TBD'} {item.get('time') or ''}".rstrip())

    if open_tasks:
        lines.append(
            "\n💡 Want me to start a 25-minute focus session on the first task, "
            "or create a sticky-note summary for it?"
        )
    else:
        lines.append("\n🎉 Nothing open right now — a good moment to revise notes or get ahead.")

    return "\n".join(lines)


@app.route('/api/gemini/generate', methods=['POST'])
def gemini_generate():
    data = request.json or {}
    prompt = data.get('prompt', '').strip()
    # Signed-in sessions own their history; guests keep the local-only bucket.
    username = current_user() or data.get('username') or 'Guest'
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

        # Fetch recent chat history (last 20 messages for stronger continuity)
        history_rows = conn.execute(
            "SELECT role, content FROM gemini_chat_history WHERE username = ? ORDER BY id DESC LIMIT 20",
            (username,)
        ).fetchall()
        history_rows = list(reversed(history_rows))
    except Exception:
        history_rows = []

    # Comprehensive System Instruction for HDSFD AI Agent
    system_instruction = (
        "You are the HDSFD Intelligent AI Agent powered by Google Gemini inside HDSFD (HD Student Focus Dashboard) — the student focus sanctuary and productivity workspace.\n"
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
        "   - Backs up all notes as 'Notes.json' and the assistant's study context as 'ai.json' into the user's 'HDSFD Backup' Google Drive folder.\n\n"
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
        "    {\"type\": \"play_song\", \"query\": \"song or artist name\"},\n"
        "    {\"type\": \"create_schedule_entry\", \"title\": \"Math\", \"days\": [\"Mon\",\"Wed\"], \"start_time\": \"09:00\", \"end_time\": \"10:15\"},\n"
        "    {\"type\": \"create_exam\", \"title\": \"Physics Final\", \"date\": \"2026-12-10\", \"time\": \"09:00\"},\n"
        "    {\"type\": \"complete_task\", \"title\": \"existing task title\"},\n"
        "    {\"type\": \"delete_task\", \"title\": \"existing task title\"},\n"
        "    {\"type\": \"navigate_tab\", \"tab\": \"focus|tasks-notes|notes|settings\"},\n"
        "    {\"type\": \"change_theme\", \"theme\": \"cyber\"}\n"
        "  ]\n"
        "}\n"
        "```\n"
        "Always provide natural, intelligent, comprehensive, and helpful academic explanations for math, science, SAT, essay planning, coding, and productivity advice."
    )

    # ---- Live workspace context injected by the client on every request ----
    live_context = data.get('context') or {}
    if isinstance(live_context, dict) and live_context:
        import datetime as _context_datetime
        def _clip_ctx(value, limit=90):
            text = str(value if value is not None else '').replace('\n', ' ').strip()
            return text[:limit] + ('…' if len(text) > limit else '')

        ctx_lines = []
        ctx_lines.append(f"NOW: {_context_datetime.datetime.now().strftime('%A, %B %d, %Y - %I:%M %p')}")
        ctx_lines.append(f"ACCOUNT: {_clip_ctx(live_context.get('user') or username, 60)}")
        ctx_lines.append(f"OPEN TAB: {_clip_ctx(live_context.get('tab') or 'focus', 30)}")

        folders = live_context.get('folders') or []
        if folders:
            ctx_lines.append("FOLDERS: " + ", ".join(_clip_ctx(f, 34) for f in folders[:10]))

        # Only the slice an answer can actually use: open work first, plus a few
        # recent items. Keeps the prompt small so replies stay fast.
        raw_tasks = [t for t in (live_context.get('tasks') or []) if isinstance(t, dict)]
        open_tasks = [t for t in raw_tasks if not t.get('completed')]
        done_tasks = [t for t in raw_tasks if t.get('completed')]
        tasks = open_tasks[:12] + done_tasks[:3]
        if tasks:
            ctx_lines.append(f"TASKS ({len(open_tasks)} open, showing {len(tasks)}):")
            for t in tasks:
                bits = [_clip_ctx(t.get('title'), 70)]
                if t.get('folder'):
                    bits.append(f"folder={_clip_ctx(t.get('folder'), 26)}")
                if t.get('due'):
                    bits.append(f"due={_clip_ctx(t.get('due'), 26)}")
                bits.append('done' if t.get('completed') else 'open')
                ctx_lines.append("  - " + " | ".join(bits))

        # Note text is opt-out: Settings sends include_notes=false when the user
        # turns it off, and the server never adds notes in that case.
        if data.get('include_notes') is not False:
            notes = live_context.get('notes') or []
            if notes:
                ctx_lines.append(f"NOTES ({len(notes)} shown):")
                for n in notes[:6]:
                    if isinstance(n, dict):
                        ctx_lines.append("  - " + _clip_ctx(n.get('title') or n.get('text'), 110))
        else:
            ctx_lines.append("NOTES: withheld by the user's privacy setting.")

        schedule = live_context.get('schedule') or []
        if schedule:
            ctx_lines.append(f"CLASS SCHEDULE ({len(schedule)} shown):")
            for s in schedule[:8]:
                if isinstance(s, dict):
                    days = ",".join(s.get('days') or []) if isinstance(s.get('days'), list) else _clip_ctx(s.get('days'), 30)
                    ctx_lines.append(
                        "  - " + _clip_ctx(s.get('title'), 60)
                        + f" | {days} | {_clip_ctx(s.get('start'), 10)}-{_clip_ctx(s.get('end'), 10)}"
                    )

        exams = live_context.get('exams') or []
        if exams:
            ctx_lines.append(f"UPCOMING EXAMS ({len(exams)} shown):")
            for e in exams[:5]:
                if isinstance(e, dict):
                    ctx_lines.append(
                        "  - " + _clip_ctx(e.get('title'), 60)
                        + f" | {_clip_ctx(e.get('date'), 12)} {_clip_ctx(e.get('time'), 8)}"
                    )

        stats = live_context.get('stats') or {}
        if isinstance(stats, dict) and stats:
            ctx_lines.append(
                "PROGRESS: " + ", ".join(f"{k}={_clip_ctx(v, 20)}" for k, v in list(stats.items())[:10])
            )

        playing = live_context.get('music_now_playing')
        if isinstance(playing, dict) and playing.get('title'):
            ctx_lines.append("NOW PLAYING: " + _clip_ctx(playing.get('title'), 80))

        system_instruction += (
            "\n\n===== USER LIVE WORKSPACE CONTEXT (AUTHORITATIVE & CURRENT) =====\n"
            "This is the user's real workspace data, synced from the app right now. Use it directly when answering "
            "questions about their tasks, folders, notes, classes, exams, progress or what they should do next. "
            "Reference real titles and dates from it. Never invent tasks, notes, classes or exams that are not listed. "
            "If the user asks to complete or delete something, match it against the titles shown below.\n"
            + "\n".join(ctx_lines)
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

        # Intent: Questions about the user's own workspace → answer from live context
        context_answer = _answer_from_live_context(lower, live_context)
        if context_answer:
            generated_text = context_answer

        # Intent: Create/Add Task
        elif any(w in lower for w in ['task', 'assignment', 'hw', 'homework', 'todo', 'due']) and any(w in lower for w in ['add', 'create', 'schedule', 'set', 'make', 'put', 'need', 'task:']):
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
    username, error = _session_owner(request.args.get('username'))
    if error:
        return error
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
    data = request.get_json(silent=True) or {}
    if 'type' not in data:
        return jsonify({"status": "error", "message": "Invalid item payload"}), 400

    username, error = _session_owner(data.get('username'))
    if error:
        return error
    item_type = data['type']
    item_id = data.get('id') or f"item_{int(os.urandom(4).hex(), 16)}"
    payload = dict(data)
    payload['username'] = username
    payload['id'] = item_id
    content_str = json.dumps(payload)

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
    data = request.get_json(silent=True) or {}
    item_id = data.get('id')
    if not item_id:
        return jsonify({"status": "error", "message": "Missing parameters"}), 400

    username, error = _session_owner(data.get('username'))
    if error:
        return error

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

def _request_public_origin():
    """Origin the browser used, honouring the headers a reverse proxy sets.

    A Cloudflare Worker in front of PythonAnywhere terminates TLS and reaches the
    app over plain HTTP, so request.scheme/request.host alone would build an
    http://<internal> callback that Google rejects as unregistered.
    """
    proto = request.headers.get('X-Forwarded-Proto', '').split(',')[0].strip().lower()
    host = request.headers.get('X-Forwarded-Host', '').split(',')[0].strip()
    # A host header is only a hostname[:port]; reject anything that could bend
    # the callback path or inject credentials.
    if any(ch in host for ch in '/\\@?# '):
        host = ''
    scheme = proto if proto in ('http', 'https') else request.scheme
    return f"{scheme}://{host or request.host}"


def get_oauth_redirect_uri():
    # PUBLIC_BASE_URL pins the exact origin registered with Google; set it when
    # the proxy in front is not trusted to report its own public origin.
    configured = os.environ.get('PUBLIC_BASE_URL', '').strip().rstrip('/')
    base = configured or _request_public_origin()
    if not configured and 'pythonanywhere.com' in base and base.startswith('http://'):
        base = 'https://' + base[7:]
    return base + '/api/gdrive/callback'

@app.route('/api/gdrive/auth', methods=['GET'])
def gdrive_auth():
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '121185670188-9tjuclccmbqiosbtia0pouoras1ligv7.apps.googleusercontent.com')
    creds_file = os.path.join(os.path.dirname(__file__), 'google_credentials.json')
    if os.path.exists(creds_file):
        try:
            with open(creds_file, 'r') as f:
                cdata = json.load(f)
                client_id = cdata.get('client_id', client_id)
        except Exception:
            pass

    redirect_uri = get_oauth_redirect_uri()
    scopes = [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/tasks'
    ]
    
    # Linking is only for the HDSFD account proven by the signed session cookie;
    # a username in the query string is never accepted as identity.
    link_owner = session.get('hdsfd_owner') or None
    if link_owner:
        conn = get_db()
        row = conn.execute('SELECT username FROM users WHERE username = ?', (link_owner,)).fetchone()
        conn.close()
        if not row:
            link_owner = None
    state_token = issue_oauth_state(link_owner)
    
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
    raw_state = request.args.get('state') or ''
    state_ok, link_owner = consume_oauth_state(raw_state)
    if not state_ok:
        return oauth_error_response(
            'This Google connection link is invalid, expired or already used. '
            'Return to HDSFD and press "Pair Google Account" again.'
        )
    if request.args.get('error'):
        return oauth_error_response(
            'Google did not grant access, so nothing was connected. '
            'Return to HDSFD and try again if you want to link your account.'
        )
    if not code:
        return oauth_error_response(
            'Google did not return an authorization code. '
            'Return to HDSFD and press "Pair Google Account" again.'
        )
        
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

    redirect_uri = get_oauth_redirect_uri()

    user_email = ''
    user_name = ''
    session_token = ''
    session_expires = None

    if code and client_id and client_secret:
        try:
            import requests
            token_resp = requests.post('https://oauth2.googleapis.com/token', data={
                'code': code,
                'client_id': client_id,
                'client_secret': client_secret,
                'redirect_uri': redirect_uri,
                'grant_type': 'authorization_code'
            }, timeout=15)

            if token_resp.status_code == 200:
                token_data = token_resp.json()

                # 1. Instant ID Token JWT decoding
                id_tok = token_data.get('id_token')
                if id_tok and '.' in id_tok:
                    try:
                        parts = id_tok.split('.')
                        if len(parts) >= 2:
                            p_b64 = parts[1] + '=' * (-len(parts[1]) % 4)
                            id_payload = json.loads(base64.urlsafe_b64decode(p_b64).decode('utf-8'))
                            user_email = id_payload.get('email', '')
                            user_name = id_payload.get('name', '') or id_payload.get('given_name', '')
                    except Exception as ex:
                        logger.warning(f"Error parsing ID token JWT: {ex}")

                # 2. Secondary check via userinfo endpoint if needed
                if not user_email or not user_name:
                    access_token = token_data.get('access_token')
                    if access_token:
                        try:
                            u_resp = requests.get('https://www.googleapis.com/oauth2/v2/userinfo', headers={
                                'Authorization': f'Bearer {access_token}'
                            }, timeout=10)
                            if u_resp.status_code == 200:
                                u_data = u_resp.json()
                                user_email = user_email or u_data.get('email', '')
                                user_name = user_name or u_data.get('name', '') or u_data.get('given_name', '')
                        except Exception as ex:
                            logger.warning(f"Userinfo endpoint query failed: {ex}")

                # 3. Fallback name to formatted email prefix if user_name is blank
                if not user_name and user_email and '@' in user_email:
                    prefix = user_email.split('@')[0]
                    user_name = prefix.replace('.', ' ').replace('_', ' ').replace('-', ' ').title()

                if user_email:
                    # A signed-in HDSFD account keeps its session; Google is only
                    # linked to it. Guests get a real HDSFD session from Google.
                    save_user_tokens(
                        link_owner or user_email,
                        token_data,
                        None if link_owner else user_name,
                        google_email=user_email,
                    )
                    if not link_owner:
                        session_token, session_expires = issue_session(user_email)
            else:
                logger.error(f"Google token exchange failed: {token_resp.status_code} {token_resp.text}")
        except Exception as e:
            logger.error(f"Failed in callback: {e}")

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
    const sessionToken = {json.dumps(session_token or '')};
    const sessionExpires = {json.dumps(session_expires.isoformat() if session_expires else '')};
    const linkedExisting = {json.dumps(bool(link_owner))};
    
    if (userEmail && userEmail.indexOf('@') !== -1) {{
      localStorage.setItem('hdsfd_google_account', userEmail);
      localStorage.setItem('hdsfd_google_name', userName);
      if (!linkedExisting) {{
        localStorage.setItem('hdsfd_user_name', userName);
      }}
      if (sessionToken) {{
        localStorage.setItem('hdsfd_auth_token', sessionToken);
        localStorage.setItem('hdsfd_auth_user', userEmail);
        localStorage.setItem('hdsfd_auth_expires', sessionExpires);
      }}
    }}
    
    const authData = {{
      type: 'gdrive_linked',
      username: userEmail,
      name: userName,
      token: sessionToken,
      expires_at: sessionExpires,
      keep_session: linkedExisting
    }};
    
    if (window.opener && !window.opener.closed) {{
      try {{
        window.opener.postMessage(authData, window.location.origin);
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
    username, error = _session_owner(data.get('username'))
    if error:
        return error
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
                
            # 3. ai.json backup upload (complete AI context, chat history, and study data)
            ai_data = data.get('full_context') or {
                'username': username,
                'notes_count': len(notes),
                'notes': notes,
                'app_info': 'HDSFD (HD Student Focus Dashboard) — Student Focus Sanctuary & Productivity Workspace'
            }
            ai_body = json.dumps(ai_data, indent=2)
            media_ai = MediaInMemoryUpload(ai_body.encode('utf-8'), mimetype='application/json')
            ai_q = f"name='ai.json' and '{folder_id}' in parents and trashed=false"
            existing_ai = service.files().list(q=ai_q, fields='files(id)').execute().get('files', [])
            if existing_ai:
                service.files().update(fileId=existing_ai[0]['id'], media_body=media_ai).execute()
            else:
                service.files().create(body={'name': 'ai.json', 'parents': [folder_id]}, media_body=media_ai).execute()

            drive_synced = True
        except Exception as e:
            logger.error(f"Google Drive Backup upload error: {e}")

    return jsonify({
        "status": "success",
        "drive_synced": drive_synced,
        "folder": "HDSFD Backup",
        "files": ["Notes.json", "ai.json"],
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
    username, error = _session_owner(request.args.get('username') or data.get('username'))
    if error:
        return error
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
    username, error = _session_owner(request.args.get('username') or data.get('username'))
    if error:
        return error
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
    username, error = _session_owner(request.args.get('username'))
    if error:
        return error
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
    username, error = _session_owner(request.args.get('username') or data.get('username'))
    if error:
        return error
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


# ===== HDSFD MUSIC ENGINE (search here, playback in the browser) =====
# This host only searches: results are scraped server-side, so no API key is
# needed. Playback runs entirely in the browser against the music relay (a
# Cloudflare Worker) which speaks Innertube and proxies the audio with Range
# support, giving ad-free audio with working seeking. Nothing here relays audio,
# so a host whose network blocks youtube.com cannot break playback. If the relay
# cannot serve a track the client falls back to the official YouTube embed.
import threading as _threading
import time as _time

_YT_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
_MUSIC_SEARCH_CACHE = {}
_MUSIC_LOCK = _threading.Lock()
_MUSIC_SEARCH_TTL = 15 * 60


def _music_clean(value):
    import html as _html
    if value is None:
        return ''
    return _html.unescape(str(value)).strip()


def _music_duration_seconds(label):
    parts = [p.strip() for p in str(label or '').split(':') if p.strip().isdigit()]
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return total


_YT_RESULTS_URL = 'https://www.youtube.com/results'
_YT_READER_PROXY = 'https://r.jina.ai/'


def _extract_initial_data(page):
    """Pull the ytInitialData JSON object out of a YouTube results page."""
    import json as _json
    for marker in ('ytInitialData = {', 'ytInitialData ={'):
        start = page.find(marker)
        if start < 0:
            continue
        start = page.find('{', start)
        depth = 0
        in_string = False
        escaped = False
        for pos in range(start, len(page)):
            char = page[pos]
            if in_string:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return _json.loads(page[start:pos + 1])
                    except Exception:
                        return None
    return None


def _fetch_youtube_results_page(query):
    """Fetch youtube.com search results, with a fallback for restricted hosts.

    PythonAnywhere's free tier proxies outbound traffic and blocks youtube.com,
    so the public reader proxy is used there. Everywhere else the direct request
    still wins and nothing about local behaviour changes.
    """
    import requests as _requests
    target = _YT_RESULTS_URL + '?' + urllib.parse.urlencode({
        'search_query': query,
        'sp': 'EgIQAQ%3D%3D',  # videos only
    })
    direct_error = None
    try:
        response = _requests.get(
            target,
            headers={'User-Agent': _YT_UA, 'Accept-Language': 'en-US,en;q=0.9'},
            timeout=12,
        )
        response.raise_for_status()
        if 'videoId' in response.text:
            return response.text
    except Exception as exc:
        direct_error = exc
    try:
        response = _requests.get(
            _YT_READER_PROXY + target,
            headers={
                'User-Agent': _YT_UA,
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Return-Format': 'html',
            },
            timeout=45,
        )
        response.raise_for_status()
        if 'videoId' in response.text:
            return response.text
        raise RuntimeError('reader proxy returned no videos')
    except Exception as exc:
        logger.warning(f"YouTube search transport failed ({direct_error!r} / {exc!r})")
        raise RuntimeError('YouTube search is temporarily unavailable') from None


def _youtube_search_results(query, limit=14):
    """Search YouTube for video metadata (id, title, channel, duration)."""
    import re as _re

    cache_key = (query or '').strip().lower()
    now = _time.time()
    with _MUSIC_LOCK:
        cached = _MUSIC_SEARCH_CACHE.get(cache_key)
    if cached and cached.get('expires', 0) > now:
        return cached['results'][:limit]

    page = _fetch_youtube_results_page(query)
    data = _extract_initial_data(page)

    results = []
    seen = set()

    if data is not None:
        stack = [data]
        while stack and len(results) < limit * 2:
            node = stack.pop()
            if isinstance(node, dict):
                renderer = node.get('videoRenderer')
                if isinstance(renderer, dict):
                    vid = renderer.get('videoId')
                    if vid and vid not in seen:
                        seen.add(vid)
                        title = ''.join(
                            run.get('text', '') for run in (renderer.get('title') or {}).get('runs', [])
                        )
                        channel = ''.join(
                            run.get('text', '') for run in (renderer.get('ownerText') or {}).get('runs', [])
                        )
                        length = (renderer.get('lengthText') or {}).get('simpleText', '')
                        is_live = any(
                            'LIVE' in json_dump
                            for json_dump in [
                                str((badge or {}).get('metadataBadgeRenderer', {}).get('label', ''))
                                for badge in (renderer.get('badges') or [])
                            ]
                        )
                        results.append({
                            'id': vid,
                            'title': _music_clean(title) or query,
                            'channel': _music_clean(channel),
                            'duration': _music_clean(length),
                            'seconds': _music_duration_seconds(length),
                            'views': _music_clean((renderer.get('viewCountText') or {}).get('simpleText', '')),
                            'live': is_live,
                            'thumbnail': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
                            'url': f'https://www.youtube.com/watch?v={vid}',
                        })
                for value in node.values():
                    if isinstance(value, (dict, list)):
                        stack.append(value)
            elif isinstance(node, list):
                stack.extend(value for value in node if isinstance(value, (dict, list)))

    # Regex fallback if the JSON tree shape changed
    if not results:
        ids = _re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', page)
        titles = _re.findall(r'"title":\{"runs":\[\{"text":"([^"]+)"', page)
        for index, vid in enumerate(ids):
            if vid in seen:
                continue
            seen.add(vid)
            results.append({
                'id': vid,
                'title': _music_clean(titles[index]) if index < len(titles) else query,
                'channel': '',
                'duration': '',
                'seconds': 0,
                'live': False,
                'thumbnail': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
                'url': f'https://www.youtube.com/watch?v={vid}',
            })
            if len(results) >= limit * 2:
                break

    results = [item for item in results if not item.get('live')][:limit]
    with _MUSIC_LOCK:
        _MUSIC_SEARCH_CACHE[cache_key] = {'results': results, 'expires': now + _MUSIC_SEARCH_TTL}
    return results


# ---- Music recommendations -------------------------------------------------
# Search prefers the Cloudflare relay (fast, and reachable from hosts that block
# youtube.com). The old scrape stays as a fallback. Feed and radio reuse the same
# cached search, so a personalised home screen is a handful of cheap lookups.

_MUSIC_RESULT_CACHE = {}
_MUSIC_FEED_CACHE = {}
_MUSIC_RADIO_CACHE = {}
_MUSIC_RESULT_TTL = 10 * 60
_MUSIC_FEED_TTL = 20 * 60
_MUSIC_RADIO_TTL = 30 * 60

import re as _music_re
_MUSIC_VIDEO_ID = _music_re.compile(r'^[A-Za-z0-9_-]{11}$')
_MUSIC_NOISE_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from',
    'by', 'at', 'is', 'it', 'this', 'that', 'official', 'video', 'audio', 'lyrics',
    'lyric', 'music', 'song', 'songs', 'ft', 'feat', 'featuring', 'remix', 'version',
    'live', 'hd', 'hq', '4k', 'mv', 'visualizer', 'full', 'album', 'radio', 'mix'
}

# Rotated daily so "Trending" is not one frozen list forever.
_MUSIC_TRENDING_ROTATION = [
    ['top hits this week', 'trending songs', 'billboard hot 100', 'viral songs'],
    ['new music this week', 'popular songs right now', 'top 50 songs', 'trending music videos'],
    ['best songs this year', 'spotify top hits', 'pop hits playlist', 'hip hop hits'],
    ['trending music', 'most played songs', 'global top songs', 'charts this week'],
]


def _music_normalize(item):
    """Return a clean, client-shaped track or None."""
    if not isinstance(item, dict):
        return None
    vid = str(item.get('id') or '').strip()
    if not _MUSIC_VIDEO_ID.match(vid):
        return None
    duration = str(item.get('duration') or '').strip()
    seconds = item.get('seconds')
    if not seconds:
        seconds = _music_duration_seconds(duration)
    return {
        'id': vid,
        'title': _music_clean(item.get('title')) or 'Untitled',
        'channel': _music_clean(item.get('channel')) or 'YouTube',
        'duration': duration,
        'seconds': int(seconds or 0),
        'views': _music_clean(item.get('views')),
        'live': bool(item.get('live')),
        'thumbnail': item.get('thumbnail') or f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
        'url': item.get('url') or f'https://www.youtube.com/watch?v={vid}',
    }


def _music_tokens(text):
    import re as _re
    words = _re.findall(r'[a-z0-9]+', str(text or '').lower())
    return [word for word in words if len(word) > 1 and word not in _MUSIC_NOISE_WORDS]


def _music_title_key(text):
    return ' '.join(_music_tokens(text))[:90]


def _music_channel_key(text):
    import re as _re
    value = _re.sub(r'\s*-\s*topic$', '', str(text or '').lower())
    return _re.sub(r'[^a-z0-9]+', ' ', value).strip()[:80]


def _music_views_number(value):
    import re as _re
    text = str(value or '')
    match = _re.search(r'([\d.,]+)\s*([KMB])', text, _re.I)
    if not match:
        digits = _re.sub(r'[^\d]', '', text)
        return int(digits) if digits else 0
    try:
        number = float(match.group(1).replace(',', ''))
    except ValueError:
        return 0
    scale = {'k': 1_000, 'm': 1_000_000, 'b': 1_000_000_000}.get(match.group(2).lower(), 1)
    return int(number * scale)


def _music_dedupe(items, limit=None):
    seen_ids = set()
    seen_keys = set()
    output = []
    for raw in items or []:
        item = _music_normalize(raw)
        if not item:
            continue
        key = _music_title_key(item['title'])
        if key:
            key = key + '|' + _music_channel_key(item['channel'])
        else:
            key = item['id']
        if item['id'] in seen_ids or key in seen_keys:
            continue
        seen_ids.add(item['id'])
        seen_keys.add(key)
        output.append(item)
        if limit and len(output) >= limit:
            break
    return output


def _music_relay_search(query, limit=14):
    """Search through the relay. Returns None when the relay is not configured."""
    base = (MUSIC_RELAY_BASE or '').strip()
    if not base:
        return None
    try:
        import requests as _requests
        response = _requests.get(
            base.rstrip('/') + '/api/search',
            params={'q': query, 'limit': int(limit)},
            headers={'User-Agent': _YT_UA, 'Accept': 'application/json'},
            timeout=9,
        )
        if response.status_code != 200:
            return None
        payload = response.json()
        results = payload.get('results') if isinstance(payload, dict) else None
        if not isinstance(results, list) or not results:
            return None
        return [item for item in (_music_normalize(entry) for entry in results) if item]
    except Exception as exc:
        logger.info(f"Relay search unavailable for '{query}': {exc}")
        return None


def _music_search(query, limit=14, allow_relay=True):
    """Cached search: relay first (signed-in only), local scrape second."""
    query = (query or '').strip()[:160]
    if not query:
        return []
    limit = max(1, min(30, int(limit or 14)))
    allow_relay = bool(allow_relay)
    cache_key = (query.lower(), limit, allow_relay)
    now = _time.time()
    with _MUSIC_LOCK:
        cached = _MUSIC_RESULT_CACHE.get(cache_key)
    if cached and cached.get('expires', 0) > now:
        return cached['results']

    results = _music_relay_search(query, limit) if allow_relay else None
    if not results:
        try:
            results = _youtube_search_results(query, limit)
        except Exception as exc:
            logger.warning(f"Music search failed for '{query}': {exc}")
            results = []
    results = _music_dedupe(results, limit)
    with _MUSIC_LOCK:
        if len(_MUSIC_RESULT_CACHE) > 300:
            _MUSIC_RESULT_CACHE.clear()
        _MUSIC_RESULT_CACHE[cache_key] = {'results': results, 'expires': now + _MUSIC_RESULT_TTL}
    return results


def _music_safe_search(query, limit=10, allow_relay=True):
    try:
        return _music_search(query, limit, allow_relay=allow_relay)
    except Exception:
        return []


def _music_parallel_search(queries, per_query=10, allow_relay=True):
    unique = [query for query in dict.fromkeys(queries) if query][:5]
    if not unique:
        return []
    allow_relay = bool(allow_relay)
    try:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(3, len(unique))) as pool:
            lists = list(pool.map(lambda query: _music_safe_search(query, per_query, allow_relay), unique))
    except Exception:
        lists = [_music_safe_search(query, per_query, allow_relay) for query in unique]
    merged = []
    for group in lists:
        merged.extend(group)
    return merged


# ---- Last.fm + YouTube Music similarity -----------------------------------
# Last.fm supplies a curated "sounds like" graph; ytmusicapi turns those names
# into playable video ids and provides YouTube Music's own watch-playlist radio.
# Both are optional: an empty LASTFM_API_KEY, a missing ytmusicapi or a failed
# request all fall back to the search-based ranking below, so playback never
# depends on either service.
LASTFM_API_KEY = (os.environ.get('LASTFM_API_KEY') or '').strip()
LASTFM_API_ROOT = 'https://ws.audioscrobbler.com/2.0/'
_MUSIC_LASTFM_CACHE = {}
_MUSIC_LASTFM_TTL = 6 * 60 * 60
_MUSIC_YTM_CACHE = {}
_MUSIC_YTM_TTL = 30 * 60
_MUSIC_YTM_STATE = {'checked': False, 'available': False}
_MUSIC_YTM_LOCK = _threading.Lock()
_MUSIC_YTM_LOCAL = _threading.local()

# ytmusicapi is vendored so PythonAnywhere's free tier needs no pip step.
_VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')
if os.path.isdir(_VENDOR_DIR) and _VENDOR_DIR not in sys.path:
    sys.path.append(_VENDOR_DIR)


def _music_cache_read(cache, key):
    now = _time.time()
    with _MUSIC_LOCK:
        entry = cache.get(key)
    if entry and entry.get('expires', 0) > now:
        return entry
    return None


def _music_cache_write(cache, key, value, ttl, cap=300):
    with _MUSIC_LOCK:
        if len(cache) > cap:
            cache.clear()
        value = dict(value)
        value['expires'] = _time.time() + ttl
        cache[key] = value


def _lastfm_call(method, **params):
    """One Last.fm API call. Returns None when unconfigured or unavailable."""
    if not LASTFM_API_KEY:
        return None
    query = {'method': method, 'api_key': LASTFM_API_KEY, 'format': 'json', 'autocorrect': 1}
    query.update({name: value for name, value in params.items() if value not in (None, '')})
    try:
        import requests as _requests
        response = _requests.get(
            LASTFM_API_ROOT,
            params=query,
            headers={'User-Agent': _YT_UA, 'Accept': 'application/json'},
            timeout=6,
        )
        if response.status_code != 200:
            logger.info(f'Last.fm {method} returned HTTP {response.status_code}')
            return None
        data = response.json()
        if not isinstance(data, dict) or data.get('error'):
            logger.info(f"Last.fm {method} failed: {(data or {}).get('message', 'invalid response')}")
            return None
        return data
    except Exception as exc:
        logger.info(f'Last.fm {method} unreachable: {exc}')
        return None


def _lastfm_list(value):
    if isinstance(value, list):
        return value
    return [value] if isinstance(value, dict) else []


def _lastfm_similar_tracks(artist, title, limit=12):
    artist, title = _music_clean(artist), _music_clean(title)
    if not LASTFM_API_KEY or not artist or not title:
        return []
    key = ('similar', artist.lower(), title.lower(), int(limit))
    cached = _music_cache_read(_MUSIC_LASTFM_CACHE, key)
    if cached is not None:
        return cached['results']
    data = _lastfm_call('track.getsimilar', artist=artist, track=title, limit=int(limit))
    rows = ((data or {}).get('similartracks') or {}).get('track')
    results = []
    for row in _lastfm_list(rows)[:int(limit)]:
        if not isinstance(row, dict):
            continue
        name = _music_clean(row.get('name'))
        row_artist = row.get('artist')
        if isinstance(row_artist, dict):
            row_artist = _music_clean(row_artist.get('name'))
        else:
            row_artist = _music_clean(row_artist)
        if not name or not row_artist:
            continue
        try:
            match = float(row.get('match') or 0)
        except (TypeError, ValueError):
            match = 0.0
        results.append({'title': name, 'artist': row_artist, 'match': match})
    _music_cache_write(_MUSIC_LASTFM_CACHE, key, {'results': results}, _MUSIC_LASTFM_TTL)
    return results


def _lastfm_tag_top_tracks(tag, limit=15):
    tag = _music_clean(tag)
    if not LASTFM_API_KEY or not tag:
        return []
    key = ('tag', tag.lower(), int(limit))
    cached = _music_cache_read(_MUSIC_LASTFM_CACHE, key)
    if cached is not None:
        return cached['results']
    data = _lastfm_call('tag.gettoptracks', tag=tag, limit=int(limit))
    rows = ((data or {}).get('tracks') or {}).get('track')
    results = []
    for row in _lastfm_list(rows)[:int(limit)]:
        if not isinstance(row, dict):
            continue
        name = _music_clean(row.get('name'))
        row_artist = row.get('artist')
        if isinstance(row_artist, dict):
            row_artist = _music_clean(row_artist.get('name'))
        else:
            row_artist = _music_clean(row_artist)
        if name and row_artist:
            results.append({'title': name, 'artist': row_artist, 'match': 0.0})
    _music_cache_write(_MUSIC_LASTFM_CACHE, key, {'results': results}, _MUSIC_LASTFM_TTL)
    return results


def _ytmusic_supported():
    """True when the optional ytmusicapi package can be imported."""
    with _MUSIC_YTM_LOCK:
        if not _MUSIC_YTM_STATE['checked']:
            _MUSIC_YTM_STATE['checked'] = True
            try:
                import ytmusicapi  # noqa: F401
                _MUSIC_YTM_STATE['available'] = True
            except Exception as exc:
                logger.info(f'ytmusicapi not installed; using search radio: {exc}')
                _MUSIC_YTM_STATE['available'] = False
        return bool(_MUSIC_YTM_STATE['available'])


def _ytmusic_client():
    """A per-thread client; YTMusic sessions are not shared across threads."""
    if not _ytmusic_supported():
        return None
    client = getattr(_MUSIC_YTM_LOCAL, 'client', None)
    if client is not None:
        return client
    try:
        from ytmusicapi import YTMusic
        client = YTMusic()
    except Exception as exc:
        logger.info(f'ytmusicapi client unavailable: {exc}')
        client = None
    _MUSIC_YTM_LOCAL.client = client
    return client


def _ytmusic_normalize(item):
    if not isinstance(item, dict) or item.get('isAvailable') is False:
        return None
    vid = str(item.get('videoId') or '').strip()
    if not _MUSIC_VIDEO_ID.match(vid):
        return None
    names = []
    for artist in _lastfm_list(item.get('artists')):
        name = artist.get('name') if isinstance(artist, dict) else artist
        name = _music_clean(name)
        if name and name not in names:
            names.append(name)
    channel = ', '.join(names[:2]) or _music_clean(item.get('author')) or 'YouTube Music'
    duration = _music_clean(item.get('duration') or item.get('length'))
    seconds = item.get('duration_seconds') or _music_duration_seconds(duration)
    thumb = ''
    thumbs = item.get('thumbnail') or item.get('thumbnails')
    if isinstance(thumbs, list) and thumbs:
        largest = thumbs[-1]
        if isinstance(largest, dict):
            thumb = largest.get('url') or ''
    return _music_normalize({
        'id': vid,
        'title': item.get('title'),
        'channel': channel,
        'duration': duration,
        'seconds': seconds,
        'views': item.get('views'),
        'thumbnail': thumb or f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
    })


def _ytmusic_search_songs(query, limit=15):
    query = _music_clean(query)[:160]
    if not query or not _ytmusic_supported():
        return []
    key = ('search', query.lower(), int(limit))
    cached = _music_cache_read(_MUSIC_YTM_CACHE, key)
    if cached is not None:
        return cached['results']
    client = _ytmusic_client()
    results = []
    if client is not None:
        try:
            rows = client.search(query, filter='songs', limit=int(limit)) or []
            results = [track for track in (_ytmusic_normalize(row) for row in rows) if track][:int(limit)]
        except Exception as exc:
            logger.info(f'YT Music search failed for {query!r}: {exc}')
    _music_cache_write(_MUSIC_YTM_CACHE, key, {'results': results}, _MUSIC_YTM_TTL)
    return results


def _ytmusic_search_track(artist, title):
    """Resolve one Last.fm track name to a playable YouTube Music song."""
    artist, title = _music_clean(artist), _music_clean(title)
    if not artist or not title or not _ytmusic_supported():
        return None
    key = ('track', artist.lower(), title.lower())
    cached = _music_cache_read(_MUSIC_YTM_CACHE, key)
    if cached is not None:
        return cached['track']
    found = None
    client = _ytmusic_client()
    if client is not None:
        try:
            rows = client.search(f'{artist} {title}', filter='songs', limit=3) or []
        except Exception as exc:
            logger.info(f'YT Music resolve failed for {artist} - {title}: {exc}')
            rows = []
        for row in rows:
            found = _ytmusic_normalize(row)
            if found:
                break
    _music_cache_write(_MUSIC_YTM_CACHE, key, {'track': found}, _MUSIC_YTM_TTL)
    return found


def _music_resolve_lastfm_tracks(rows, limit=8):
    """Resolve Last.fm names in parallel so a radio request stays responsive."""
    if not _ytmusic_supported():
        return []
    pairs = []
    seen = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        artist, title = _music_clean(row.get('artist')), _music_clean(row.get('title'))
        pair = (artist, title)
        if not artist or not title or pair[0].lower() + '|' + pair[1].lower() in seen:
            continue
        seen.add(pair[0].lower() + '|' + pair[1].lower())
        pairs.append(pair)
        if len(pairs) >= max(1, int(limit)):
            break
    if not pairs:
        return []

    def resolve(pair):
        try:
            return _ytmusic_search_track(pair[0], pair[1])
        except Exception:
            return None

    try:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(6, len(pairs))) as pool:
            resolved = list(pool.map(resolve, pairs))
    except Exception:
        resolved = [resolve(pair) for pair in pairs]
    return [track for track in resolved if track]


def _lastfm_radio(artist, title, limit=8):
    rows = _lastfm_similar_tracks(artist, title, limit=max(int(limit), 12))
    return _music_resolve_lastfm_tracks(rows, limit=limit)


def _ytmusic_watch_playlist(video_id, limit=20):
    video_id = str(video_id or '').strip()
    if not _MUSIC_VIDEO_ID.match(video_id) or not _ytmusic_supported():
        return []
    limit = max(1, min(50, int(limit or 20)))
    key = ('watch', video_id, limit)
    cached = _music_cache_read(_MUSIC_YTM_CACHE, key)
    if cached is not None:
        return cached['results']
    results = []
    client = _ytmusic_client()
    if client is not None:
        try:
            data = client.get_watch_playlist(videoId=video_id, limit=limit) or {}
            rows = data.get('tracks') or []
            results = [track for track in (_ytmusic_normalize(row) for row in rows) if track][:limit]
        except Exception as exc:
            logger.info(f'YT Music watch playlist failed for {video_id}: {exc}')
    _music_cache_write(_MUSIC_YTM_CACHE, key, {'results': results}, _MUSIC_YTM_TTL)
    return results


def _music_seed_tracks(seeds):
    """Accept the client's top saved/played tracks as station seeds."""
    output = []
    for raw in (seeds or [])[:3]:
        if not isinstance(raw, dict):
            continue
        vid = str(raw.get('videoId') or raw.get('id') or '').strip()
        if not _MUSIC_VIDEO_ID.match(vid):
            continue
        if any(entry['id'] == vid for entry in output):
            continue
        output.append({
            'id': vid,
            'title': _music_clean(raw.get('title')) or 'Saved track',
            'channel': _music_clean(raw.get('channel') or raw.get('artist')),
        })
    return output


def _music_feed_payload(profile, limit=18, allow_relay=True, seeds=None):
    """My Mix for a listener with taste, trending for a brand-new guest."""
    profile = profile if isinstance(profile, dict) else {}
    allow_relay = bool(allow_relay)
    limit = max(6, min(30, int(limit or 18)))
    seed_tracks = _music_seed_tracks(seeds)
    artists = [str(name).strip()[:60] for name in (profile.get('artists') or []) if str(name).strip()][:6]
    terms = [str(term).strip()[:40] for term in (profile.get('terms') or []) if str(term).strip()][:6]
    plays = int(profile.get('plays') or 0)
    disliked = set(str(value) for value in (profile.get('disliked') or [])[:60])
    personalized = bool(seed_tracks) or len(artists) >= 2 or plays >= 4
    day = int(_time.time() // 86400)

    if seed_tracks:
        # Seed from the exact tracks the listener saved or played most, so the
        # first card in My Mix sounds like their library, not a generic chart.
        queries = []
        for seed in seed_tracks:
            if seed['channel']:
                queries.append(f"{seed['channel']} radio")
                queries.append(f"{seed['channel']} songs")
            words = ' '.join(_music_tokens(seed['title'])[:3])
            if words:
                queries.append(words)
            if len(queries) >= 5:
                break
        queries.append('new music this week')
        cache_key = ('m', tuple(seed['id'] for seed in seed_tracks), day, limit, allow_relay)
        title = 'My Mix'
        subtitle = 'A station built from your saved and most-played tracks'
    elif personalized:
        queries = [f'{artist} songs' for artist in artists[:3]]
        queries += [f'{term} mix' for term in terms[:2]]
        queries.append('new music this week')
        cache_key = ('p', tuple(artists[:3]), tuple(terms[:2]), day, limit, allow_relay)
        title = 'Made for you'
        subtitle = f'Built from {len(artists)} artist{"s" if len(artists) != 1 else ""} you play'
    else:
        queries = list(_MUSIC_TRENDING_ROTATION[day % len(_MUSIC_TRENDING_ROTATION)])
        cache_key = ('t', day, limit, allow_relay)
        title = 'Trending now'
        subtitle = 'The biggest tracks everyone is playing'

    now = _time.time()
    with _MUSIC_LOCK:
        cached = _MUSIC_FEED_CACHE.get(cache_key)
    if cached and cached.get('expires', 0) > now:
        cached_results = [item for item in cached['results'] if item['id'] not in disliked][:limit]
        if cached_results:
            return {'mode': 'personalized' if personalized else 'trending', 'title': title,
                    'subtitle': subtitle, 'results': cached_results}

    station = []
    if seed_tracks:
        try:
            station.extend(_ytmusic_watch_playlist(seed_tracks[0]['id'], limit=22))
        except Exception as exc:
            logger.info(f'My Mix watch playlist unavailable: {exc}')
        if LASTFM_API_KEY and seed_tracks[0]['channel']:
            try:
                station = _lastfm_radio(seed_tracks[0]['channel'], seed_tracks[0]['title'], limit=8) + station
            except Exception as exc:
                logger.info(f'My Mix Last.fm seed unavailable: {exc}')

    items = _music_parallel_search(queries, per_query=10, allow_relay=allow_relay)
    items = _music_dedupe(items)
    affinity = {_music_channel_key(name): max(1.0, 7.0 - index * 1.2) for index, name in enumerate(artists)}
    term_tokens = set()
    for term in terms:
        term_tokens.update(_music_tokens(term))

    def score(item):
        value = min(9.0, _music_views_number(item.get('views')) / 300_000.0)
        value += affinity.get(_music_channel_key(item.get('channel')), 0)
        overlap = term_tokens & set(_music_tokens(item.get('title')))
        value += min(2.4, 0.7 * len(overlap))
        if item['id'] in disliked:
            value -= 25
        return value

    items.sort(key=score, reverse=True)
    pooled = _music_dedupe(station + items)
    results = [item for item in pooled if item['id'] not in disliked][:limit]
    with _MUSIC_LOCK:
        if len(_MUSIC_FEED_CACHE) > 100:
            _MUSIC_FEED_CACHE.clear()
        _MUSIC_FEED_CACHE[cache_key] = {'results': results, 'expires': now + _MUSIC_FEED_TTL}
    return {'mode': 'personalized' if personalized else 'trending', 'title': title,
            'subtitle': subtitle, 'results': results}


def _music_radio_payload(payload, limit=12, allow_relay=True):
    payload = payload if isinstance(payload, dict) else {}
    allow_relay = bool(allow_relay)
    limit = max(4, min(24, int(payload.get('limit') or 12)))
    seed_id = str(payload.get('videoId') or '').strip()
    title = _music_clean(payload.get('title'))
    channel = _music_clean(payload.get('channel'))
    artist = _music_clean(payload.get('artist')) or channel
    artists = [str(name).strip()[:60] for name in (payload.get('artists') or []) if str(name).strip()][:6]
    exclude = set(str(value) for value in (payload.get('exclude') or [])[:120])
    if seed_id:
        exclude.add(seed_id)

    cache_key = (seed_id or _music_title_key(title + ' ' + channel), allow_relay, bool(LASTFM_API_KEY))
    now = _time.time()
    with _MUSIC_LOCK:
        cached = _MUSIC_RADIO_CACHE.get(cache_key)
    source = 'search'
    if cached and cached.get('expires', 0) > now:
        pool = cached['results']
        source = cached.get('source') or source
    else:
        # Layer 1: Last.fm's scrobble graph finds the closest *songs*, which
        # then resolve to playable ids through YouTube Music.
        lastfm_items = []
        if LASTFM_API_KEY and title and (artist or channel):
            try:
                lastfm_items = _lastfm_radio(artist or channel, title, limit=8)
            except Exception as exc:
                logger.info(f'Last.fm radio unavailable: {exc}')

        # Layer 2: YouTube Music's own watch-playlist radio. This is what keeps
        # niche uploads, remixes and empty-key installs populated.
        watch_items = []
        if seed_id:
            try:
                watch_items = _ytmusic_watch_playlist(seed_id, limit=22)
            except Exception as exc:
                logger.info(f'YT Music radio unavailable: {exc}')

        # Layer 3: the existing cached search ranking, always as backfill.
        words = [word for word in _music_tokens(title) if word not in ('topic',)][:3]
        queries = []
        if channel:
            queries.append(f'{channel} radio')
            queries.append(f'{channel} songs')
        if words:
            queries.append((channel + ' ' if channel else '') + ' '.join(words))
        if channel and words:
            queries.append(f'{channel} {words[0]}')
        queries.append('songs like ' + (title or channel or 'this track'))
        items = _music_parallel_search(queries, per_query=10, allow_relay=allow_relay)
        items = _music_dedupe(items)

        seed_tokens = set(_music_tokens(title))
        channel_key = _music_channel_key(channel)
        affinity = {_music_channel_key(name): max(1.0, 6.0 - index) for index, name in enumerate(artists)}

        def score(item):
            value = 0.0
            item_channel = _music_channel_key(item.get('channel'))
            if channel_key and item_channel == channel_key:
                value += 8.0
            elif channel_key and channel_key in item_channel:
                value += 3.0
            value += 1.8 * len(seed_tokens & set(_music_tokens(item.get('title'))))
            value += affinity.get(item_channel, 0)
            value += min(2.0, _music_views_number(item.get('views')) / 1_000_000.0)
            if item['id'] in exclude:
                value -= 20
            return value

        items.sort(key=score, reverse=True)
        heuristic = items[:40]
        pool = _music_dedupe(lastfm_items + watch_items + heuristic)[:70]
        source = '+'.join(name for name, present in (
            ('lastfm', lastfm_items), ('ytmusic', watch_items), ('search', heuristic)
        ) if present) or 'search'
        with _MUSIC_LOCK:
            if len(_MUSIC_RADIO_CACHE) > 120:
                _MUSIC_RADIO_CACHE.clear()
            _MUSIC_RADIO_CACHE[cache_key] = {'results': pool, 'expires': now + _MUSIC_RADIO_TTL, 'source': source}

    results = [item for item in pool if item['id'] not in exclude][:limit]
    return {'mode': 'radio', 'seed': seed_id, 'source': source, 'results': results}


_MUSIC_DISCOVER_TAGS = {
    'lo-fi': ('lofi', 'lofi study beats', 'Lo-fi'),
    'lofi': ('lofi', 'lofi study beats', 'Lo-fi'),
    'study': ('study', 'study music playlist', 'Study'),
    'hip hop': ('hip hop', 'hip hop hits', 'Hip hop'),
    'hip-hop': ('hip hop', 'hip hop hits', 'Hip hop'),
    'classical': ('classical', 'classical piano', 'Classical'),
    'jazz': ('jazz', 'jazz', 'Jazz'),
    'k-pop': ('k-pop', 'k-pop', 'K-pop'),
    'kpop': ('k-pop', 'k-pop', 'K-pop'),
    'phonk': ('phonk', 'phonk', 'Phonk'),
    'nature': ('nature', 'nature sounds', 'Nature'),
    'rock': ('rock', 'rock songs', 'Rock'),
    'pop': ('pop', 'pop hits', 'Pop'),
    'indie': ('indie', 'indie songs', 'Indie'),
    'edm': ('electronic', 'edm', 'EDM'),
    'electronic': ('electronic', 'electronic music', 'Electronic'),
    'rnb': ('rnb', 'r&b songs', 'R&B'),
    'r&b': ('rnb', 'r&b songs', 'R&B'),
}


def _music_discover_payload(tag, limit=15, allow_relay=True):
    """Curated tag radio for the genre pills, with or without Last.fm."""
    raw = _music_clean(tag)[:40]
    if not raw:
        return {'tag': '', 'label': '', 'source': 'none', 'results': []}
    lastfm_tag, query, label = _MUSIC_DISCOVER_TAGS.get(
        raw.lower(), (raw.lower(), f'{raw} music', raw.title())
    )
    limit = max(6, min(24, int(limit or 15)))
    key = ('discover', lastfm_tag, limit, allow_relay, bool(LASTFM_API_KEY))
    cached = _music_cache_read(_MUSIC_RADIO_CACHE, key)
    if cached is not None:
        return cached['payload']

    lastfm_items = []
    if LASTFM_API_KEY:
        try:
            lastfm_items = _music_resolve_lastfm_tracks(_lastfm_tag_top_tracks(lastfm_tag, 15), limit=8)
        except Exception as exc:
            logger.info(f'Last.fm tag discovery unavailable for {lastfm_tag}: {exc}')
    ytm_items = []
    try:
        ytm_items = _ytmusic_search_songs(query, limit=limit)
    except Exception as exc:
        logger.info(f'YT Music discovery unavailable for {query}: {exc}')
    search_items = _music_search(query, limit, allow_relay=allow_relay)

    # Last.fm tags are broad ("phonk" also catches K-pop), so YouTube Music's
    # matching search leads and the tag graph plus cached search enrich it.
    pool = _music_dedupe(ytm_items + lastfm_items + search_items)
    source = '+'.join(name for name, present in (
        ('ytmusic', ytm_items), ('lastfm', lastfm_items), ('search', search_items)
    ) if present) or 'none'
    payload = {'tag': raw, 'label': label, 'source': source, 'results': pool[:limit]}
    _music_cache_write(_MUSIC_RADIO_CACHE, key, {'payload': payload}, _MUSIC_RADIO_TTL)
    return payload


# ---- Music relay -----------------------------------------------------------
# The browser talks to the relay directly (POST /api/player for Innertube formats,
# GET /api/stream for the bytes). The relay address is deployment configuration,
# not source: it comes from HDSFD_MUSIC_RELAY or from music_relay.json, which is
# gitignored so no account details ever reach the public repository.
MUSIC_RELAY_CONFIG_FILE = 'music_relay.json'


def _load_music_relay_base():
    configured = (os.environ.get('HDSFD_MUSIC_RELAY') or '').strip()
    if configured:
        return configured.rstrip('/')
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), MUSIC_RELAY_CONFIG_FILE),
        os.path.join(os.getcwd(), MUSIC_RELAY_CONFIG_FILE),
        f'/home/HDSFD/HDSFD/{MUSIC_RELAY_CONFIG_FILE}',
        f'/home/HDSFD/HDSFD/backend/{MUSIC_RELAY_CONFIG_FILE}',
    ]
    for path in candidates:
        try:
            with open(path, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            continue
        relay = str(data.get('relay_base') or '').strip()
        if relay:
            return relay.rstrip('/')
    return ''


MUSIC_RELAY_BASE = _load_music_relay_base()


@app.route('/api/music/config', methods=['GET'])
def music_config():
    """Advertise the relay only to a signed-in session.

    Guest mode is deliberately Cloudflare-free: it must play through the old
    YouTube embed (ads, low quality) and never learn the relay origin.
    """
    signed_in = bool(current_user())
    relay_base = MUSIC_RELAY_BASE if signed_in else ''
    response = jsonify({
        'status': 'success',
        'guest': not signed_in,
        'relay': bool(relay_base),
        'relay_base': relay_base or None,
        'engine': 'innertube-relay' if relay_base else ('youtube-embed' if not signed_in else 'unconfigured'),
        'quality': 'tiny' if not signed_in else 'best',
    })
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/api/music/search', methods=['GET'])
def music_search():
    query = (request.args.get('q') or '').strip()
    if not query:
        return jsonify({'status': 'error', 'message': 'No query provided', 'results': []}), 400
    if len(query) > 160:
        query = query[:160]
    limit = request.args.get('limit', 14, type=int) or 14
    try:
        # Guests are forced onto the local YouTube scrape: no relay, ever.
        allow_relay = bool(current_user())
        results = _music_search(query, limit, allow_relay=allow_relay)
        response = jsonify({'status': 'success', 'query': query, 'results': results})
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as exc:
        logger.warning(f"Music search failed for '{query}': {exc}")
        return jsonify({'status': 'error', 'message': str(exc)[:200], 'query': query, 'results': []}), 502


@app.route('/api/music/feed', methods=['GET', 'POST'])
def music_feed():
    """Trending for a new listener, personalised once the taste summary has weight."""
    profile = {}
    seeds = []
    limit = 18
    if request.method == 'POST':
        body = request.get_json(silent=True) or {}
        if isinstance(body.get('profile'), dict):
            profile = body['profile']
        if isinstance(body.get('seeds'), list):
            seeds = body['seeds'][:3]
        try:
            limit = int(body.get('limit') or limit)
        except (TypeError, ValueError):
            limit = 18
    else:
        limit = request.args.get('limit', 18, type=int) or 18
    try:
        payload = _music_feed_payload(profile, limit, allow_relay=bool(current_user()), seeds=seeds)
        response = jsonify({'status': 'success', **payload})
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as exc:
        logger.warning(f'Music feed failed: {exc}')
        return jsonify({'status': 'error', 'message': 'Feed unavailable', 'results': []}), 502


@app.route('/api/music/radio', methods=['GET', 'POST'])
def music_radio():
    """Similar tracks for the current seed, de-duplicated against what was played."""
    payload = {}
    if request.method == 'POST':
        body = request.get_json(silent=True) or {}
        if isinstance(body, dict):
            payload = body
    else:
        payload = {
            'videoId': request.args.get('videoId') or request.args.get('id') or '',
            'title': request.args.get('title') or '',
            'channel': request.args.get('channel') or '',
            'artist': request.args.get('artist') or '',
            'limit': request.args.get('limit', 12, type=int) or 12,
        }
    try:
        result = _music_radio_payload(payload, allow_relay=bool(current_user()))
        response = jsonify({'status': 'success', **result})
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as exc:
        # Radio is an enhancement: a failure here must never break playback.
        logger.warning(f'Music radio failed: {exc}')
        response = jsonify({'status': 'degraded', 'message': 'Radio unavailable', 'results': []})
        response.headers['Cache-Control'] = 'no-store'
        return response


@app.route('/api/music/discover', methods=['GET'])
def music_discover():
    """Genre-pill radio: Last.fm tags when configured, YT Music and search otherwise."""
    tag = (request.args.get('tag') or '').strip()
    if not tag:
        return jsonify({'status': 'error', 'message': 'No tag provided', 'results': []}), 400
    limit = request.args.get('limit', 15, type=int) or 15
    try:
        payload = _music_discover_payload(tag, limit, allow_relay=bool(current_user()))
        response = jsonify({'status': 'success', **payload})
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as exc:
        logger.warning(f'Music discover failed for {tag!r}: {exc}')
        response = jsonify({'status': 'degraded', 'tag': tag, 'label': tag, 'source': 'none', 'results': []})
        response.headers['Cache-Control'] = 'no-store'
        return response


# ===== YOUTUBE SEARCH ENDPOINT (kept for backwards compatibility) =====
@app.route('/api/youtube/search', methods=['GET'])
def youtube_search():
    """Search YouTube for a query and return the first video URL and title."""
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'error': 'No query provided'}), 400

    try:
        results = _youtube_search_results(query, limit=1)
        if results:
            first = results[0]
            return jsonify({
                'video_id': first['id'],
                'video_url': first['url'],
                'title': first['title'],
                'channel': first.get('channel', ''),
                'query': query,
            })
        return jsonify({'error': 'No results found', 'query': query}), 404
    except Exception as e:
        logger.warning(f"YouTube search error for '{query}': {e}")
        return jsonify({'error': str(e), 'query': query}), 500


@app.errorhandler(404)
def hdsfd_not_found(error):
    """API callers get JSON; browsers still get the default 404 page."""
    if request.path.startswith('/api/'):
        return jsonify({
            'status': 'error',
            'message': 'Unknown API endpoint',
            'path': request.path,
        }), 404
    return error


# Create any missing tables on import too: WSGI servers import this module
# without ever running the __main__ block below.
init_db()

if __name__ == '__main__':

    print("Starting HD SFD V2 Clean Server on http://localhost:5050...")
    app.run(port=5050, debug=False, use_reloader=False)

#!/usr/bin/env python3
"""Ship the runtime to PythonAnywhere and reload the webapp.

Only the files listed in RUNTIME_FILES are uploaded, so the live database,
credentials and config files on PythonAnywhere are never touched.

Token: PA_API_TOKEN in the environment, or a local .pa-token file (gitignored).
"""

import os
import sys
import time

import requests

USER = os.environ.get("PA_USERNAME", "HDSFD")
DOMAIN = os.environ.get("PA_DOMAIN", "HDSFD.pythonanywhere.com")
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE_DIR = f"/home/{USER}/HDSFD"
API = f"https://www.pythonanywhere.com/api/v0/user/{USER}"

RUNTIME_FILES = (
    "app.py",
    "index.html",
    "app.js",
    "hdsfd-ui.js",
    "liquid-glass.js",
    "sw.js",
    "manifest.json",
    "privacy.html",
    "icon-192.png",
    "icon-512.png",
    "requirements.txt",
    "music_relay.json",
    "backend/__init__.py",
    "backend/school_connect.py",
    "vendor/quick-liquid/index.mjs",
    "vendor/quick-liquid/chunk-4TLGP4GF.mjs",
)

# Directories shipped whole: the vendored YT Music client is pure Python, so it
# travels with the app and PythonAnywhere never needs a pip step for it.
RUNTIME_DIRS = (
    "vendor/ytmusicapi",
)


def read_token():
    token = (os.environ.get("PA_API_TOKEN") or "").strip()
    if token:
        return token
    try:
        with open(os.path.join(ROOT_DIR, ".pa-token"), "r", encoding="utf-8") as handle:
            token = handle.read().strip()
    except OSError:
        token = ""
    if not token:
        sys.exit("Set PA_API_TOKEN or create .pa-token with your PythonAnywhere API token.")
    return token


def main():
    headers = {"Authorization": f"Token {read_token()}"}

    files = list(RUNTIME_FILES)
    for rel_dir in RUNTIME_DIRS:
        for root, _dirs, names in os.walk(os.path.join(ROOT_DIR, rel_dir)):
            for name in sorted(names):
                if name.endswith('.pyc') or '__pycache__' in root:
                    continue
                files.append(os.path.relpath(os.path.join(root, name), ROOT_DIR).replace(os.sep, '/'))

    for rel_path in files:
        local_path = os.path.join(ROOT_DIR, rel_path)
        if not os.path.exists(local_path):
            sys.exit(f"Missing local file: {rel_path}")
        with open(local_path, "rb") as handle:
            payload = handle.read()
        response = None
        for attempt in range(8):
            response = requests.post(
                f"{API}/files/path{REMOTE_DIR}/{rel_path}",
                headers=headers,
                files={"content": (os.path.basename(rel_path), payload, "application/octet-stream")},
                timeout=120,
            )
            if response.status_code != 429:
                break
            # PythonAnywhere throttles bursts of file uploads; honour its hint.
            wait = 25
            marker = "available in "
            if marker in response.text:
                try:
                    wait = int(response.text.split(marker, 1)[1].split(" ", 1)[0]) + 2
                except ValueError:
                    pass
            print(f"rate limited on {rel_path}; waiting {wait}s")
            time.sleep(wait)
        if response.status_code not in (200, 201):
            sys.exit(f"Upload failed for {rel_path}: HTTP {response.status_code} {response.text[:200]}")
        print(f"uploaded {rel_path}")
        time.sleep(1.2)

    response = requests.post(f"{API}/webapps/{DOMAIN}/reload/", headers=headers, timeout=120)
    if response.status_code != 200:
        sys.exit(f"Reload failed: HTTP {response.status_code} {response.text[:200]}")
    print("reloaded webapp")

    health = requests.get(f"https://{DOMAIN}/api/health", timeout=30)
    print(f"health: HTTP {health.status_code} {health.text[:120]}")
    if health.status_code != 200:
        sys.exit("Health check failed after reload")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Ship the runtime to PythonAnywhere and reload the webapp.

Only the files listed in RUNTIME_FILES are uploaded, so the live database,
credentials and config files on PythonAnywhere are never touched.

Token: PA_API_TOKEN in the environment, or a local .pa-token file (gitignored).
"""

import os
import sys

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

    for rel_path in RUNTIME_FILES:
        local_path = os.path.join(ROOT_DIR, rel_path)
        if not os.path.exists(local_path):
            sys.exit(f"Missing local file: {rel_path}")
        with open(local_path, "rb") as handle:
            response = requests.post(
                f"{API}/files/path{REMOTE_DIR}/{rel_path}",
                headers=headers,
                files={"content": (os.path.basename(rel_path), handle, "application/octet-stream")},
                timeout=120,
            )
        if response.status_code not in (200, 201):
            sys.exit(f"Upload failed for {rel_path}: HTTP {response.status_code} {response.text[:200]}")
        print(f"uploaded {rel_path}")

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

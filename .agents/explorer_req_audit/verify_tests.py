import os
import sys
import time
import socket
import subprocess
import requests
import unittest

def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def wait_for_backend(port, timeout=10):
    start_time = time.time()
    url = f"http://127.0.0.1:{port}/api/chat/recent"
    while time.time() - start_time < timeout:
        try:
            r = requests.get(url, timeout=1)
            if r.status_code == 200:
                print(f"Backend is up on port {port}")
                return True
        except requests.exceptions.ConnectionError:
            time.sleep(0.1)
    return False

def main():
    project_dir = r"e:\Projects\HD Coding Projects\HDSFD"
    tests_dir = os.path.join(project_dir, 'tests')
    backend_app = os.path.join(project_dir, 'backend', 'app.py')
    db_path = os.path.join(tests_dir, 'test_database.db')

    # Remove stale DB if exists
    for f in [db_path, f"{db_path}-wal", f"{db_path}-shm"]:
        if os.path.exists(f):
            try: os.remove(f)
            except: pass

    port = get_free_port()
    os.environ['HDSFD_TESTING_PORT'] = str(port)
    env = os.environ.copy()
    env['HDSFD_DB_PATH'] = db_path
    env['PORT'] = str(port)
    # Ensure WERKZEUG_RUN_MAIN is NOT set to true without FD, and FLASK_DEBUG is false
    env.pop('WERKZEUG_RUN_MAIN', None)
    env['FLASK_DEBUG'] = 'false'

    print(f"Spawning backend on port {port} using DB {db_path}...")
    log_file = open(os.path.join(tests_dir, 'verifier_backend.log'), 'w', encoding='utf-8')
    proc = subprocess.Popen(
        [sys.executable, backend_app],
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT
    )

    try:
        if not wait_for_backend(port):
            print("Backend failed to start within timeout.")
            log_file.close()
            with open(os.path.join(tests_dir, 'verifier_backend.log'), 'r') as f:
                print("Backend log:\n" + f.read())
            sys.exit(1)

        print("\n--- Running Test Suite ---")
        loader = unittest.TestLoader()
        suite = loader.discover(start_dir=tests_dir, pattern='test_*.py')
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)
        print(f"\nTests run: {result.testsRun}, Errors: {len(result.errors)}, Failures: {len(result.failures)}")
    finally:
        proc.terminate()
        try: proc.wait(timeout=3)
        except: proc.kill()
        log_file.close()

if __name__ == '__main__':
    main()

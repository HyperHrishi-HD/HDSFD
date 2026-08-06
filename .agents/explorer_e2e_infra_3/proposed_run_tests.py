import os
import sys
import time
import socket
import subprocess
import unittest
import shutil

def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def wait_for_server(port, timeout=10):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return True
        except (socket.timeout, ConnectionRefusedError):
            time.sleep(0.5)
    return False

def main():
    # Paths relative to the project root
    # This runner is designed to run from the project root directory
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    tests_dir = os.path.join(project_root, 'tests')
    # During actual run, the directories will be in the project root
    # Here in the explorer, we just target tests_dir as the project-level 'tests' directory
    test_db = os.path.join(tests_dir, 'test_database.db')
    test_log = os.path.join(tests_dir, 'backend_test.log')

    # Ensure tests directory exists
    if not os.path.exists(tests_dir):
        os.makedirs(tests_dir)

    # Remove stale files
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except Exception:
            pass
    for ext in ['-wal', '-shm']:
        if os.path.exists(test_db + ext):
            try:
                os.remove(test_db + ext)
            except Exception:
                pass

    # Get a free port
    port = get_free_port()
    print(f"[E2E Runner] Selected free port: {port}")

    # Set up environment variables
    test_env = os.environ.copy()
    test_env['HDSFD_DB_PATH'] = test_db
    test_env['PORT'] = str(port)
    test_env['TEST_SERVER_URL'] = f"http://127.0.0.1:{port}"
    test_env['GOOGLE_CLIENT_ID'] = '' # Ensure sandbox mode for gcal

    # Start Flask app
    app_path = os.path.join(project_root, 'backend', 'app.py')
    print(f"[E2E Runner] Starting Flask server via subprocess: {app_path}")
    
    with open(test_log, 'w') as log_file:
        process = subprocess.Popen(
            [sys.executable, app_path],
            env=test_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True
        )

    # Wait for the server to be ready
    print("[E2E Runner] Waiting for server to become responsive...")
    if not wait_for_server(port):
        print("[E2E Runner] ERROR: Server failed to start or become responsive in time.")
        # Try reading the last logs to print out error context
        if os.path.exists(test_log):
            with open(test_log, 'r') as lf:
                print("--- Backend logs (startup failure) ---")
                print(lf.read())
                print("--------------------------------------")
        process.kill()
        sys.exit(1)
    
    print("[E2E Runner] Server is up and running. Starting tests...")

    # Discover and run tests
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=tests_dir, pattern='test_*.py')

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Shutdown server
    print("[E2E Runner] Shutting down Flask server...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print("[E2E Runner] Server did not terminate gracefully, killing...")
        process.kill()

    # Clean up test database
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except Exception as e:
            print(f"[E2E Runner] Warning: could not delete test database: {e}")
    for ext in ['-wal', '-shm']:
        if os.path.exists(test_db + ext):
            try:
                os.remove(test_db + ext)
            except Exception:
                pass

    # Clean up backups directory if created during testing
    backups_dir = os.path.join(project_root, 'backend', 'backups')
    if os.path.exists(backups_dir):
        try:
            shutil.rmtree(backups_dir)
        except Exception:
            pass

    if result.wasSuccessful():
        print("[E2E Runner] All tests passed successfully.")
        sys.exit(0)
    else:
        print("[E2E Runner] Some tests failed.")
        sys.exit(1)

if __name__ == '__main__':
    main()

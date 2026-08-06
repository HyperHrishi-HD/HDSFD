import socket
import subprocess
import os
import time
import requests
import sys
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

def cleanup_temp_files(db_path, max_retries=15, delay=0.5):
    files_to_remove = [
        db_path,
        f"{db_path}-wal",
        f"{db_path}-shm"
    ]
    # Also clean up backups directory inside tests/ if created
    backups_dir = os.path.join(os.path.dirname(db_path), 'backups')
    
    # Try removing files
    for file_path in files_to_remove:
        if os.path.exists(file_path):
            for i in range(max_retries):
                try:
                    os.remove(file_path)
                    print(f"Successfully removed {file_path}")
                    break
                except Exception as e:
                    print(f"Attempt {i+1} failed to remove {file_path}: {e}")
                    time.sleep(delay)

    # Try removing backups directory and its files
    if os.path.exists(backups_dir):
        for i in range(max_retries):
            try:
                import shutil
                shutil.rmtree(backups_dir)
                print(f"Successfully removed backups directory {backups_dir}")
                break
            except Exception as e:
                print(f"Attempt {i+1} failed to remove backups directory {backups_dir}: {e}")
                time.sleep(delay)

def main():
    tests_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(tests_dir)
    backend_app = os.path.join(project_dir, 'backend', 'app.py')
    db_path = os.path.join(tests_dir, 'test_database.db')
    log_path = os.path.join(tests_dir, 'backend_test.log')

    # Clean up previous runs if any
    cleanup_temp_files(db_path)

    port = get_free_port()
    os.environ['HDSFD_TESTING_PORT'] = str(port)
    env = os.environ.copy()
    env['HDSFD_DB_PATH'] = db_path
    env['PORT'] = str(port)

    # Open log file
    log_file = open(log_path, 'w', encoding='utf-8')
    
    print(f"Spawning backend on port {port} using DB {db_path}...")
    proc = subprocess.Popen(
        [sys.executable, backend_app],
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT
    )

    success = False
    try:
        if not wait_for_backend(port):
            print("Backend failed to start within timeout.")
            sys.exit(1)

        # Run tests
        print("Discovering and running tests...")
        loader = unittest.TestLoader()
        suite = loader.discover(start_dir=tests_dir, pattern='test_*.py')
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)
        success = result.wasSuccessful()
    finally:
        print("Terminating backend subprocess...")
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("Force killing backend...")
            proc.kill()
            proc.wait()

        log_file.close()

        # Brief delay to allow files to release locks
        time.sleep(1.0)

        print("Cleaning up database files...")
        cleanup_temp_files(db_path)

    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()

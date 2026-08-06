import os
import re
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = r"e:\Projects\HD Coding Projects\HDSFD"

# Targeted file list for code files
TARGET_DIRS = ["backend", "src", "tests"]
ROOT_FILES = ["index.html", "vite.config.js", "package.json"]

patterns = {
    "TODO": re.compile(r"TODO", re.IGNORECASE),
    "code here": re.compile(r"code\s+here", re.IGNORECASE),
    "ellipses (...)": re.compile(r"\.\.\."),
    "test skip": re.compile(r"skipTest|unittest\.skip|pytest\.mark\.skip|pytest\.skip", re.IGNORECASE),
    "hardcoded pass stub": re.compile(r"def test_.*:\s*pass|def test_.*:\s*return True", re.IGNORECASE),
}

files_to_scan = []

for rf in ROOT_FILES:
    full_p = os.path.join(ROOT_DIR, rf)
    if os.path.exists(full_p):
        files_to_scan.append(full_p)

for d in TARGET_DIRS:
    full_d = os.path.join(ROOT_DIR, d)
    if os.path.exists(full_d):
        for root, dirs, files in os.walk(full_d):
            dirs[:] = [d for d in dirs if d not in {"__pycache__", "node_modules"}]
            for f in files:
                if f.endswith(('.py', '.js', '.css', '.html', '.json', '.ts', '.jsx', '.tsx')):
                    files_to_scan.append(os.path.join(root, f))

results = []

for filepath in files_to_scan:
    relpath = os.path.relpath(filepath, ROOT_DIR)
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
            for idx, line in enumerate(lines, 1):
                for name, pat in patterns.items():
                    if pat.search(line):
                        # Filter out UI placeholder strings like placeholder="Type a message..."
                        if name == "ellipses (...)" and ("placeholder=" in line or "..." in line) and not ("//" in line or "/*" in line or "#" in line or "code" in line):
                            # Check if it's UI placeholder or code ellipsis
                            if "placeholder=" in line:
                                continue
                        results.append({
                            "file": relpath,
                            "line": idx,
                            "type": name,
                            "content": line.strip()
                        })
    except Exception as e:
        print(f"Error reading {relpath}: {e}")

print(f"Scanned {len(files_to_scan)} project source/test files.")
print(f"Total pattern matches found: {len(results)}")
for r in results:
    print(f"[{r['type']}] {r['file']}:{r['line']} -> {r['content']}")

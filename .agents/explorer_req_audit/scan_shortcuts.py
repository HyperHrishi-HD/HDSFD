import re
import glob
import os

project_root = r"e:\Projects\HD Coding Projects\HDSFD"
files = [
    os.path.join(project_root, 'backend', 'app.py'),
    os.path.join(project_root, 'src', 'main.js'),
    os.path.join(project_root, 'src', 'style.css'),
    os.path.join(project_root, 'index.html')
] + glob.glob(os.path.join(project_root, 'tests', '*.py'))

patterns = [
    (r'TODO', 'TODO comment/shortcut'),
    (r'code here', '/* code here */ placeholder'),
    (r'\.\.\.', 'Ellipsis (...) shortcut')
]

found = []
for filepath in files:
    if not os.path.exists(filepath):
        continue
    rel_path = os.path.relpath(filepath, project_root)
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        for idx, line in enumerate(f, 1):
            for pat, desc in patterns:
                if re.search(pat, line, re.IGNORECASE):
                    # Filter out natural UI text like 'In the Zone...' or 'Please wait...' if needed,
                    # but log everything for audit.
                    found.append({
                        'file': rel_path,
                        'line': idx,
                        'pattern': pat,
                        'desc': desc,
                        'content': line.strip()
                    })

print(f"Total findings: {len(found)}")
for item in found:
    print(f"{item['file']}:{item['line']} [{item['desc']}] -> {item['content']}")

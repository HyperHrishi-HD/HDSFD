import urllib.request
import json
import sys

BASE = 'http://127.0.0.1:5050/api'

def run_tests():
    print('--- 1. Testing Google Status ---')
    res = urllib.request.urlopen(f'{BASE}/google/status')
    status = json.loads(res.read())
    print('Status:', status)
    assert status.get('connected') == True, "Google should be connected"

    print('\n--- 2. Testing Google Tasklists ---')
    res = urllib.request.urlopen(f'{BASE}/google/tasklists')
    lists = json.loads(res.read())
    print('Tasklists found:', len(lists), [l['title'] for l in lists])
    assert len(lists) > 0, "Should return tasklists"

    print('\n--- 3. Testing Google Tasks Fetch ---')
    res = urllib.request.urlopen(f'{BASE}/google/tasks')
    tasks = json.loads(res.read())
    print('Tasks count:', len(tasks))

    print('\n--- 4. Testing Google Tasks Create ---')
    payload = json.dumps({'title': 'Automated Test Task 2026', 'folder': 'General'}).encode()
    req = urllib.request.Request(f'{BASE}/google/tasks', data=payload, headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req)
    created = json.loads(res.read())
    print('Created task:', created)
    assert created.get('synced') == True, "Task should sync to Google"
    task_id = created['task']['id']
    tl_id = created.get('tasklist_id', '@default')

    print('\n--- 5. Testing Google Tasks Complete ---')
    payload = json.dumps({'completed': True, 'tasklist_id': tl_id}).encode()
    req = urllib.request.Request(f'{BASE}/google/tasks/{task_id}', data=payload, headers={'Content-Type': 'application/json'}, method='PUT')
    res = urllib.request.urlopen(req)
    updated = json.loads(res.read())
    print('Updated task:', updated)

    print('\n--- 6. Testing Google Tasks Delete ---')
    req = urllib.request.Request(f'{BASE}/google/tasks/{task_id}?tasklist_id={tl_id}', method='DELETE')
    res = urllib.request.urlopen(req)
    deleted = json.loads(res.read())
    print('Deleted task:', deleted)

    print('\n--- 7. Testing Google Calendar Fetch ---')
    res = urllib.request.urlopen(f'{BASE}/google/calendar')
    events = json.loads(res.read())
    print('Calendar events count:', len(events))

    print('\n--- 8. Testing Google Drive Backup ---')
    payload = json.dumps({'username': 'hdsystem.ahd@gmail.com', 'notes': [{'title': 'Test Note', 'content': 'Test Content'}]}).encode()
    req = urllib.request.Request(f'{BASE}/gdrive/backup', data=payload, headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req)
    backup = json.loads(res.read())
    print('Drive Backup:', backup)
    assert backup.get('drive_synced') == True, "Database & notes should stream to Google Drive"

    print('\n==================================================')
    print('[SUCCESS] ALL 8 BACKEND & GOOGLE SYNC TESTS PASSED (100%)!')
    print('==================================================')

if __name__ == '__main__':
    run_tests()

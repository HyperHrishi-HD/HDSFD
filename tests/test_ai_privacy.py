import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as hdsfd  # noqa: E402


client = hdsfd.app.test_client()
hdsfd.current_user = lambda: None
# Force the offline engine so this test never calls Gemini.
hdsfd.get_ordered_key_candidates = lambda key: []
os.environ.pop('GEMINI_API_KEY', None)


def ask(prompt, context_enabled):
    response = client.post('/api/gemini/generate', json={
        'prompt': prompt,
        'username': 'Guest',
        'context': {'tasks': [{'title': 'Secret Task'}]} if context_enabled else None,
        'include_context': context_enabled,
        'allow_actions': context_enabled,
        'include_notes': context_enabled,
    })
    assert response.status_code == 200, response.status_code
    return response.get_json()


# Context off: no actions, no command claims, plain answer only.
private = ask('Add task to review chemistry notes', False)
assert private['status'] == 'success', private
assert private['actions'] == [], private
assert 'Task Created' not in private['text'], private['text']
assert 'sticky note' not in private['text'].lower(), private['text']
assert 'Workspace actions are off' in private['text'], private['text']

# Context on: the same command still works exactly as before.
shared = ask('Add task to review chemistry notes', True)
assert shared['status'] == 'success', shared
assert shared['actions'], shared
assert shared['actions'][0]['type'] == 'create_task', shared['actions']

# Turning the switch off must also stop an ordinary workspace question from
# being answered with private data.
private_question = ask('What are my tasks?', False)
assert private_question['actions'] == [], private_question
assert 'Secret Task' not in private_question['text'], private_question['text']

print('AI privacy: context-off blocks actions and data, context-on keeps commands working.')

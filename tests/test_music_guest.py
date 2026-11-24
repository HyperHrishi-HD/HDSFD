import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as hdsfd  # noqa: E402


def track(vid, title='Guest Track', channel='YouTube'):
    return {
        'id': vid,
        'title': title,
        'channel': channel,
        'duration': '3:00',
        'seconds': 180,
        'views': '1K views',
        'thumbnail': 'https://i.ytimg.com/vi/%s/mqdefault.jpg' % vid,
        'url': 'https://www.youtube.com/watch?v=%s' % vid,
    }


client = hdsfd.app.test_client()
hdsfd.MUSIC_RELAY_BASE = 'https://relay.invalid'

# --- guest: config hides the relay entirely --------------------------------
hdsfd.current_user = lambda: None
guest_config = client.get('/api/music/config').get_json()
assert guest_config['guest'] is True, guest_config
assert guest_config['relay'] is False, guest_config
assert guest_config['relay_base'] is None, guest_config
assert guest_config['engine'] == 'youtube-embed', guest_config
assert guest_config['quality'] == 'tiny', guest_config

# --- guest search: metadata may use the server-side relay index -------------
# The relay origin never leaves the server, and guest audio still uses the
# official YouTube embed, so this does not grant guest ad-free playback.
relay_calls = []
hdsfd._music_relay_search = lambda query, limit=14: (relay_calls.append(query) or [])
hdsfd._youtube_search_results = lambda query, limit=14: [track('guest000001')]

guest_search = client.get('/api/music/search?q=guest%20relay%20guard%209281')
assert guest_search.status_code == 200, guest_search.status_code
assert len(guest_search.get_json()['results']) == 1, guest_search.get_json()
assert relay_calls == ['guest relay guard 9281'], relay_calls

# --- guest feed/radio helpers are told not to use the relay ----------------
parallel_flags = []
hdsfd._music_parallel_search = lambda queries, per_query=10, allow_relay=True: (parallel_flags.append(bool(allow_relay)) or [])
hdsfd._music_feed_payload({}, 6, allow_relay=False)
assert parallel_flags and parallel_flags[0] is False, parallel_flags

parallel_flags.clear()
seed = track('seed0000001')
hdsfd._music_radio_payload({'videoId': seed['id'], 'title': seed['title'], 'channel': seed['channel']}, 4, allow_relay=False)
assert parallel_flags and parallel_flags[0] is False, parallel_flags

# --- signed in: config reveals it and search uses it -----------------------
hdsfd.current_user = lambda: 'tester'
signed_config = client.get('/api/music/config').get_json()
assert signed_config['guest'] is False, signed_config
assert signed_config['relay'] is True, signed_config
assert signed_config['relay_base'] == 'https://relay.invalid', signed_config
assert signed_config['quality'] == 'best', signed_config

relay_calls.clear()
hdsfd._music_relay_search = lambda query, limit=14: (relay_calls.append(query) or [track('signed00001')])
signed_search = client.get('/api/music/search?q=signed%20relay%20guard%209281')
assert signed_search.status_code == 200, signed_search.status_code
assert len(signed_search.get_json()['results']) == 1, signed_search.get_json()
assert relay_calls == ['signed relay guard 9281'], relay_calls

print('MUSIC_GUEST_OK', {
    'guest_config': guest_config['engine'],
    'guest_relay_calls': 0,
    'signed_engine': signed_config['engine'],
})

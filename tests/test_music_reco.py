import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as hdsfd  # noqa: E402


def track(vid, title, channel, views='1M views', duration='3:00'):
    return {
        'id': vid,
        'title': title,
        'channel': channel,
        'duration': duration,
        'seconds': 180,
        'views': views,
        'thumbnail': 'https://i.ytimg.com/vi/%s/mqdefault.jpg' % vid,
        'url': 'https://www.youtube.com/watch?v=%s' % vid,
    }


FAKE = {
    'top hits this week': [
        track('aaaaaaaaaaa', 'Big Hit', 'Star', '9M views'),
        track('bbbbbbbbbbb', 'Small Hit', 'Nobody', '12K views'),
    ],
    'trending songs': [
        track('ccccccccccc', 'Trending Track', 'Star', '5M views'),
        track('aaaaaaaaaaa', 'Big Hit (Official Video)', 'Star', '9M views'),
    ],
    'Alpha songs': [
        track('ddddddddddd', 'Alpha One', 'Alpha', '2M views'),
        track('eeeeeeeeeee', 'Alpha Two', 'Alpha', '300K views'),
    ],
    'Beta songs': [
        track('fffffffffff', 'Beta One', 'Beta', '1.5M views'),
        track('ggggggggggg', 'Beta Two', 'Beta', '80K views'),
    ],
    'lofi mix': [track('hhhhhhhhhhh', 'Lofi Loop', 'Chill', '4M views')],
    'new music this week': [track('iiiiiiiiiii', 'Fresh Drop', 'New', '700K views')],
    'Alpha radio': [
        track('ddddddddddd', 'Alpha One', 'Alpha', '2M views'),
        track('jjjjjjjjjjj', 'Alpha Deep Cut', 'Alpha', '90K views'),
    ],
    'Alpha songs radio': [
        track('kkkkkkkkkkk', 'Similar Vibe', 'Other', '1M views'),
        track('lllllllllll', 'Alpha Cover', 'Cover Band', '10K views'),
    ],
    'Alpha track': [track('mmmmmmmmmmm', 'Alpha Track Live', 'Other', '2M views')],
}


def fake_search(query, limit=14):
    return [dict(item) for item in FAKE.get(query, [])][:limit]


hdsfd._music_search = fake_search
hdsfd._MUSIC_TRENDING_ROTATION = [['top hits this week', 'trending songs']]
hdsfd._MUSIC_FEED_CACHE.clear()
hdsfd._MUSIC_RADIO_CACHE.clear()

# --- feed: no taste means trending -----------------------------------------
trending = hdsfd._music_feed_payload({}, 8)
assert trending['mode'] == 'trending', trending['mode']
assert trending['title'] == 'Trending now'
ids = [item['id'] for item in trending['results']]
assert 'aaaaaaaaaaa' in ids
# The duplicate upload of Big Hit must be collapsed.
assert len(ids) == len(set(ids))
assert sum(1 for item in trending['results'] if item['title'].startswith('Big Hit')) == 1

# --- feed: taste means personalised ----------------------------------------
profile = {'artists': ['Alpha', 'Beta'], 'terms': ['lofi'], 'plays': 6}
personal = hdsfd._music_feed_payload(profile, 8)
assert personal['mode'] == 'personalized', personal['mode']
assert personal['title'] == 'Made for you'
personal_ids = [item['id'] for item in personal['results']]
assert 'ddddddddddd' in personal_ids and 'fffffffffff' in personal_ids
assert 'aaaaaaaaaaa' not in personal_ids

# A disliked track never reaches the feed.
blocked = hdsfd._music_feed_payload(
    {'artists': ['Alpha', 'Beta'], 'disliked': ['ddddddddddd'], 'plays': 6}, 8
)
assert 'ddddddddddd' not in [item['id'] for item in blocked['results']]

# --- radio: excludes the seed and played ids, prefers the same channel -----
radio = hdsfd._music_radio_payload({
    'videoId': 'ddddddddddd',
    'title': 'Alpha One',
    'channel': 'Alpha',
    'exclude': ['ddddddddddd', 'eeeeeeeeeee'],
    'limit': 6,
    'artists': ['Alpha'],
})
assert radio['mode'] == 'radio'
radio_ids = [item['id'] for item in radio['results']]
assert 'ddddddddddd' not in radio_ids
assert 'eeeeeeeeeee' not in radio_ids
assert radio_ids, 'radio should return at least one new track'
assert radio['results'][0]['channel'] == 'Alpha', radio['results'][0]

# --- dedupe is stable for near-duplicate titles ----------------------------
deduped = hdsfd._music_dedupe([
    track('nnnnnnnnnnn', 'Song Name (Official Video)', 'Artist'),
    track('ooooooooooo', 'Song Name', 'Artist'),
    track('nnnnnnnnnnn', 'Song Name', 'Artist'),
])
assert len(deduped) == 1, deduped

# --- HTTP wiring -----------------------------------------------------------
client = hdsfd.app.test_client()

res = client.get('/api/music/search?q=Alpha%20songs')
assert res.status_code == 200, res.status_code
assert len(res.get_json()['results']) == 2

res = client.post('/api/music/feed', json={'profile': profile, 'limit': 8})
assert res.status_code == 200, res.status_code
assert res.get_json()['mode'] == 'personalized'

res = client.post('/api/music/radio', json={
    'videoId': 'ddddddddddd', 'title': 'Alpha One', 'channel': 'Alpha',
    'exclude': ['ddddddddddd'], 'artists': ['Alpha'], 'limit': 6,
})
assert res.status_code == 200, res.status_code
assert 'ddddddddddd' not in [item['id'] for item in res.get_json()['results']]

res = client.get('/api/music/search')
assert res.status_code == 400

print('MUSIC_RECO_OK', {'trending': len(trending['results']), 'personal': len(personal['results']), 'radio': len(radio['results'])})

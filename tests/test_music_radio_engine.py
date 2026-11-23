"""Cover the hybrid Last.fm + YouTube Music radio engine and its fallbacks."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as hdsfd  # noqa: E402


def track(vid, title, channel, views='1M views'):
    return {
        'id': vid,
        'title': title,
        'channel': channel,
        'duration': '3:00',
        'seconds': 180,
        'views': views,
        'thumbnail': 'https://i.ytimg.com/vi/%s/mqdefault.jpg' % vid,
        'url': 'https://www.youtube.com/watch?v=%s' % vid,
    }


SEED = 'seedseedsee'
LASTFM_TRACK = track('lastfmlastf', 'Last.fm Pick', 'Similar Artist')
WATCH_TRACK = track('watchwatchw', 'Watch Pick', 'Radio Artist')
SEARCH_TRACK = track('searchsearc', 'Search Pick', 'Backfill Artist')
SEED_TRACK = track(SEED, 'Seed Song', 'Seed Artist')


def reset():
    hdsfd._MUSIC_RADIO_CACHE.clear()
    hdsfd._MUSIC_FEED_CACHE.clear()
    hdsfd._MUSIC_YTM_CACHE.clear()
    hdsfd._MUSIC_LASTFM_CACHE.clear()


def fake_search(queries, per_query=10, allow_relay=True):
    return [dict(SEED_TRACK), dict(SEARCH_TRACK)]


# --- radio without a Last.fm key: watch playlist plus search backfill --------
hdsfd.LASTFM_API_KEY = ''
reset()
hdsfd._music_parallel_search = fake_search
hdsfd._ytmusic_watch_playlist = lambda video_id, limit=20: [dict(WATCH_TRACK), dict(SEED_TRACK)]
hdsfd._lastfm_radio = lambda artist, title, limit=8: (_ for _ in ()).throw(AssertionError('no key should not call Last.fm'))

radio = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED], 'limit': 10,
})
ids = [item['id'] for item in radio['results']]
assert radio['source'] == 'ytmusic+search', radio['source']
assert ids == ['watchwatchw', 'searchsearc'], ids
assert SEED not in ids

# --- radio with a key: Last.fm leads, watch playlist and search supplement ---
hdsfd.LASTFM_API_KEY = 'test-key'
reset()
hdsfd._lastfm_radio = lambda artist, title, limit=8: [dict(LASTFM_TRACK)]
radio = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'artist': 'Seed Artist',
    'exclude': [SEED], 'limit': 10,
})
ids = [item['id'] for item in radio['results']]
assert radio['source'] == 'lastfm+ytmusic+search', radio['source']
assert ids[0] == 'lastfmlastf', ids
assert SEED not in ids

# A different exclusion list must never leak an excluded track back in.
excluded = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED, 'lastfmlastf', 'watchwatchw'], 'limit': 10,
})
assert [item['id'] for item in excluded['results']] == ['searchsearc']

# --- discover without a key: YouTube Music first, search backfill -----------
hdsfd.LASTFM_API_KEY = ''
reset()
hdsfd._music_search = lambda query, limit=14, allow_relay=True: [dict(SEARCH_TRACK)]
hdsfd._ytmusic_search_songs = lambda query, limit=15: [dict(WATCH_TRACK)]
hdsfd._lastfm_tag_top_tracks = lambda tag, limit=15: (_ for _ in ()).throw(AssertionError('no key should not call Last.fm'))

discover = hdsfd._music_discover_payload('Lo-fi', 15)
assert discover['label'] == 'Lo-fi'
assert discover['source'] == 'ytmusic+search', discover['source']
assert [item['id'] for item in discover['results']] == ['watchwatchw', 'searchsearc']

# --- discover with a key: Last.fm tag graph leads ---------------------------
hdsfd.LASTFM_API_KEY = 'test-key'
reset()
hdsfd._lastfm_tag_top_tracks = lambda tag, limit=15: [{'artist': 'Similar Artist', 'title': 'Last.fm Pick'}]
hdsfd._music_resolve_lastfm_tracks = lambda rows, limit=8: [dict(LASTFM_TRACK)]
discover = hdsfd._music_discover_payload('Lo-fi', 15)
assert 'lastfm' in discover['source'], discover['source']
assert discover['results'][0]['id'] == 'watchwatchw', discover['results']
assert 'lastfmlastf' in [item['id'] for item in discover['results']]

# --- My Mix: seeds drive the feed even without a taste profile --------------
reset()
hdsfd.LASTFM_API_KEY = ''
hdsfd._ytmusic_watch_playlist = lambda video_id, limit=20: [dict(WATCH_TRACK)]
hdsfd._music_parallel_search = fake_search
mix = hdsfd._music_feed_payload({'artists': [], 'terms': [], 'plays': 0}, 10,
                                seeds=[{'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist'}])
assert mix['mode'] == 'personalized'
assert mix['title'] == 'My Mix'
assert mix['results'][0]['id'] == 'watchwatchw'
assert SEED in [item['id'] for item in mix['results']], 'the seed itself may appear in its own mix'

# --- HTTP wiring and graceful degradation ----------------------------------
client = hdsfd.app.test_client()

hdsfd._music_discover_payload = lambda tag, limit=15, allow_relay=True: {
    'tag': tag, 'label': 'Lo-fi', 'source': 'test', 'results': [dict(WATCH_TRACK)]
}
res = client.get('/api/music/discover?tag=Lo-fi')
assert res.status_code == 200, res.status_code
body = res.get_json()
assert body['status'] == 'success' and len(body['results']) == 1
assert res.headers.get('Cache-Control') == 'no-store'

res = client.get('/api/music/discover')
assert res.status_code == 400, res.status_code

# A broken provider must not 500 the endpoint or stop playback.
hdsfd._music_discover_payload = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('provider down'))
res = client.get('/api/music/discover?tag=Jazz')
assert res.status_code == 200, res.status_code
assert res.get_json()['results'] == []
assert res.get_json()['status'] == 'degraded'

hdsfd._music_radio_payload = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('radio down'))
res = client.get('/api/music/radio?videoId=%s&title=Seed%%20Song' % SEED)
assert res.status_code == 200, res.status_code
assert res.get_json()['results'] == []

# The existing search endpoint still answers (no regression from this change).
hdsfd._music_search = lambda query, limit=14, allow_relay=True: [dict(SEARCH_TRACK)]
res = client.get('/api/music/search?q=seed')
assert res.status_code == 200, res.status_code
assert res.get_json()['results'][0]['id'] == 'searchsearc'

print('MUSIC_RADIO_ENGINE_OK', {
    'radio': len(radio['results']),
    'watch': len(discover['results']),
    'mix': len(mix['results']),
})

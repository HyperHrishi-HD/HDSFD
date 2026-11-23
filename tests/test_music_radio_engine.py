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
ORIGINAL_RESOLVE_LASTFM = hdsfd._music_resolve_lastfm_tracks


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
hdsfd._lastfm_radio = lambda artist, title, limit=8, **kwargs: (_ for _ in ()).throw(AssertionError('no key should not call Last.fm'))

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
hdsfd._lastfm_radio = lambda artist, title, limit=8, **kwargs: [dict(LASTFM_TRACK)]
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
hdsfd._music_resolve_lastfm_tracks = lambda rows, limit=8, **kwargs: [dict(LASTFM_TRACK)]
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

# --- picker: the official track beats tutorials and covers ------------------
OFFICIAL = track('official001', 'No Surprises', 'Radiohead')
TUTORIAL = track('tutorial001', 'No Surprises Guitar Tutorial', 'Marin Music Center')
COVER = track('cover000001', 'No Surprises (Cover)', 'Some Cover')
assert hdsfd._music_pick_match('Radiohead', 'No Surprises', [TUTORIAL, COVER, OFFICIAL])['id'] == 'official001'
assert hdsfd._music_match_score('Radiohead', 'No Surprises', OFFICIAL) > hdsfd._music_match_score('Radiohead', 'No Surprises', TUTORIAL)
assert hdsfd._music_match_score('Radiohead', 'No Surprises', OFFICIAL) > hdsfd._music_match_score('Radiohead', 'No Surprises', COVER)

# --- relay fallback: a blocked YT Music host still resolves Last.fm names ---
hdsfd._music_resolve_lastfm_tracks = ORIGINAL_RESOLVE_LASTFM
saved_safe = hdsfd._music_safe_search
saved_resolve = hdsfd._ytmusic_search_track
saved_relay = hdsfd.MUSIC_RELAY_BASE
fallback_calls = []


def fake_resolve_search(query, limit=10, allow_relay=True):
    fallback_calls.append({'query': query, 'limit': limit, 'relay': allow_relay})
    return [dict(TUTORIAL), dict(OFFICIAL)]


hdsfd._ytmusic_search_track = lambda artist, title: None
hdsfd._music_safe_search = fake_resolve_search
hdsfd.MUSIC_RELAY_BASE = 'https://relay.example'
resolved = hdsfd._music_resolve_lastfm_tracks(
    [{'artist': 'Radiohead', 'title': 'No Surprises'}], limit=1, allow_relay=False
)
assert [item['id'] for item in resolved] == ['official001'], resolved
assert fallback_calls[0]['limit'] == 5, fallback_calls
assert fallback_calls[0]['relay'] is True, 'a configured relay is safe for server-side metadata'

fallback_calls.clear()
hdsfd.MUSIC_RELAY_BASE = ''
hdsfd._music_resolve_lastfm_tracks([{'artist': 'Radiohead', 'title': 'No Surprises'}], limit=1, allow_relay=False)
assert fallback_calls[0]['relay'] is False, 'without a relay the fallback stays search-only'

fallback_calls.clear()
hdsfd._ytmusic_search_track = lambda artist, title: dict(OFFICIAL)
resolved = hdsfd._music_resolve_lastfm_tracks(
    [{'artist': 'Radiohead', 'title': 'No Surprises'}], limit=1, allow_relay=True
)
assert [item['id'] for item in resolved] == ['official001']
assert fallback_calls == [], 'a working YT Music match should skip the fallback'

hdsfd._music_safe_search = saved_safe
hdsfd._ytmusic_search_track = saved_resolve
hdsfd.MUSIC_RELAY_BASE = saved_relay

# --- discover: noisy tags lead with search, trusted tags with Last.fm -------
BALLAD = track('ballad00001', 'LALALALA', 'Stray Kids')
PHONK = track('phonk000001', 'MONTAGEM PHONK', 'Brazilian Phonk')
hdsfd.LASTFM_API_KEY = 'test-key'
reset()
hdsfd._ytmusic_search_songs = lambda query, limit=15: []
hdsfd._lastfm_tag_top_tracks = lambda tag, limit=15: [{'artist': 'Stray Kids', 'title': 'LALALALA'}]
hdsfd._music_resolve_lastfm_tracks = lambda rows, limit=8, **kwargs: [dict(BALLAD)]
hdsfd._music_search = lambda query, limit=14, allow_relay=True: [dict(PHONK)]

phonk = hdsfd._music_discover_payload('Phonk', 8)
assert phonk['results'][0]['id'] == 'phonk000001', phonk['results']
assert phonk['source'] == 'search+lastfm', phonk['source']

jazz = hdsfd._music_discover_payload('Jazz', 8)
assert jazz['results'][0]['id'] == 'ballad00001', jazz['results']
assert jazz['source'] == 'lastfm+search', jazz['source']

# --- HTTP wiring and graceful degradation ----------------------------------
client = hdsfd.app.test_client()

# --- guest Home: a real search-only feed, never a seeded station ------------
hdsfd.LASTFM_API_KEY = ''
reset()
guest_calls = []


def guest_search(queries, per_query=10, allow_relay=True):
    guest_calls.append({'queries': list(queries), 'relay': allow_relay})
    return [dict(SEARCH_TRACK)]


hdsfd._music_parallel_search = guest_search
hdsfd._ytmusic_watch_playlist = lambda *args, **kwargs: (_ for _ in ()).throw(
    AssertionError('guest feed must not seed a station')
)

res = client.post('/api/music/feed', json={
    'profile': {},
    'seeds': [{'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist'}],
    'limit': 6,
})
assert res.status_code == 200, res.status_code
body = res.get_json()
assert body['status'] == 'success', body
assert body['results'], body
assert body['title'] in ('Study & focus', 'Trending now'), body
assert 'Search-only' in (body.get('subtitle') or ''), body
assert guest_calls and guest_calls[0]['relay'] is False, guest_calls
assert body['mode'] != 'personalized', body

# A guest with real taste gets a personalised search-only feed.
guest_calls.clear()
res = client.post('/api/music/feed', json={
    'profile': {'artists': ['Alpha', 'Beta'], 'terms': ['lofi'], 'plays': 6},
    'limit': 6,
})
body = res.get_json()
assert res.status_code == 200, res.status_code
assert body['mode'] == 'personalized', body
assert guest_calls and guest_calls[-1]['relay'] is False, guest_calls

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

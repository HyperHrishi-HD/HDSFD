"""Cover the keyless YouTube Music radio, discovery and trending engine."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as hdsfd  # noqa: E402

ORIGINAL_DISCOVER_TRACKS = hdsfd._ytmusic_discover_tracks


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
WATCH_TRACK = track('watchwatchw', 'Watch Pick', 'Radio Artist')
ARTIST_TRACK = track('artistmix01', 'Artist Mix Pick', 'Mix Artist')
SEARCH_TRACK = track('searchsearc', 'Search Pick', 'Backfill Artist')
CHART_TRACK = track('chartchart1', 'Chart Pick', 'Chart Artist')
YTM_TRACK = track('ytmusic0001', 'Trending Search', 'Trending Artist')
MOOD_TRACK = track('moodmood001', 'Mood Pick', 'Chill Artist')
SEED_TRACK = track(SEED, 'Seed Song', 'Seed Artist')
JUNK_TRACK = {
    'id': 'junkjunkjun',
    'title': 'Search filters',
    'channel': 'YouTube',
    'duration': '',
    'seconds': 0,
    'views': '',
}

def reset():
    hdsfd._MUSIC_RADIO_CACHE.clear()
    hdsfd._MUSIC_FEED_CACHE.clear()
    hdsfd._MUSIC_YTM_CACHE.clear()
    hdsfd._MUSIC_YTM_STATE['blocked_until'] = 0


# Search-page furniture and unlabelled scrape rows are not tracks.
assert hdsfd._music_normalize(JUNK_TRACK) is None
assert hdsfd._music_normalize(track('realtrack01', 'Search filters', 'Real Artist')) is None
assert hdsfd._music_normalize(dict(SEARCH_TRACK))['id'] == 'searchsearc'
assert not hasattr(hdsfd, '_ytmusic_search_track')

# A stale cached junk row must trigger a fresh search, not enter the queue.
reset()
with hdsfd._MUSIC_LOCK:
    hdsfd._MUSIC_RESULT_CACHE.clear()
    hdsfd._MUSIC_RESULT_CACHE[('rick astley radio', 10, True)] = {
        'results': [dict(JUNK_TRACK)], 'expires': hdsfd._time.time() + 60,
    }
refetch = []
hdsfd._music_relay_search = lambda query, limit=14: (
    refetch.append(query) or [dict(SEARCH_TRACK)]
)
cached_search = hdsfd._music_search('Rick Astley radio', 10)
assert refetch == ['Rick Astley radio'], refetch
assert [item['id'] for item in cached_search] == ['searchsearc']


# --- radio: the watch playlist leads, artist mix and search supplement -----
reset()
watch_calls = []
artist_calls = []
hdsfd._ytmusic_watch_playlist = lambda video_id, limit=20: (
    watch_calls.append(video_id) or [dict(WATCH_TRACK), dict(SEED_TRACK), dict(JUNK_TRACK)]
)
hdsfd._ytmusic_artist_mix = lambda artist, limit=8: (
    artist_calls.append(artist) or [dict(ARTIST_TRACK)]
)
hdsfd._music_parallel_search = lambda queries, per_query=10, allow_relay=True: [dict(SEARCH_TRACK)]

radio = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED], 'limit': 10,
})
ids = [item['id'] for item in radio['results']]
assert radio['source'] == 'ytmusic+artist+search', radio['source']
assert ids[0] == 'watchwatchw', ids
assert SEED not in ids
assert 'junkjunkjun' not in ids
assert watch_calls == [SEED], watch_calls
assert artist_calls == ['Seed Artist'], artist_calls

# A different exclusion list must never leak an excluded track back in.
excluded = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED, 'watchwatchw', 'artistmix01'], 'limit': 10,
})
assert [item['id'] for item in excluded['results']] == ['searchsearc']

# When YouTube Music cannot be reached, radio degrades to the search ranking.
reset()
hdsfd._ytmusic_watch_playlist = lambda video_id, limit=20: []
hdsfd._ytmusic_artist_mix = lambda artist, limit=8: []
fallback = hdsfd._music_radio_payload({
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED], 'limit': 8,
})
assert fallback['source'] == 'search', fallback['source']
assert [item['id'] for item in fallback['results']] == ['searchsearc']

# --- discovery: YouTube Music search/mood leads, search backfills ----------
reset()
discover_calls = []
hdsfd._ytmusic_discover_tracks = lambda tag, query, limit=15: (
    discover_calls.append((tag, query)) or [dict(WATCH_TRACK)]
)
hdsfd._music_search = lambda query, limit=14, allow_relay=True: [dict(SEARCH_TRACK)]

discover = hdsfd._music_discover_payload('Lo-fi', 8)
assert discover['label'] == 'Lo-fi'
assert discover['source'] == 'ytmusic+search', discover['source']
assert [item['id'] for item in discover['results']] == ['watchwatchw', 'searchsearc']
assert discover_calls[0][0] == 'lofi', discover_calls

# All eight pills are wired to the keyless dispatcher.
for label in ('Lo-fi', 'Study', 'Hip hop', 'Classical', 'Jazz', 'K-pop', 'Phonk', 'Nature'):
    result = hdsfd._music_discover_payload(label, 6)
    assert result['results'], label
    assert result['source'] == 'ytmusic+search', (label, result['source'])

# With no YouTube Music result the search ranking still fills the pill.
reset()
hdsfd._ytmusic_discover_tracks = lambda tag, query, limit=15: []
phonk = hdsfd._music_discover_payload('Phonk', 8)
assert phonk['source'] == 'search', phonk['source']
assert phonk['results'][0]['id'] == 'searchsearc'

# Mood playlists are matched by their title and normalized into playable tracks.
reset()
hdsfd._ytmusic_discover_tracks = ORIGINAL_DISCOVER_TRACKS
hdsfd._ytmusic_mood_playlists = lambda: [{'id': 'MP-chill', 'title': 'Chill & Focus'}]
hdsfd._ytmusic_playlist_tracks = lambda playlist_id, limit=20: [dict(MOOD_TRACK)]
mood = hdsfd._ytmusic_mood_tracks('Lo-fi', 6)
assert [item['id'] for item in mood] == ['moodmood001']
hdsfd._ytmusic_search_songs = lambda query, limit=15: []
assert [item['id'] for item in hdsfd._ytmusic_discover_tracks('lofi', 'lofi study beats', 6)] == ['moodmood001']

# --- trending: charts lead, YT Music search and cached search backfill -----
reset()
hdsfd._ytmusic_charts = lambda country='US', limit=15: [dict(CHART_TRACK)]
hdsfd._ytmusic_search_songs = lambda query, limit=15: [dict(YTM_TRACK)]
hdsfd._music_parallel_search = lambda queries, per_query=10, allow_relay=True: [dict(SEARCH_TRACK)]
trending = hdsfd._music_trending_payload(8, allow_relay=False)
assert trending['title'] == 'Trending now'
assert trending['source'] == 'ytmusic-charts+ytmusic-search+search', trending['source']
assert [item['id'] for item in trending['results']] == [
    'chartchart1', 'ytmusic0001', 'searchsearc'
]
for item in trending['results']:
    assert item['videoId'] == item['id']
    assert item['artist'] == item['channel']

# A failed charts call must not empty or hang the Trending row.
reset()
hdsfd._ytmusic_charts = lambda country='US', limit=15: []
trending_fallback = hdsfd._music_trending_payload(8, allow_relay=False)
assert trending_fallback['source'] == 'ytmusic-search+search', trending_fallback['source']
assert trending_fallback['results'][0]['id'] == 'ytmusic0001'

# --- My Mix: saved/played seeds use the watch playlist plus artist mix -----
reset()
hdsfd._ytmusic_watch_playlist = lambda video_id, limit=20: [dict(WATCH_TRACK)]
hdsfd._ytmusic_artist_mix = lambda artist, limit=8: [dict(ARTIST_TRACK)]
mix = hdsfd._music_feed_payload(
    {'artists': [], 'terms': [], 'plays': 0}, 10,
    seeds=[{'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist'}],
)
assert mix['mode'] == 'personalized'
assert mix['title'] == 'My Mix'
assert mix['results'][0]['id'] == 'watchwatchw', mix['results']
assert 'artistmix01' in [item['id'] for item in mix['results']]

# Trending feed is chart-backed when charts are reachable.
reset()
hdsfd._MUSIC_TRENDING_ROTATION = [['top hits this week']]
hdsfd._ytmusic_charts = lambda country='US', limit=15: [dict(CHART_TRACK)]
hdsfd._ytmusic_search_songs = lambda query, limit=15: []
trending_feed = hdsfd._music_feed_payload({}, 8, allow_relay=True)
assert trending_feed['title'] == 'Trending now'
assert trending_feed['results'][0]['id'] == 'chartchart1', trending_feed['results']

# --- HTTP wiring, error handling and zero retired-provider references ------
client = hdsfd.app.test_client()

res = client.get('/api/music/trending?limit=6')
assert res.status_code == 200, res.status_code
assert res.get_json()['status'] == 'success'
assert res.get_json()['results'][0]['id'] == 'chartchart1', res.get_json()['results']
assert res.headers.get('Cache-Control') == 'no-store'

res = client.get('/api/music/discover?tag=Phonk&limit=6')
assert res.status_code == 200, res.status_code
assert res.get_json()['results']
assert res.headers.get('Cache-Control') == 'no-store'

res = client.get('/api/music/discover')
assert res.status_code == 400, res.status_code

res = client.post('/api/music/radio', json={
    'videoId': SEED, 'title': 'Seed Song', 'channel': 'Seed Artist',
    'exclude': [SEED], 'limit': 6,
})
assert res.status_code == 200, res.status_code
assert SEED not in [item['id'] for item in res.get_json()['results']]

# A broken provider degrades cleanly instead of returning a 500.
hdsfd._music_trending_payload = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('charts down'))
res = client.get('/api/music/trending')
assert res.status_code == 200, res.status_code
assert res.get_json()['status'] == 'degraded'
assert res.get_json()['results'] == []

hdsfd._music_discover_payload = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('discover down'))
res = client.get('/api/music/discover?tag=Jazz')
assert res.status_code == 200, res.status_code
assert res.get_json()['status'] == 'degraded'

hdsfd._music_radio_payload = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('radio down'))
res = client.get('/api/music/radio?videoId=%s&title=Seed%%20Song' % SEED)
assert res.status_code == 200, res.status_code
assert res.get_json()['status'] == 'degraded'
assert res.get_json()['results'] == []

# The existing search endpoint still answers unchanged.
hdsfd._music_search = lambda query, limit=14, allow_relay=True: [dict(SEARCH_TRACK)]
res = client.get('/api/music/search?q=seed')
assert res.status_code == 200, res.status_code
assert res.get_json()['results'][0]['id'] == 'searchsearc'
res = client.get('/api/music/search')
assert res.status_code == 400, res.status_code

# Config advertises the keyless engine, not any retired provider.
res = client.get('/api/music/config')
assert res.status_code == 200, res.status_code
config = res.get_json()
assert config['radio']['keyless'] is True, config['radio']
retired = 'last' + 'fm'
assert retired not in config['radio'], config['radio']

# Regression guard: no retired keyed provider may creep back into the app.
assert not hasattr(hdsfd, retired.upper() + '_API_KEY')
assert not [name for name in dir(hdsfd) if retired in name.lower()]
with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app.py'), encoding='utf-8') as handle:
    app_source = handle.read().lower()
assert retired not in app_source
assert ''.join(['audio', 'scrobbler']) not in app_source

print('MUSIC_RADIO_ENGINE_OK', {
    'radio': len(radio['results']),
    'discover': len(discover['results']),
    'trending': len(trending['results']),
    'mix': len(mix['results']),
})

import assert from 'node:assert/strict';

const page = `<!doctype html><html><body><script>
var ytInitialData = {"contents":{"twoColumnSearchResultsRenderer":{"primaryContents":{"sectionListRenderer":{"contents":[{"itemSectionRenderer":{"contents":[
{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Rick Astley - Never Gonna Give You Up"}]},"ownerText":{"runs":[{"text":"Rick Astley"}]},"lengthText":{"simpleText":"3:33"},"viewCountText":{"simpleText":"1.6B views"},"thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg"}]}}},
{"videoRenderer":{"videoId":"abcDEF12345","title":{"runs":[{"text":"Live from nowhere"}]},"ownerText":{"runs":[{"text":"Some Channel"}]},"badges":[{"metadataBadgeRenderer":{"label":"LIVE"}}]}},
{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Duplicate"}]},"ownerText":{"runs":[{"text":"Dup"}]}}}
]}}]}}}}};
</script></body></html>`;

function hashString(value) {
  let hash = 5381;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

let searchCalls = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.startsWith('https://www.youtube.com/results')) {
    searchCalls += 1;
    return new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  throw new Error('unexpected fetch: ' + target);
};

const store = new Map();
const kv = {
  async get(key) { return store.has(key) ? store.get(key) : null; },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
};
const pending = [];
const ctx = { waitUntil(promise) { pending.push(Promise.resolve(promise)); } };

// Pre-seed the shared cache the way another isolate would have left it.
const seeded = [{
  id: 'zzzzzzzzzzz',
  title: 'Seeded Track',
  channel: 'Seeded',
  duration: '2:00',
  seconds: 120,
  views: '1M views',
  live: false,
  thumbnail: 'https://i.ytimg.com/vi/zzzzzzzzzzz/mqdefault.jpg',
  url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz',
}];
store.set('search:v1:' + hashString('cached query:14'), JSON.stringify({
  results: seeded,
  expires: Date.now() + 15 * 60 * 1000,
}));

const worker = (await import('../relay/worker.js')).default;
const call = (path, init) => worker.fetch(new Request('https://relay.example' + path, init), { RELAY_CACHE: kv }, ctx);

// 1. A seeded KV entry answers without touching YouTube.
let response = await call('/api/search?q=cached%20query');
let body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.cached, 'kv');
assert.equal(body.results[0].id, 'zzzzzzzzzzz');
assert.equal(searchCalls, 0);

// 2. The isolate remembers it after the first read.
response = await call('/api/search?q=cached%20query');
body = await response.json();
assert.equal(body.cached, 'isolate');
assert.equal(searchCalls, 0);

// 3. A live search parses ytInitialData, drops live entries and duplicates.
response = await call('/api/search?q=never%20gonna');
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.status, 'success');
assert.equal(body.results.length, 1);
assert.equal(body.results[0].id, 'dQw4w9WgXcQ');
assert.equal(body.results[0].title, 'Rick Astley - Never Gonna Give You Up');
assert.equal(body.results[0].channel, 'Rick Astley');
assert.equal(body.results[0].seconds, 213);
assert.equal(body.results[0].views, '1.6B views');
assert.equal(searchCalls, 1);
await Promise.all(pending);
assert.equal(store.size, 2, 'live result should be written back to KV');

// 4. POST body and a lower limit both work.
response = await call('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'another query', limit: 5 }),
});
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.query, 'another query');
assert.equal(searchCalls, 2);

// 5. Missing query is a 400, not a YouTube call.
response = await call('/api/search');
assert.equal(response.status, 400);
assert.equal(searchCalls, 2);

// 6. Wrong method is a 405.
response = await call('/api/search?q=x', { method: 'PUT' });
assert.equal(response.status, 405);

// 7. A YouTube failure is reported as a JSON 502 with an empty list.
globalThis.fetch = async () => new Response('nope', { status: 503 });
response = await call('/api/search?q=broken');
body = await response.json();
assert.equal(response.status, 502);
assert.equal(body.status, 'error');
assert.deepEqual(body.results, []);

// 8. Health still advertises the new route.
globalThis.fetch = async () => { throw new Error('health must not fetch'); };
response = await call('/api/health');
body = await response.json();
assert.equal(body.status, 'ok');
assert.ok(body.routes.some(route => route.includes('/api/search')));

console.log('MUSIC_RELAY_SEARCH_OK', JSON.stringify({ searchCalls, kvKeys: store.size }));

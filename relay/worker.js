/**
 * HDSFD Music Relay — one Cloudflare Worker with two jobs.
 *
 *   POST /api/player   { "videoId": "dQw4w9WgXcQ" }
 *     Innertube /youtubei/v1/player relay: audio-only formats (title, length,
 *     direct googlevideo URLs) with CORS enabled.
 *   GET|HEAD /api/stream?url=<googlevideo url>&id=<videoId>
 *     Range-aware audio proxy: forwards Range and returns 206 / Content-Range so
 *     seeking works. googlevideo URLs are bound to the IP that minted them, so the
 *     bytes have to leave from this Worker.
 *   GET|POST /api/search?q=<query>&limit=14
 *     YouTube video search (title, channel, duration, views) from the Worker's own
 *     egress. Hosts that cannot reach youtube.com use this for search, trending and
 *     radio; results are cached in KV for 15 minutes.
 *   GET /api/health
 *
 * The browser talks to this Worker directly, so playback never depends on the app
 * host's network. CORS is wide open on purpose: responses carry no cookies or user
 * data, and the stream route only forwards to *.googlevideo.com.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, X-Requested-With',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, X-HDSFD-Cache, X-HDSFD-Engine',
  'Access-Control-Max-Age': '86400',
};

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?key=' + INNERTUBE_KEY + '&prettyPrint=false';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_STREAM_URL = 4096;
const RESOLVE_ROUNDS = 3;
const SEARCH_URL = 'https://www.youtube.com/results';
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_TTL_SECONDS = 15 * 60;
const SEARCH_MEMORY_MAX = 80;
const SEARCH_CACHE = new Map();

const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

// Innertube clients, most reliable first.
//
// VISIONOS is the important one: it still returns plain audio URLs with no PO
// token, but only when the request carries a visitor identity that YouTube issued
// over the same UA. Without it every video answers "Sign in to confirm you're not
// a bot". ANDROID_VR stays as the backup for the videos VISIONOS refuses (it does
// not serve "made for kids" videos).
const CLIENTS = [
  {
    name: 'VISIONOS',
    version: '1.02',
    headerId: '101',
    userAgent: SAFARI_UA,
    needsVisitor: true,
    extra: {
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
    },
  },
  {
    name: 'ANDROID_VR',
    version: '1.60.19',
    headerId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extra: {
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12L',
      androidSdkVersion: 32,
    },
  },
  {
    // The embedded TV player is a separate quota; useful when mobile is refused.
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    version: '2.0',
    headerId: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    extra: {
      clientScreen: 'EMBED',
      thirdParty: { embedUrl: 'https://www.youtube.com/' },
    },
  },
];

// A single hung upstream call used to stall a resolve for 15s, well past the
// browser's 9s abort. Every player/visitor call gets its own budget instead.
function timeoutSignal(ms) {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  } catch (e) {
    return undefined;
  }
}

// ---- Visitor identity ------------------------------------------------------
// The embed page hands out a visitorData value; reusing it across videos keeps
// player calls treated as one normal viewer instead of an anonymous bot.
const VISITOR_TTL = 30 * 60 * 1000;
let visitorState = { value: '', expires: 0 };

async function fetchVisitorData(videoId, trace) {
  const target = 'https://www.youtube.com/embed/' + (VIDEO_ID.test(videoId) ? videoId : 'jNQXAC9IVRw');
  const response = await fetch(target, {
    headers: { 'User-Agent': SAFARI_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: timeoutSignal(4000),
  });
  if (response.ok === false) {
    if (trace) trace.push({ step: 'visitor_page', status: response.status });
    throw new Error('visitor_page_http_' + response.status);
  }
  const html = await response.text();
  const match = html.match(/"visitorData":"([^"]+)"/);
  if (trace) trace.push({ step: 'visitor_page', status: response.status, bytes: html.length, found: !!match });
  if (!match) throw new Error('visitor_data_missing');
  return match[1];
}

async function getVisitorData(videoId, force, trace, env, ctx, prefetched) {
  if (!force && visitorState.value && visitorState.expires > Date.now()) return visitorState.value;

  // One identity for the whole deployment: the embed fetch is paid once per 30
  // minutes, not once per resolve and not once per isolate. `prefetched` is the
  // read resolvePlayer already started, so a cold resolve pays one round trip.
  const kv = sharedCache(env);
  if (!force && kv) {
    const readAt = Date.now();
    const shared = prefetched ? await prefetched : await readSharedWithBudget(kv, SHARED_VISITOR_KEY);
    if (shared && typeof shared.value === 'string' && shared.value && Number(shared.expires) > Date.now()) {
      visitorState = { value: shared.value, expires: Number(shared.expires) };
      if (trace) trace.push({ step: 'visitor_kv', ms: Date.now() - readAt, hit: true });
      return shared.value;
    }
    if (trace) trace.push({ step: 'visitor_kv', ms: Date.now() - readAt, hit: false });
  }

  const fetchAt = Date.now();
  try {
    const value = await fetchVisitorData(videoId, trace);
    const expires = Date.now() + VISITOR_TTL;
    visitorState = { value: value, expires: expires };
    writeSharedJson(kv, SHARED_VISITOR_KEY, { value: value, expires: expires }, VISITOR_TTL / 1000, ctx);
    if (trace) trace.push({ step: 'visitor_fetch', ms: Date.now() - fetchAt });
    return value;
  } catch (error) {
    if (trace) trace.push({ step: 'visitor_fetch', ms: Date.now() - fetchAt, error: String((error && error.message) || error).slice(0, 80) });
    if (visitorState.value && visitorState.expires > Date.now()) return visitorState.value;
    return visitorState.value || '';
  }
}

// First-line cache, per isolate: zero latency, and the googlevideo IP binding
// still matches the egress that resolved it. The Cache API would share entries
// between isolates, but it is a no-op on *.workers.dev (functional cache
// operations need a custom domain), so the shared copy lives in Workers KV.
const PLAYER_CACHE = new Map();
const PLAYER_CACHE_TTL = 2 * 60 * 60 * 1000;
const PLAYER_CACHE_MAX = 500;

// A resolved URL is only reusable until it expires, so the entry lifetime is the
// shorter of the cache policy and the stream's own expires_in_seconds.
function playerCacheTtl(expiresInSeconds) {
  const seconds = Number(expiresInSeconds) || 0;
  if (seconds <= 0) return PLAYER_CACHE_TTL;
  return Math.min(PLAYER_CACHE_TTL, Math.max(60, seconds - 60) * 1000);
}

function rememberLocally(videoId, value, ttl) {
  if (PLAYER_CACHE.size >= PLAYER_CACHE_MAX) {
    const oldest = PLAYER_CACHE.keys().next();
    if (!oldest.done) PLAYER_CACHE.delete(oldest.value);
  }
  PLAYER_CACHE.set(videoId, { value: value, expires: Date.now() + ttl });
}

// ---- Shared cache (Workers KV, binding RELAY_CACHE) ------------------------
// Player entries are keyed by the colo that resolved them: a googlevideo URL is
// bound to the egress IP that minted it, so another colo reusing the entry would
// only get a 403. Each colo keeps its own copy instead, which still removes the
// embed fetch and the Innertube call from every resolve after the first.
// Without the binding every helper below is a no-op and nothing else changes.
const SHARED_VISITOR_KEY = 'visitor:v1';

function sharedCache(env) {
  const kv = env && env.RELAY_CACHE;
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
}

function sharedPlayerKey(videoId, colo) {
  return 'player:v1:' + colo + ':' + videoId;
}

// The colo that answered this request. Cloudflare sets it on every edge request;
// local runs (wrangler dev, the node harness) share one bucket.
function coloOf(request) {
  const cf = request && request.cf;
  return cf && typeof cf.colo === 'string' && cf.colo ? cf.colo : 'local';
}

async function readSharedJson(kv, key) {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

// A slow KV read must never hold up a resolve: past the budget it counts as a
// miss and the relay does the work itself instead of waiting.
const SHARED_READ_BUDGET = 300;

function readSharedWithBudget(kv, key) {
  return Promise.race([
    readSharedJson(kv, key),
    new Promise(resolve => setTimeout(() => resolve(null), SHARED_READ_BUDGET)),
  ]);
}

// Writes stay off the response path: a repeat seconds later still finds them, and
// a slow or failing KV write can never delay or break a resolve.
function writeSharedJson(kv, key, value, ttlSeconds, ctx) {
  if (!kv) return;
  const write = kv.put(key, JSON.stringify(value), {
    expirationTtl: Math.max(60, Math.floor(ttlSeconds)),
  }).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(write);
}

function forgetSharedJson(kv, key, ctx) {
  if (!kv) return;
  const removal = kv.delete(key).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(removal);
}

function corsHeaders(extra) {
  return Object.assign({}, CORS, extra || {});
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: corsHeaders(Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, extra || {})),
  });
}

function preflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ---- Search ----------------------------------------------------------------
// The app server used to scrape youtube.com itself. On hosts whose egress is
// blocked (PythonAnywhere) that meant an external reader proxy and 10–45 s waits,
// which also made radio and the home feed unusable. This Worker can reach YouTube,
// so search runs here and the server keeps its old path only as a fallback.

function hashString(value) {
  let hash = 5381;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function extractInitialData(html) {
  for (const marker of ['ytInitialData = {', 'ytInitialData ={']) {
    let start = html.indexOf(marker);
    if (start < 0) continue;
    start = html.indexOf('{', start);
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let pos = start; pos < html.length; pos += 1) {
      const char = html[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, pos + 1));
          } catch (e) {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function durationSeconds(label) {
  const parts = String(label || '').split(':').filter(part => /^\d+$/.test(part.trim()));
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function readVideoRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object') return null;
  const id = renderer.videoId;
  if (!VIDEO_ID.test(String(id || ''))) return null;
  const runs = value => ((value && value.runs) || []).map(run => run.text || '').join('').trim();
  const duration = (renderer.lengthText || {}).simpleText || '';
  const badges = Array.isArray(renderer.badges) ? renderer.badges : [];
  const live = badges.some(badge => /live/i.test(String(((badge || {}).metadataBadgeRenderer || {}).label || '')));
  const thumbs = ((renderer.thumbnail || {}).thumbnails || []);
  const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
  return {
    id: id,
    title: runs(renderer.title) || 'Untitled',
    channel: runs(renderer.ownerText) || runs(renderer.longBylineText),
    duration: duration,
    seconds: durationSeconds(duration),
    views: (renderer.viewCountText || {}).simpleText || runs(renderer.viewCountText),
    live: live,
    thumbnail: thumb,
    url: 'https://www.youtube.com/watch?v=' + id,
  };
}

function collectSearchVideos(data, limit) {
  const results = [];
  const seen = new Set();
  if (!data) return results;
  // Breadth-first: the result renderers live near the top of ytInitialData, while
  // depth-first sinks into menus and continuation blobs until its budget runs out
  // (that used to cap searches at four or five videos).
  const queue = [data];
  let head = 0;
  let visited = 0;
  while (head < queue.length && results.length < limit && visited < 60000) {
    const node = queue[head];
    head += 1;
    visited += 1;
    if (Array.isArray(node)) {
      for (const value of node) if (value && typeof value === 'object') queue.push(value);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const renderer = node.videoRenderer || node.compactVideoRenderer;
    if (renderer) {
      const video = readVideoRenderer(renderer);
      if (video && !video.live && !seen.has(video.id)) {
        seen.add(video.id);
        results.push(video);
      }
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return results;
}

async function searchYouTube(query, limit) {
  const target = SEARCH_URL + '?' + new URLSearchParams({ search_query: query, sp: 'EgIQAQ%3D%3D' }).toString();
  const response = await fetch(target, {
    headers: {
      'User-Agent': SAFARI_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: timeoutSignal(6500),
  });
  if (!response.ok) throw new Error('search_http_' + response.status);
  const html = await response.text();
  if (html.indexOf('videoId') < 0) throw new Error('search_no_video_data');
  const videos = collectSearchVideos(extractInitialData(html), limit);
  if (!videos.length) throw new Error('search_empty');
  return videos;
}

async function handleSearch(request, env, ctx) {
  const url = new URL(request.url);
  let query = url.searchParams.get('q') || '';
  let limit = parseInt(url.searchParams.get('limit') || '14', 10);
  if (request.method === 'POST') {
    try {
      const payload = await request.json();
      if (payload && payload.q) query = String(payload.q);
      if (payload && payload.limit) limit = parseInt(payload.limit, 10);
    } catch (e) { /* query parameters still work */ }
  }
  query = query.trim().slice(0, 120);
  if (!query) return json({ status: 'error', message: 'A search query is required' }, 400);
  if (!Number.isFinite(limit) || limit < 1) limit = 14;
  limit = Math.min(24, Math.max(1, limit));

  const normalized = query.toLowerCase();
  const memoryKey = normalized + ':' + limit;
  const memory = SEARCH_CACHE.get(memoryKey);
  if (memory && memory.expires > Date.now()) {
    return json({ status: 'success', query: query, cached: 'isolate', results: memory.results });
  }

  const kv = sharedCache(env);
  const kvKey = 'search:v1:' + hashString(memoryKey);
  if (kv) {
    const shared = await readSharedWithBudget(kv, kvKey);
    if (shared && Array.isArray(shared.results) && Number(shared.expires) > Date.now()) {
      rememberSearch(memoryKey, shared.results);
      return json({ status: 'success', query: query, cached: 'kv', results: shared.results });
    }
  }

  try {
    const results = await searchYouTube(query, limit);
    rememberSearch(memoryKey, results);
    writeSharedJson(kv, kvKey, { results: results, expires: Date.now() + SEARCH_TTL_SECONDS * 1000 }, SEARCH_TTL_SECONDS, ctx);
    return json({ status: 'success', query: query, results: results });
  } catch (error) {
    return json({
      status: 'error',
      query: query,
      message: 'Search is unavailable right now',
      detail: String((error && error.message) || error).slice(0, 120),
      results: [],
    }, 502);
  }
}

function rememberSearch(key, results) {
  if (SEARCH_CACHE.size >= SEARCH_MEMORY_MAX) {
    const oldest = SEARCH_CACHE.keys().next();
    if (!oldest.done) SEARCH_CACHE.delete(oldest.value);
  }
  SEARCH_CACHE.set(key, { results: results, expires: Date.now() + SEARCH_TTL_MS });
}

function minifyAudio(formats) {
  const audio = [];
  for (const format of formats || []) {
    if (!format || typeof format.mimeType !== 'string') continue;
    if (!format.mimeType.startsWith('audio/')) continue;
    if (!format.url) continue;
    audio.push({
      url: format.url,
      mime: format.mimeType,
      itag: format.itag,
      bitrate: Number(format.bitrate) || 0,
      content_length: Number(format.contentLength) || 0,
      expires_in_seconds: Number(format.expiresInSeconds) || 0,
    });
  }
  // MP4/AAC ahead of Opus-in-WebM, then highest bitrate: AAC decodes on Safari
  // and iOS, where WebM audio is not available.
  audio.sort((a, b) => {
    const aMp4 = /^audio\/mp4/i.test(a.mime) ? 1 : 0;
    const bMp4 = /^audio\/mp4/i.test(b.mime) ? 1 : 0;
    return (bMp4 - aMp4) || (b.bitrate - a.bitrate);
  });
  return audio;
}

async function callInnertube(videoId, client, visitor) {
  const contextClient = Object.assign({
    clientName: client.name,
    clientVersion: client.version,
    hl: 'en',
    gl: 'US',
    userAgent: client.userAgent,
  }, client.extra);
  if (visitor) contextClient.visitorData = visitor;

  const body = {
    context: { client: contextClient },
    videoId: videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  // Only the headers Innertube expects. Anything browser-like that we forward
  // (Origin/Referer/Cookie/X-Forwarded-For) only helps YouTube fingerprint the
  // request as a proxy, so the set stays minimal and the UA does the claiming.
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('X-YouTube-Client-Name', client.headerId);
  headers.set('X-YouTube-Client-Version', client.version);
  headers.set('Accept', '*/*');
  headers.set('Accept-Language', 'en-US,en;q=0.9');
  if (visitor) headers.set('X-Goog-Visitor-Id', visitor);
  try {
    headers.set('User-Agent', client.userAgent);
  } catch (e) { /* immutable header on some runtimes; the UA context still applies */ }

  const response = await fetch(PLAYER_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: timeoutSignal(4500),
  });
  if (!response.ok) {
    throw new Error('innertube_http_' + response.status);
  }
  return response.json();
}

async function resolvePlayer(videoId, trace, env, ctx, colo, bypassCaches) {
  const kv = sharedCache(env);
  let visitorRead = null;

  if (!bypassCaches) {
    const cached = PLAYER_CACHE.get(videoId);
    if (cached && cached.expires > Date.now()) return { result: cached.value, source: 'isolate' };

    if (kv) {
      // Both keys at once: the player entry answers warm resolves, the visitor is
      // only needed when it misses, and starting both now keeps a cold resolve at
      // a single KV round trip instead of two.
      const readAt = Date.now();
      visitorRead = readSharedWithBudget(kv, SHARED_VISITOR_KEY);
      const shared = await readSharedWithBudget(kv, sharedPlayerKey(videoId, colo));
      if (shared && shared.value && Number(shared.expires) > Date.now()) {
        rememberLocally(videoId, shared.value, Number(shared.expires) - Date.now());
        if (trace) trace.push({ step: 'player_kv', ms: Date.now() - readAt, hit: true });
        return { result: shared.value, source: 'kv' };
      }
      if (trace) trace.push({ step: 'player_kv', ms: Date.now() - readAt, hit: false });
    }
  }

  const startedAt = Date.now();
  let lastReason = 'no_audio_format';

  // A refusal is per request, not per video: re-asking with a fresh visitor
  // identity usually lands on an egress YouTube is happy with. Pass 1 walks every
  // client; later passes re-try the two that answer fastest.
  for (let round = 0; round < RESOLVE_ROUNDS; round += 1) {
    if (round > 0) {
      visitorState = { value: '', expires: 0 };
      await new Promise(resolve => setTimeout(resolve, 300 + Math.floor(Math.random() * 500)));
    }
    // A content-level refusal ("this live stream recording is not available") is
    // not something another request fixes, so stop instead of re-asking, and stay
    // inside the browser's patience.
    if (round > 0 && /UNPLAYABLE|is not available/i.test(lastReason)) break;
    if (round > 0 && Date.now() - startedAt > 3500) break;
    const clients = round === 0 ? CLIENTS : CLIENTS.slice(0, 2);

    for (const client of clients) {
      let value = null;

      // YouTube answers LOGIN_REQUIRED per request from shared datacenter ranges, and
      // whether it does depends on the egress address behind the request. Re-asking
      // with a freshly issued visitor identity usually lands on a good one.
      const attempts = client.needsVisitor ? 2 : 1;
      for (let pass = 0; pass < attempts && !value; pass += 1) {
        let data;
        try {
          const visitor = client.needsVisitor ? await getVisitorData(videoId, pass > 0, trace, env, ctx, visitorRead) : '';
          data = await callInnertube(videoId, client, visitor);
        } catch (error) {
          lastReason = String((error && error.message) || error).slice(0, 120);
          if (trace) trace.push({ client: client.name, pass: pass, error: lastReason });
          break;
        }

        const status = (data.playabilityStatus || {}).status;
        const streaming = data.streamingData || {};
        const audio = minifyAudio((streaming.adaptiveFormats || []).concat(streaming.formats || []));
        if (trace) trace.push({ client: client.name, pass: pass, status: status, audio: audio.length });

        if (!audio.length) {
          lastReason = status && status !== 'OK'
            ? String((data.playabilityStatus || {}).reason || status).slice(0, 160)
            : 'no_playable_audio';
          if (status === 'LOGIN_REQUIRED' && client.needsVisitor && pass + 1 < attempts) continue;
          break;
        }

        const details = data.videoDetails || {};
        value = {
          status: 'success',
          video_id: videoId,
          engine: 'innertube-' + client.name.toLowerCase(),
          title: details.title || '',
          author: details.author || '',
          length_seconds: Number(details.lengthSeconds) || 0,
          is_live: details.isLiveContent === true,
          audio: audio,
          expires_in_seconds: Number(streaming.expiresInSeconds) || audio[0].expires_in_seconds || 0,
        };
      }

      if (!value) continue;

      const ttl = playerCacheTtl(value.expires_in_seconds);
      rememberLocally(videoId, value, ttl);
      writeSharedJson(kv, sharedPlayerKey(videoId, colo), { value: value, expires: Date.now() + ttl }, ttl / 1000, ctx);
      return { result: value, source: 'miss' };
    }
  }

  const error = new Error(lastReason);
  error.reason = lastReason;
  throw error;
}

function isGooglevideo(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch (e) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
}

/** Drop the ip= hint so a URL resolved by another colo can still be fetched. */
function withoutIpHint(target) {
  try {
    const parsed = new URL(target);
    if (!parsed.searchParams.has('ip')) return null;
    parsed.searchParams.delete('ip');
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

async function streamAudio(request, env, ctx) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const videoId = url.searchParams.get('id') || '';
  const colo = coloOf(request);

  if (!target) {
    return json({ status: 'error', message: 'Missing url parameter' }, 400);
  }
  if (target.length > MAX_STREAM_URL) {
    return json({ status: 'error', message: 'url parameter too long' }, 414);
  }
  if (!isGooglevideo(target)) {
    return json({ status: 'error', message: 'Only googlevideo.com URLs can be streamed' }, 403);
  }

  const range = request.headers.get('Range');
  const baseHeaders = { Accept: '*/*' };
  if (range) baseHeaders.Range = range;

  const attempt = async targetUrl => fetch(targetUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: baseHeaders,
    redirect: 'follow',
  });

  let upstream = null;
  let upstreamError = null;
  try {
    upstream = await attempt(target);
  } catch (error) {
    upstreamError = error;
  }

  // 403/410 usually means the URL was minted for a different egress IP or has
  // expired. Retry once without the ip hint, then once with a freshly resolved URL.
  if (!upstream || upstream.status === 403 || upstream.status === 410) {
    if (upstream) upstream.body && upstream.body.cancel().catch(() => {});
    const stripped = withoutIpHint(target);
    if (stripped) {
      try {
        const retry = await attempt(stripped);
        if (retry.status !== 403 && retry.status !== 410) {
          upstream = retry;
        } else {
          retry.body && retry.body.cancel().catch(() => {});
        }
      } catch (e) { /* keep the original failure */ }
    }
  }

  if (upstream && (upstream.status === 403 || upstream.status === 410) && VIDEO_ID.test(videoId)) {
    upstream.body && upstream.body.cancel().catch(() => {});
    try {
      PLAYER_CACHE.delete(videoId);
      forgetSharedJson(sharedCache(env), sharedPlayerKey(videoId, colo), ctx);
      const fresh = await resolvePlayer(videoId, null, env, ctx, colo, true);
      const freshAudio = fresh && fresh.result && Array.isArray(fresh.result.audio) ? fresh.result.audio : [];
      if (freshAudio.length) {
        const retry = await attempt(freshAudio[0].url);
        if (retry.status < 400) upstream = retry;
        else retry.body && retry.body.cancel().catch(() => {});
      }
    } catch (e) { /* fall through to the error response */ }
  }

  if (!upstream) {
    return json({
      status: 'error',
      message: 'Upstream fetch failed',
      detail: String((upstreamError && upstreamError.message) || upstreamError || '').slice(0, 160),
    }, 502);
  }

  if (upstream.status >= 400) {
    upstream.body && upstream.body.cancel().catch(() => {});
    return json({
      status: 'error',
      message: 'Upstream responded ' + upstream.status,
      hint: 'The audio URL expired or is bound to another network. Re-resolve via /api/player.',
    }, 502);
  }

  const headers = new Headers(corsHeaders());
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-HDSFD-Engine', 'googlevideo-relay');

  const body = request.method === 'HEAD' ? null : upstream.body;
  if (request.method === 'HEAD' && upstream.body) upstream.body.cancel().catch(() => {});
  return new Response(body, { status: upstream.status, headers: headers });
}

async function handlePlayer(request, env, ctx) {
  let payload = null;
  if (request.method === 'POST') {
    try {
      payload = await request.json();
    } catch (e) {
      return json({ status: 'error', message: 'Body must be JSON' }, 400);
    }
  }

  const url = new URL(request.url);
  const videoId = String(
    (payload && (payload.videoId || payload.video_id)) || url.searchParams.get('videoId') || ''
  ).trim();

  if (!VIDEO_ID.test(videoId)) {
    return json({ status: 'error', message: 'A valid 11-character videoId is required' }, 400);
  }

  const debug = url.searchParams.get('debug') === '1';
  const trace = debug ? [] : null;

  try {
    const resolved = await resolvePlayer(videoId, trace, env, ctx, coloOf(request), false);
    // The cached value is shared with the other callers, so the debug trace is
    // attached to a copy rather than to the cached object itself.
    const body = trace ? Object.assign({}, resolved.result, { trace: trace }) : resolved.result;
    return json(body, 200, { 'X-HDSFD-Cache': resolved.source });
  } catch (error) {
    return json({
      status: 'unavailable',
      video_id: videoId,
      message: 'No playable audio stream',
      detail: String((error && (error.reason || error.message)) || error).slice(0, 160),
      trace: trace || undefined,
    }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return preflight();

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/player') {
      if (request.method !== 'POST' && request.method !== 'GET') {
        return json({ status: 'error', message: 'Use POST or GET' }, 405);
      }
      return handlePlayer(request, env, ctx);
    }

    if (path === '/api/stream') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ status: 'error', message: 'Use GET or HEAD' }, 405);
      }
      return streamAudio(request, env, ctx);
    }

    if (path === '/api/search') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ status: 'error', message: 'Use GET or POST' }, 405);
      }
      return handleSearch(request, env, ctx);
    }

    if (path === '/api/health' || path === '/') {
      return json({
        status: 'ok',
        service: 'hdsfd-music-relay',
        version: '1.0.0',
        routes: ['POST /api/player', 'GET /api/stream?url=&id=', 'GET|POST /api/search?q=', 'GET /api/health'],
        clients: CLIENTS.map(client => client.name),
      });
    }

    return json({ status: 'error', message: 'Unknown endpoint', path: path }, 404);
  },
};

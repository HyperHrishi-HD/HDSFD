/**
 * HDSFD Music Relay — a single Cloudflare Worker with two jobs.
 *
 *   POST /api/player            { "videoId": "dQw4w9WgXcQ" }
 *     -> Innertube /youtubei/v1/player relay. Returns the audio-only formats
 *        (title, length, direct googlevideo URLs) with CORS enabled.
 *
 *   GET|HEAD /api/stream?url=<googlevideo url>&id=<videoId>
 *     -> Range-aware audio proxy. Forwards Range to googlevideo and passes back
 *        206 / Content-Range / Accept-Ranges, so seeking works in the browser.
 *        googlevideo URLs are locked to the IP that asked for them, so the bytes
 *        must leave from this Worker instead of from the visitor or the app host.
 *
 *   GET /api/health
 *
 * Why this exists: hosts such as PythonAnywhere's free tier cannot reach
 * youtube.com/googlevideo.com, and even where they can, proxying audio through a
 * Python worker is slow and short-lived. The browser talks to this Worker
 * directly, so playback never depends on the app server's network.
 *
 * CORS is wide open on purpose: the app origin is configurable per deployment and
 * the responses carry no cookies or user data. The stream route only forwards to
 * *.googlevideo.com, so it cannot be used as a general-purpose open proxy.
 *
 * Deploy: `wrangler deploy` (see wrangler.toml) or any Workers-compatible upload.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, X-Requested-With',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type, X-HDSFD-Engine',
  'Access-Control-Max-Age': '86400',
};

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?key=' + INNERTUBE_KEY + '&prettyPrint=false';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_STREAM_URL = 4096;
const RESOLVE_ROUNDS = 3;

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

async function getVisitorData(videoId, force, trace) {
  if (!force && visitorState.value && visitorState.expires > Date.now()) return visitorState.value;
  try {
    const value = await fetchVisitorData(videoId, trace);
    visitorState = { value: value, expires: Date.now() + VISITOR_TTL };
    return value;
  } catch (error) {
    if (visitorState.value && visitorState.expires > Date.now()) return visitorState.value;
    return visitorState.value || '';
  }
}

// Per-isolate cache: the same URL is only reused by the same Worker instance, so
// the googlevideo IP binding still matches the egress that resolved it.
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

// Resolved entries are also published to the Cache API so a repeat play that
// lands on a fresh isolate still skips YouTube. They are keyed by colo because a
// googlevideo URL is minted for the egress address that asked for it; isolates
// behind other colos must resolve their own.
const CACHE_ORIGIN = 'https://hdsfd-player-cache.invalid';

function cacheRequest(videoId, colo) {
  return new Request(CACHE_ORIGIN + '/player/' + (colo || 'xx') + '/' + videoId);
}

function rememberLocally(videoId, value, ttl) {
  if (PLAYER_CACHE.size >= PLAYER_CACHE_MAX) {
    const oldest = PLAYER_CACHE.keys().next();
    if (!oldest.done) PLAYER_CACHE.delete(oldest.value);
  }
  PLAYER_CACHE.set(videoId, { value: value, expires: Date.now() + ttl });
}

async function readCachedPlayer(videoId, colo) {
  const local = PLAYER_CACHE.get(videoId);
  if (local && local.expires > Date.now()) return local.value;
  try {
    const hit = await caches.default.match(cacheRequest(videoId, colo));
    if (!hit) return null;
    const value = await hit.json();
    if (!value || !Array.isArray(value.audio) || !value.audio.length) return null;
    rememberLocally(videoId, value, playerCacheTtl(value.expires_in_seconds));
    return value;
  } catch (e) {
    return null;
  }
}

async function writeCachedPlayer(videoId, colo, value) {
  const ttl = playerCacheTtl(value.expires_in_seconds);
  rememberLocally(videoId, value, ttl);
  try {
    await caches.default.put(cacheRequest(videoId, colo), new Response(JSON.stringify(value), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=' + Math.max(60, Math.floor(ttl / 1000)),
      },
    }));
  } catch (e) { /* the cache is an optimisation, never a requirement */ }
}

async function dropCachedPlayer(videoId, colo) {
  PLAYER_CACHE.delete(videoId);
  try { await caches.default.delete(cacheRequest(videoId, colo)); } catch (e) { /* ignore */ }
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

async function resolvePlayer(videoId, trace, colo) {
  const cached = await readCachedPlayer(videoId, colo);
  if (cached) return cached;

  const startedAt = Date.now();
  let lastReason = 'no_audio_format';

  // A refusal is per request, not per video: re-asking with a fresh visitor
  // identity usually lands on an egress YouTube is happy with. Pass 1 walks every
  // client; pass 2 only re-tries the two that answer fastest.
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
        const visitor = client.needsVisitor ? await getVisitorData(videoId, pass > 0, trace) : '';
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

    await writeCachedPlayer(videoId, colo, value);
    return value;
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

async function streamAudio(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';
  const videoId = url.searchParams.get('id') || '';

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
      const colo = (request.cf && request.cf.colo) || 'xx';
      await dropCachedPlayer(videoId, colo);
      const fresh = await resolvePlayer(videoId, null, colo);
      if (fresh.audio && fresh.audio.length) {
        const retry = await attempt(fresh.audio[0].url);
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

async function handlePlayer(request) {
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
    const result = await resolvePlayer(videoId, trace, (request.cf && request.cf.colo) || 'xx');
    if (trace) result.trace = trace;
    return json(result);
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
  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight();

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/player') {
      if (request.method !== 'POST' && request.method !== 'GET') {
        return json({ status: 'error', message: 'Use POST or GET' }, 405);
      }
      return handlePlayer(request);
    }

    if (path === '/api/stream') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ status: 'error', message: 'Use GET or HEAD' }, 405);
      }
      return streamAudio(request);
    }

    if (path === '/api/health' || path === '/') {
      return json({
        status: 'ok',
        service: 'hdsfd-music-relay',
        version: '1.0.0',
        routes: ['POST /api/player', 'GET /api/stream?url=&id=', 'GET /api/health'],
        clients: CLIENTS.map(client => client.name),
      });
    }

    return json({ status: 'error', message: 'Unknown endpoint', path: path }, 404);
  },
};

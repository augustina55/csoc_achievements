// Vercel serverless function — FIDE rating history for one player.
// GET /api/fide-history?fide_id=XXXX[&debug=1]
// → { ok:true, source:'fide'|'chesstools', name, data:[{ period:'YYYY-MM', classical_rating, rapid_rating, blitz_rating }] }
//   { ok:false, error }   (short; timeouts always contain the word "timeout")
// debug=1 → raw FIDE status / timing / first 200 chars of the body, no cache
//           (&method=POST, &plain=1 to try other request shapes).
//
// Sources: ratings.fide.com rating-chart data (requested like the XHR on FIDE's
// own profile page), then chesstools (off with CHESSTOOLS_ENABLED=false).
// Runs in cdg1, with a backup copy (fide-history-us.js) in iad1: ratings.fide.com
// refuses connections from some Vercel regions (bom1, fra1).
// CORS headers are always sent, so the browser sees the real error.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const FIDE_TIMEOUT_MS = 12000;
const FIDE_RETRY_DELAY_MS = 1500;
const CHESSTOOLS_TIMEOUT_MS = 3000;
const CHESSTOOLS_ENABLED = process.env.CHESSTOOLS_ENABLED !== 'false';
const CACHE_TTL_MS = 24 * 3600 * 1000;

// Successful answers per fide_id, per warm instance
const cache = new Map();
function cacheGet(fid) {
  const e = cache.get(fid);
  if (!e) return null;
  if (Date.now() > e.exp) { cache.delete(fid); return null; }
  return e.val;
}
function cacheSet(fid, val) {
  if (cache.size > 5000) cache.clear();
  cache.set(fid, { val, exp: Date.now() + CACHE_TTL_MS });
}

// ratings.fide.com answers roughly one request at a time per client; extra
// parallelism only queues there, so cap in-flight FIDE requests per instance.
const FIDE_PARALLEL = 4;
let fideActive = 0;
const fideQueue = [];
function fideSlot(fn) {
  return new Promise((resolve, reject) => {
    fideQueue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  if (fideActive >= FIDE_PARALLEL || !fideQueue.length) return;
  fideActive++;
  const job = fideQueue.shift();
  Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { fideActive--; pump(); });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One request with a timeout → { status, body, ms }; throws Error('timeout') or a network error
// (err.code = the underlying cause, e.g. UND_ERR_CONNECT_TIMEOUT / ECONNRESET).
async function getText(url, headers, timeoutMs, method) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: method || 'GET', headers, signal: ctrl.signal });
    const body = await r.text();
    return { status: r.status, body, ms: Date.now() - started };
  } catch (e) {
    const err = new Error(ctrl.signal.aborted ? 'timeout' : 'network error');
    err.ms = Date.now() - started;
    err.code = e.cause && (e.cause.code || e.cause.name);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const num = v => { const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10); return n > 0 ? n : 0; };

// "2022-Jan" -> "2022-01"
function chartPeriod(s) {
  const m = String(s || '').match(/^(\d{4})-([A-Za-z]{3})/);
  return m && MON[m[2]] ? m[1] + '-' + MON[m[2]] : String(s || '');
}

function fideUrl(fid) { return 'https://ratings.fide.com/a_chart_data.phtml?event=' + encodeURIComponent(fid) + '&period=0'; }

// Same headers as the XHR made by FIDE's own profile page
function fideHeaders(fid) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://ratings.fide.com/profile/' + fid,
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

// One retry after 1.5 s, only on a network error, 429 or 5xx. A timeout is not
// retried: when FIDE stalls a client, a second 12 s wait just stalls again.
// opts (debug only): { method:'POST', plain:true } — plain = User-Agent + X-Requested-With only.
async function fideFetch(fid, attempts, opts) {
  const o = opts || {};
  const headers = o.plain ? { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' } : fideHeaders(fid);
  const once = () => fideSlot(() => getText(fideUrl(fid), headers, FIDE_TIMEOUT_MS, o.method));
  let res;
  try {
    res = await once();
    attempts.push({ status: res.status, ms: res.ms });
    if (res.status !== 429 && res.status < 500) return res;
  } catch (e) {
    attempts.push({ error: e.message, code: e.code, ms: e.ms });
    // FIDE's firewall drops connections from blocked IPs: retrying can't help.
    if (e.code === 'UND_ERR_CONNECT_TIMEOUT') e.message = 'connect timeout (IP blocked by FIDE)';
    if (e.message !== 'network error') throw e;
  }
  await sleep(FIDE_RETRY_DELAY_MS);
  try {
    res = await once();
    attempts.push({ status: res.status, ms: res.ms });
    return res;
  } catch (e) {
    attempts.push({ error: e.message, code: e.code, ms: e.ms });
    throw e;
  }
}

function parseJson(body) {
  try { return JSON.parse(String(body || '').replace(/^﻿/, '') || 'null'); } catch (e) { return undefined; }
}

async function fromFide(fid) {
  const res = await fideFetch(fid, []);
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const data = parseJson(res.body);
  if (!Array.isArray(data)) throw new Error(/^\s*</.test(res.body) ? 'blocked (HTML page)' : 'unexpected response');
  // An empty list means the player has never been on a rating list.
  return {
    name: (data[0] && data[0].name) || '',
    data: data.map(x => ({
      period: chartPeriod(x.date_2),
      classical_rating: num(x.rating),
      rapid_rating: num(x.rapid_rtng),
      blitz_rating: num(x.blitz_rtng),
    })),
  };
}

async function fromChesstools(fid) {
  const res = await getText('https://api.chesstools.org/fide/player_history/?fide_id=' + encodeURIComponent(fid), { 'User-Agent': UA }, CHESSTOOLS_TIMEOUT_MS);
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const data = parseJson(res.body);
  if (!Array.isArray(data)) throw new Error('unexpected response');
  return { name: '', data };
}

const SOURCES = [['fide', fromFide]].concat(CHESSTOOLS_ENABLED ? [['chesstools', fromChesstools]] : []);

async function debugFide(fid, opts) {
  const attempts = [];
  let res = null, error = '', ip = null;
  try { ip = (parseJson((await getText('https://api.ipify.org?format=json', {}, 4000)).body) || {}).ip || null; } catch (e) { /* unknown */ }
  try { res = await fideFetch(fid, attempts, opts); } catch (e) { error = e.message; }
  return {
    ok: !!res && res.status === 200 && Array.isArray(parseJson(res.body)),
    debug: {
      region: process.env.VERCEL_REGION || 'local',
      ip,
      request: { method: opts.method || 'GET', headers: opts.plain ? 'plain' : 'browser' },
      fide: res
        ? { status: res.status, ms: res.ms, body: String(res.body || '').slice(0, 200) }
        : { status: null, error, ms: attempts.length ? attempts[attempts.length - 1].ms : null },
      attempts,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const q = req.query || {};
  const fid = String(q.fide_id || '').trim();
  if (!/^\d{3,12}$/.test(fid)) return res.status(200).json({ ok: false, error: 'Missing or invalid fide_id' });

  if (q.debug === '1') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await debugFide(fid, { method: q.method === 'POST' ? 'POST' : 'GET', plain: q.plain === '1' }));
  }

  const hit = cacheGet(fid);
  if (hit) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(hit);
  }

  const errors = [];
  for (const [source, fn] of SOURCES) {
    try {
      const out = await fn(fid);
      const body = { ok: true, source, name: out.name, data: out.data };
      cacheSet(fid, body);
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json(body);
    } catch (e) {
      errors.push(source + ': ' + e.message);
    }
  }
  res.setHeader('Cache-Control', 'no-store'); // never cache errors
  res.status(200).json({ ok: false, error: errors.join('; ') });
}

// Vercel serverless function — FIDE rating history for one player.
// GET /api/fide-history?fide_id=XXXX
// → { ok:true, source:'fide'|'chesstools', name, data:[{ period:'YYYY-MM', classical_rating, rapid_rating, blitz_rating }] }
//   { ok:false, error }
// Sources, in order: FIDE's own rating-chart data (ratings.fide.com), then chesstools.
// CORS headers are always sent, so the browser sees the real error instead of a CORS block.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const SOURCE_TIMEOUT_MS = 7000;

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

async function getJson(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOURCE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return JSON.parse((await r.text()).replace(/^﻿/, '') || 'null');
  } catch (e) {
    throw ctrl.signal.aborted ? new Error('timeout') : e;
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

async function fromFide(fid) {
  const data = await fideSlot(() => getJson(
    'https://ratings.fide.com/a_chart_data.phtml?event=' + encodeURIComponent(fid) + '&period=0',
    { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' }));
  if (!Array.isArray(data)) throw new Error('unexpected response');
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
  const data = await getJson('https://api.chesstools.org/fide/player_history/?fide_id=' + encodeURIComponent(fid), { 'User-Agent': UA });
  if (!Array.isArray(data)) throw new Error('unexpected response');
  return { name: '', data };
}

const SOURCES = [['fide', fromFide], ['chesstools', fromChesstools]];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const fid = String((req.query && req.query.fide_id) || '').trim();
  if (!/^\d{3,12}$/.test(fid)) return res.status(200).json({ ok: false, error: 'Missing or invalid fide_id' });

  const errors = [];
  for (const [source, fn] of SOURCES) {
    try {
      const out = await fn(fid);
      res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=86400');
      return res.status(200).json({ ok: true, source, name: out.name, data: out.data });
    } catch (e) {
      errors.push(source + ': ' + e.message);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: false, error: errors.join('; ') });
}

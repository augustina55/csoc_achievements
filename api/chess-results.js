// Vercel serverless function — proxies chess-results.com player search
// Single: ?fide_id=XXXXX&from_date=01.07.2026&to_date=31.07.2026[&skip_tnr=123,456]
//   → { ok, tournaments, skipped }
// One tournament: ?tnr=ID&fide_id=X → { ok, rating_change, is_rated, tournament_link }
// Batch:  ?fide_ids=ID1,ID2,...&from_date=..&to_date=..[&skip={"ID1":["123"],...}]
//         (or POST JSON { fide_ids:[...], from_date, to_date, skip:{...} })
//   → { ok:true, results:{ [fid]: { ok, tournaments, skipped } | { ok:false, error } } }

const CR_BASE = 'https://s1.chess-results.com';
const SEARCH_URL = `${CR_BASE}/SpielerSuche.aspx?lan=1&SNode=S0`;
const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const BATCH_CONCURRENCY = 6;      // players processed in parallel per batch request
const PLAYER_TIMEOUT_MS = 8000;   // per attempt; one retry
const BATCH_DEADLINE_MS = 50000;  // stop starting new players near maxDuration (60 s)

// Regexes compiled once (global ones are only used via matchAll, which clones them)
const RE_VIEWSTATE = /id="__VIEWSTATE"\s+value="([^"]+)"/;
const RE_VSG       = /id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/;
const RE_EV        = /id="__EVENTVALIDATION"\s+value="([^"]+)"/;
const RE_TR        = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const RE_TD        = /<td[^>]*>([\s\S]*?)<\/td>/gi;
const RE_TNR_HREF  = /href="(tnr\d+\.aspx[^"]+)"/i;
const RE_FIDE_RTG  = /FIDE\s*rtg\s*\+\s*\/-[\s\S]{0,200}?<td[^>]*>([\s\S]*?)<\/td>/i;

// Global fetch (undici) keeps connections alive and reuses them across calls in a warm instance
async function rawReq(url, opts = {}, cookies = [], signal) {
  const headers = {
    ...UA_HEADERS,
    ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
    ...(opts.headers || {}),
  };
  const r = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body, signal });
  const text = await r.text();
  const setCookie = r.headers.get('set-cookie');
  const resCookies = setCookie ? setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean) : [];
  return { status: r.status, text, cookies: resCookies };
}

async function getViewState(signal) {
  const r = await rawReq(SEARCH_URL, {}, [], signal);
  const vs  = (r.text.match(RE_VIEWSTATE) || [])[1] || '';
  const vsg = (r.text.match(RE_VSG)       || [])[1] || '';
  const ev  = (r.text.match(RE_EV)        || [])[1] || '';
  return { vs, vsg, ev, cookies: r.cookies };
}

function parseSearchHtml(html, targetFideId) {
  const rows = [];
  for (const trm of html.matchAll(RE_TR)) {
    const cellsRaw = [...trm[1].matchAll(RE_TD)];
    if (cellsRaw.length < 9) continue;
    const cells = cellsRaw.map(m => ({
      raw: m[1],
      text: m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&[a-z]+;/g,'').replace(/\s+/g,' ').trim(),
    }));
    if (cells[2] && cells[2].text !== String(targetFideId)) continue;
    const tnrMatch = cells[5] && cells[5].raw.match(RE_TNR_HREF);
    const link = tnrMatch ? tnrMatch[1] : null;
    const tnrNum = link ? (link.match(/tnr(\d+)/) || [])[1] : null;
    const rankTxt = cells[7] ? cells[7].text : '';
    const rank = rankTxt === '-' || rankTxt === '' ? null : (parseInt(rankTxt) || null);
    rows.push({
      player_name_cr: cells[0] ? cells[0].text : '',
      tournament_name: cells[5] ? cells[5].text : '',
      tournament_link: link ? `${CR_BASE}/${link}` : (tnrNum ? `${CR_BASE}/tnr${tnrNum}.aspx?lan=1` : null),
      tournament_link_raw: link || null,
      tournament_id: tnrNum || null,
      date: cells[6] ? cells[6].text : '',
      rank,
    });
  }
  return rows;
}

// Fetch the tournament's starting-rank list, find the player by FIDE ID, return their art=9 URL.
// art=0 + zeilen=99999 lists every player (the default page cuts big tournaments short),
// turdet=YES shows the details chess-results hides for tournaments that ended > 5 days ago.
// snr = cells[0] (starting rank column)
async function getPlayerPageLink(tournId, fideId, signal) {
  try {
    const r = await rawReq(`${CR_BASE}/tnr${tournId}.aspx?lan=1&art=0&turdet=YES&zeilen=99999`, {}, [], signal);
    if (r.status !== 200) return null;
    const fideStr = String(fideId);
    for (const trm of r.text.matchAll(RE_TR)) {
      if (!trm[1].includes(fideStr)) continue;
      const cells = [...trm[1].matchAll(RE_TD)]
        .map(m => m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
      if (!cells.includes(fideStr)) continue;
      const snr = Number(cells[0]);
      if (snr) return `tnr${tournId}.aspx?lan=1&art=9&snr=${snr}&SNode=S0`;
    }
  } catch (_) {}
  return null;
}

// "-2,8" / "+70,8" / "8" → rounded integer, or null
function parseRtgChange(text) {
  const v = parseFloat(String(text).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().replace(',', '.'));
  return !isNaN(v) && Math.abs(v) <= 300 ? Math.round(v) : null;
}

// Rated only if the tournament name says FIDE or RATED (but not "unrated" / "non-FIDE" / "non rated")
function isRatedName(name) {
  var n = String(name || '');
  if (/\bun-?rated\b|\bnon[\s-]*(fide|rated)\b/i.test(n)) return false;
  return /\b(fide|rated)\b/i.test(n);
}

// Parse the player's art=9 page for "FIDE rtg +/-" and rated flag
function parsePlayerPage(html) {
  let is_rated = false, rating_change = null;

  // Primary: look for "FIDE rtg +/-" label in a table, then grab the next <td> value
  // chess-results renders it as: <td>FIDE rtg +/-</td><td>-2,8</td>
  const fidertgMatch = html.match(RE_FIDE_RTG);
  if (fidertgMatch) rating_change = parseRtgChange(fidertgMatch[1]);

  // Collect all <td> text values for rated check and fallback
  const tdTexts = [];
  for (const m of html.matchAll(RE_TD)) {
    tdTexts.push(m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
  }

  // Rated: any 4-digit number in chess rating range
  if (tdTexts.some(t => /^\d{4}$/.test(t) && +t > 999 && +t < 3500)) is_rated = true;

  // Fallback if primary not found: td that is exactly a signed integer ±1–300
  if (rating_change === null) {
    for (const t of tdTexts) {
      if (/^[+\-]\d{1,3}$/.test(t)) {
        const v = parseInt(t);
        if (Math.abs(v) >= 1 && Math.abs(v) <= 300) { rating_change = v; break; }
      }
    }
  }

  return { rating_change, is_rated };
}

async function getRatingFromTournament(tournId, playerLink, signal) {
  if (!tournId) return { rating_change: null, is_rated: false };
  try {
    // Primary: the player-specific page (art=9 with snr)
    if (playerLink) {
      const r = await rawReq(`${CR_BASE}/${playerLink}`, {}, [], signal);
      if (r.status === 200) {
        const res = parsePlayerPage(r.text);
        if (res.is_rated || res.rating_change !== null) return res;
      }
    }
    // Fallback: tournament general page
    const r = await rawReq(`${CR_BASE}/tnr${tournId}.aspx?lan=1&art=0&turdet=YES`, {}, [], signal);
    if (r.status !== 200) return { rating_change: null, is_rated: false };
    return parsePlayerPage(r.text);
  } catch (_) { return { rating_change: null, is_rated: false }; }
}

// One player → { ok, tournaments, skipped } or { ok:false, error }
async function fetchPlayer(fide_id, from_date, to_date, skipSet, signal) {
  const { vs, vsg, ev, cookies } = await getViewState(signal);
  if (!vs) return { ok: false, error: 'Could not get ViewState from chess-results' };

  const enc = s => encodeURIComponent(s);
  const fd = from_date || '01.01.2026';
  const td = to_date   || '31.12.2026';
  const body = [
    '__LASTFOCUS=','__EVENTTARGET=','__EVENTARGUMENT=',
    '__VIEWSTATE=' + enc(vs),
    '__VIEWSTATEGENERATOR=' + enc(vsg),
    '__EVENTVALIDATION=' + enc(ev),
    'ctl00%24P1%24txt_nachname=','ctl00%24P1%24txt_vorname=',
    'ctl00%24P1%24txt_verein=','ctl00%24P1%24txt_ident=',
    'ctl00%24P1%24txt_fideID=' + enc(fide_id),
    'ctl00%24P1%24txt_von_tag=' + enc(fd),
    'ctl00%24P1%24txt_bis_tag=' + enc(td),
    'ctl00%24P1%24txt_GJahr=','ctl00%24P1%24txt_min_elo=',
    'ctl00%24P1%24txt_FED=','ctl00%24P1%24txt_Fed_tur=',
    'ctl00%24P1%24combo_Sort=0',
    'ctl00%24P1%24combo_anzahl_zeilen=1',
    'ctl00%24P1%24cb_suchen=Search',
  ].join('&');

  const sr = await rawReq(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': SEARCH_URL },
    body,
  }, cookies, signal);
  if (sr.status !== 200) return { ok: false, error: 'chess-results search HTTP ' + sr.status };

  // skipSet → tournaments already saved; leave them out (and don't spend time enriching them)
  const found = parseSearchHtml(sr.text, fide_id);
  const tournaments = found.filter(t => !skipSet.has(String(t.tournament_id)));
  const skipped = found.length - tournaments.length;

  // Enrich up to 5 tournaments with rating info (in parallel; same results as before)
  await Promise.all(tournaments.slice(0, 5).map(async t => {
    const playerPageRaw = await getPlayerPageLink(t.tournament_id, fide_id, signal);
    if (playerPageRaw) {
      t.tournament_link = `${CR_BASE}/${playerPageRaw}`;
      t.tournament_link_raw = playerPageRaw;
    }
    const info = await getRatingFromTournament(t.tournament_id, t.tournament_link_raw, signal);
    t.rating_change = info.rating_change;
    t.is_rated = isRatedName(t.tournament_name);
  }));

  return { ok: true, tournaments, skipped };
}

// Per-player timeout + one retry (batch mode)
async function fetchPlayerWithRetry(fid, from_date, to_date, skipSet) {
  let last = { ok: false, error: 'not attempted' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PLAYER_TIMEOUT_MS);
    try {
      last = await fetchPlayer(fid, from_date, to_date, skipSet, ctrl.signal);
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, error: ctrl.signal.aborted ? 'timeout' : e.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

// Simple promise pool
async function runPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await worker(item); }
  });
  await Promise.all(runners);
}

function parseSkipMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

// "dd.mm.yyyy" fully before today (UTC) → results won't change
function rangeHasEnded(to_date) {
  const m = String(to_date || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return false;
  const end = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const now = new Date();
  return end < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function setCache(res, ok, to_date) {
  if (!ok) { res.setHeader('Cache-Control', 'no-store'); return; }
  res.setHeader('Cache-Control', rangeHasEnded(to_date)
    ? 'public, s-maxage=21600, stale-while-revalidate=86400'
    : 'public, s-maxage=300');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const q = { ...(req.query || {}), ...body };
  const { fide_id, from_date, to_date } = q;

  // ── One tournament: ?tnr=ID&fide_id=X → { ok, rating_change, is_rated, tournament_link } ──
  // Used to fill in results saved without a rating change.
  if (q.tnr) {
    if (!/^\d+$/.test(String(q.tnr)) || !fide_id) return res.status(200).json({ ok: false, error: 'Missing tnr or fide_id' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const link = await getPlayerPageLink(q.tnr, fide_id, ctrl.signal);
      const info = await getRatingFromTournament(q.tnr, link, ctrl.signal);
      // Found values never change once a tournament is over; misses may still appear later.
      res.setHeader('Cache-Control', info.rating_change !== null ? 'public, s-maxage=86400' : 'public, s-maxage=1800');
      return res.status(200).json({ ok: true, rating_change: info.rating_change, is_rated: info.is_rated, tournament_link: link ? `${CR_BASE}/${link}` : null });
    } catch (e) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: false, error: ctrl.signal.aborted ? 'timeout' : e.message });
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Batch mode ──
  if (q.fide_ids) {
    const ids = (Array.isArray(q.fide_ids) ? q.fide_ids : String(q.fide_ids).split(','))
      .map(s => String(s).trim()).filter(Boolean);
    const skipMap = parseSkipMap(q.skip);
    const results = {};
    const started = Date.now();
    await runPool(ids, BATCH_CONCURRENCY, async fid => {
      if (Date.now() - started > BATCH_DEADLINE_MS) { results[fid] = { ok: false, error: 'batch timeout' }; return; }
      const skipList = skipMap[fid] || [];
      const skipSet = new Set((Array.isArray(skipList) ? skipList : String(skipList).split(',')).map(String));
      results[fid] = await fetchPlayerWithRetry(fid, from_date, to_date, skipSet);
    });
    const allOk = ids.every(fid => results[fid] && results[fid].ok);
    setCache(res, allOk && req.method === 'GET', to_date);
    return res.status(200).json({ ok: true, results });
  }

  // ── Single mode (unchanged response) ──
  if (!fide_id) return res.status(200).json({ ok: false, error: 'Missing fide_id' });
  try {
    const skipSet = new Set(String(q.skip_tnr || '').split(',').map(s => s.trim()).filter(Boolean));
    const out = await fetchPlayer(fide_id, from_date, to_date, skipSet);
    setCache(res, out.ok, to_date);
    res.status(200).json(out);
  } catch (e) {
    setCache(res, false);
    res.status(200).json({ ok: false, error: e.message });
  }
}

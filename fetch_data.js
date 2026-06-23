/**
 * Fetches CircleChess explorer query 1150 to get FIDE IDs,
 * then queries chess-results for each player's June 2026 tournaments.
 */

const https = require('https');
const http  = require('http');
const { URL, URLSearchParams } = require('url');
const fs    = require('fs');

const BASE  = 'https://explorer.circlechess.com';
const EMAIL = 'tarun@cc.com';
const PASS  = 'tarun@1234';

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function parseCookies(h) {
  if (!h) return [];
  return (Array.isArray(h) ? h : [h]).map(c => c.split(';')[0].trim()).filter(Boolean);
}
function mergeCookies(a, b) {
  const m = {};
  for (const c of [...a, ...b]) { const [k] = c.split('='); m[k] = c; }
  return Object.values(m);
}
function rawReq(urlStr, opts, jar) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const options = {
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + (u.search || ''),
      method:   opts.method || 'GET',
      headers:  { 'User-Agent': 'Mozilla/5.0', ...opts.headers, Cookie: (jar||[]).join('; ') },
      timeout:  opts.timeout || 30000,
    };
    const r = mod.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}
async function followReq(urlStr, opts, jar = []) {
  let url = urlStr, method = opts.method || 'GET', cookies = [...jar];
  for (let i = 0; i < 8; i++) {
    const res = await rawReq(url, { ...opts, method }, cookies);
    cookies = mergeCookies(cookies, parseCookies(res.headers['set-cookie']));
    if ([301,302,303,307,308].includes(res.status) && res.headers.location) {
      const loc = res.headers.location;
      url = loc.startsWith('http') ? loc : new URL(loc, url).href;
      if ([301,302,303].includes(res.status)) method = 'GET';
      continue;
    }
    res.cookies = cookies;
    return res;
  }
  throw new Error('Too many redirects');
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      const v = (vals[idx] || '').trim();
      if (!v) { obj[h] = null; return; }
      const n = Number(v);
      obj[h] = isNaN(n) ? v : n;
    });
    rows.push(obj);
  }
  return rows;
}
function splitLine(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ── Explorer login ────────────────────────────────────────────────────────────
async function login() {
  console.log('Logging in to explorer...');
  const r1 = await rawReq(`${BASE}/`, { timeout: 15000 }, []);
  const c1 = parseCookies(r1.headers['set-cookie']);
  const m  = r1.text.match(/csrfmiddlewaretoken[^>]*value=["']([^"']+)/);
  const csrf = m ? m[1] : '';
  const body = new URLSearchParams({ username: EMAIL, password: PASS, csrfmiddlewaretoken: csrf, next: '/' }).toString();
  const r2 = await rawReq(`${BASE}/`, {
    method: 'POST',
    headers: { 'Referer': `${BASE}/`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body, timeout: 15000,
  }, c1);
  const c2 = parseCookies(r2.headers['set-cookie']);
  const cookies = mergeCookies(c1, c2);
  const hasSession = cookies.some(c => c.startsWith('sessionid='));
  console.log(hasSession ? '✓ Logged in' : '✗ Login failed');
  return cookies;
}

// ── Fetch explorer query as CSV ───────────────────────────────────────────────
async function fetchQuery(cookies, queryId) {
  console.log(`Fetching query ${queryId}...`);
  const r = await followReq(`${BASE}/${queryId}/download`, { timeout: 60000 }, cookies);
  if (r.status !== 200) throw new Error(`Query ${queryId} returned ${r.status}`);
  return parseCsv(r.text);
}

// ── chess-results search ──────────────────────────────────────────────────────
async function fetchChessResultsPlayer(fideId, from, to) {
  // Get the form page first (for ViewState + cookies)
  const pageUrl = 'https://s1.chess-results.com/SpielerSuche.aspx?lan=1&SNode=S0';
  const r1 = await rawReq(pageUrl, { timeout: 15000 }, []);
  const cookies = parseCookies(r1.headers['set-cookie']);

  const vs  = (r1.text.match(/id="__VIEWSTATE"\s+value="([^"]+)"/) || [])[1] || '';
  const vsg = (r1.text.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
  const ev  = (r1.text.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/) || [])[1] || '';

  const encode = s => encodeURIComponent(s);
  // date format for chess-results: DD.MM.YYYY
  const bodyStr = [
    '__LASTFOCUS=', '__EVENTTARGET=', '__EVENTARGUMENT=',
    '__VIEWSTATE=' + encode(vs),
    '__VIEWSTATEGENERATOR=' + encode(vsg),
    '__EVENTVALIDATION=' + encode(ev),
    'ctl00%24P1%24txt_nachname=', 'ctl00%24P1%24txt_vorname=', 'ctl00%24P1%24txt_verein=', 'ctl00%24P1%24txt_ident=',
    'ctl00%24P1%24txt_fideID=' + fideId,
    'ctl00%24P1%24txt_von_tag=' + encode(from),
    'ctl00%24P1%24txt_bis_tag=' + encode(to),
    'ctl00%24P1%24txt_GJahr=', 'ctl00%24P1%24txt_min_elo=', 'ctl00%24P1%24txt_FED=', 'ctl00%24P1%24txt_Fed_tur=',
    'ctl00%24P1%24combo_Sort=0', 'ctl00%24P1%24combo_anzahl_zeilen=1',
    'ctl00%24P1%24cb_suchen=Search',
  ].join('&');

  const r2 = await rawReq(pageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Referer': pageUrl,
    },
    body: bodyStr,
    timeout: 25000,
  }, cookies);

  if (r2.status !== 200) return [];

  // Parse table rows
  const html = r2.text;
  const rows = [];
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rm of rowMatches) {
    const cells = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cm => {
      let t = cm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').trim();
      return t;
    });
    // rows with href (tournament link)
    const linkMatch = rm[1].match(/href="([^"]+tnr[^"]+)"/i);
    const link = linkMatch ? linkMatch[1] : null;
    if (cells.length >= 8) {
      rows.push({ cells, link });
    }
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cookies = await login();

  // Fetch the player list from query 1150
  const players = await fetchQuery(cookies, 1150);
  console.log(`Got ${players.length} rows from query 1150`);
  console.log('Columns:', players[0] ? Object.keys(players[0]).join(', ') : 'none');

  // Save raw player data for inspection
  fs.writeFileSync('E:/csoc_achievements/players_raw.json', JSON.stringify(players, null, 2));
  console.log('Saved players_raw.json');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

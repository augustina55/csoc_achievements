/**
 * Fetches June 2026 tournament results from chess-results for all
 * CircleChess players (from query 1150).
 *
 * Output: E:\csoc_achievements\achievements.json
 */

const https = require('https');
const { URL, URLSearchParams } = require('url');
const fs = require('fs');

const CR_BASE    = 'https://s1.chess-results.com';
const FROM_DATE  = '01.06.2026';
const TO_DATE    = '23.06.2026';
const CONCURRENCY = 6;
const MIN_DELAY   = 250; // ms between requests per worker

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP ─────────────────────────────────────────────────────────────────────
function rawReq(urlStr, opts = {}, cookies = []) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + (u.search || ''),
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: cookies.join('; '),
        ...opts.headers,
      },
      timeout: opts.timeout || 30000,
    };
    const r = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('Timeout')));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function parseCookies(h) {
  if (!h) return [];
  return (Array.isArray(h) ? h : [h]).map(c => c.split(';')[0].trim()).filter(Boolean);
}
function mergeCookies(a, b) {
  const m = {};
  [...a, ...b].forEach(c => { const [k] = c.split('='); m[k] = c; });
  return Object.values(m);
}

// ── ViewState ─────────────────────────────────────────────────────────────────
async function getViewState() {
  const url = `${CR_BASE}/SpielerSuche.aspx?lan=1&SNode=S0`;
  const r = await rawReq(url);
  const cookies = parseCookies(r.headers['set-cookie']);
  const vs  = (r.text.match(/id="__VIEWSTATE"\s+value="([^"]+)"/)  || [])[1] || '';
  const vsg = (r.text.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
  const ev  = (r.text.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/)   || [])[1] || '';
  if (!vs || !ev) throw new Error('Could not get ViewState from chess-results');
  return { vs, vsg, ev, cookies };
}

// ── Parse search results HTML ─────────────────────────────────────────────────
function parseSearchHtml(html, targetFideId) {
  const rows = [];
  for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cellsRaw = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellsRaw.length < 9) continue;

    const cells = cellsRaw.map(m => ({
      raw: m[1],
      text: m[1].replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
                .replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim(),
    }));

    // Verify FIDE ID column matches
    const fideTxt = cells[2] ? cells[2].text : '';
    if (fideTxt !== String(targetFideId)) continue;

    // Extract tournament link from cell[5] (tournament name cell)
    const tnrMatch = cells[5] && cells[5].raw.match(/href="(tnr\d+\.aspx[^"]+)"/i);
    const link = tnrMatch ? tnrMatch[1] : null;

    // Extract tournament number for constructing cleaner URL
    const tnrNum = link ? (link.match(/tnr(\d+)/) || [])[1] : null;

    const rankTxt = cells[7] ? cells[7].text : '';
    const rank = rankTxt === '-' || rankTxt === '' ? null : (parseInt(rankTxt) || null);

    rows.push({
      tournament_name: cells[5] ? cells[5].text : '',
      tournament_link: link ? `${CR_BASE}/${link}` : (tnrNum ? `${CR_BASE}/tnr${tnrNum}.aspx?lan=1` : null),
      tournament_id: tnrNum || null,
      date: cells[6] ? cells[6].text : '',
      rank,
      rounds: parseInt(cells[8] ? cells[8].text : '') || null,
      players: parseInt(cells[9] ? cells[9].text : '') || null,
    });
  }
  return rows;
}

// ── Search player tournaments ─────────────────────────────────────────────────
async function searchPlayer(fideId, vs, vsg, ev, cookies) {
  const enc = s => encodeURIComponent(s);
  const body = [
    '__LASTFOCUS=', '__EVENTTARGET=', '__EVENTARGUMENT=',
    '__VIEWSTATE=' + enc(vs),
    '__VIEWSTATEGENERATOR=' + enc(vsg),
    '__EVENTVALIDATION=' + enc(ev),
    'ctl00%24P1%24txt_nachname=', 'ctl00%24P1%24txt_vorname=',
    'ctl00%24P1%24txt_verein=', 'ctl00%24P1%24txt_ident=',
    'ctl00%24P1%24txt_fideID=' + fideId,
    'ctl00%24P1%24txt_von_tag=' + enc(FROM_DATE),
    'ctl00%24P1%24txt_bis_tag=' + enc(TO_DATE),
    'ctl00%24P1%24txt_GJahr=', 'ctl00%24P1%24txt_min_elo=',
    'ctl00%24P1%24txt_FED=', 'ctl00%24P1%24txt_Fed_tur=',
    'ctl00%24P1%24combo_Sort=0',
    'ctl00%24P1%24combo_anzahl_zeilen=1',
    'ctl00%24P1%24cb_suchen=Search',
  ].join('&');

  const url = `${CR_BASE}/SpielerSuche.aspx?lan=1&SNode=S0`;
  const r = await rawReq(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'Referer': url,
    },
    body,
    timeout: 25000,
  }, cookies);

  if (r.status !== 200) {
    // If ViewState expired, try refreshing it
    if (r.status === 500) return { tournaments: [], needsRefresh: true };
    return { tournaments: [], needsRefresh: false };
  }
  return { tournaments: parseSearchHtml(r.text, fideId), needsRefresh: false };
}

// ── Get rating info from tournament starting list ─────────────────────────────
async function getRatingFromTournament(tournId, fideId) {
  if (!tournId) return { rating_before: null, rating_change: null, points: null };

  // art=0 = starting rank list (has FideId, rating, +/-)
  // art=1 = overall ranking
  // Try art=0 first
  const url = `${CR_BASE}/tnr${tournId}.aspx?lan=1&art=0&turdet=YES`;
  try {
    const r = await rawReq(url, { timeout: 20000 });
    if (r.status !== 200) return { rating_before: null, rating_change: null, points: null };

    const html = r.text;
    const fideStr = String(fideId);

    // Find the TR containing this FIDE ID
    for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!trm[1].includes(fideStr)) continue;
      const cells = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());

      // Look for +/- pattern (e.g. "+12", "-5", "+0")
      const changeCell = cells.find(c => /^[+\-]\d+$/.test(c));
      // Look for rating (3-4 digit number, not rank/round)
      const ratingCells = cells.filter(c => /^\d{3,4}$/.test(c) && parseInt(c) > 999 && parseInt(c) < 3500);
      // Points might look like "7.5", "6.0" etc
      const ptsCell = cells.find(c => /^\d+\.?\d*$/.test(c) && parseFloat(c) < 15);

      if (changeCell || ratingCells.length > 0) {
        return {
          rating_before: ratingCells.length > 0 ? parseInt(ratingCells[0]) : null,
          rating_change: changeCell ? parseInt(changeCell) : null,
          points: ptsCell ? parseFloat(ptsCell) : null,
        };
      }
    }
  } catch (_) { /* ignore */ }

  return { rating_before: null, rating_change: null, points: null };
}

// ── Concurrency pool ──────────────────────────────────────────────────────────
async function runPool(items, fn, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== CircleChess CSOC Achievements Fetcher ===');
  console.log(`Date range: ${FROM_DATE} – ${TO_DATE}`);

  console.log('\nGetting ViewState from chess-results...');
  let viewState = await getViewState();
  console.log(`✓ ViewState OK (${viewState.vs.length} chars), session cookie set`);

  const players = JSON.parse(fs.readFileSync('E:/csoc_achievements/players_raw.json', 'utf8'));
  console.log(`\nProcessing ${players.length} players (${CONCURRENCY} workers)...\n`);

  let vsRefreshCount = 0;
  let processed = 0;
  const achievements = [];

  await runPool(players, async (player, idx) => {
    await sleep(MIN_DELAY + Math.random() * 150);

    const { fide_id, player_name, mobile_number, status } = player;

    try {
      let { tournaments, needsRefresh } = await searchPlayer(
        fide_id, viewState.vs, viewState.vsg, viewState.ev, viewState.cookies
      );

      // If ViewState expired, refresh once and retry
      if (needsRefresh) {
        vsRefreshCount++;
        await sleep(500);
        viewState = await getViewState();
        const retry = await searchPlayer(
          fide_id, viewState.vs, viewState.vsg, viewState.ev, viewState.cookies
        );
        tournaments = retry.tournaments;
      }

      processed++;
      if (processed % 30 === 0) {
        process.stdout.write(`  Progress: ${processed}/${players.length}\n`);
      }

      if (tournaments.length === 0) return null;

      console.log(`  ✓ ${player_name} (${fide_id}): ${tournaments.length} tournament(s)`);

      // Enrich with rating info
      const enriched = [];
      for (const t of tournaments) {
        await sleep(200);
        const ratingInfo = await getRatingFromTournament(t.tournament_id, fide_id);
        enriched.push({ ...t, ...ratingInfo });
      }

      const entry = { player_name, fide_id, mobile_number, status, tournaments: enriched };
      achievements.push(entry);
      return entry;
    } catch (e) {
      console.error(`  ✗ ${fide_id}: ${e.message}`);
      return null;
    }
  }, CONCURRENCY);

  console.log('\n=== Done ===');
  console.log(`Players with June 2026 tournaments: ${achievements.length}`);
  console.log(`Total tournaments found: ${achievements.reduce((s, p) => s + p.tournaments.length, 0)}`);
  console.log(`ViewState refreshes needed: ${vsRefreshCount}`);

  const achievers = achievements.filter(p =>
    p.tournaments.some(t => (t.rank && t.rank <= 10) || (t.rating_change && t.rating_change >= 30))
  );
  console.log(`Achievers (top-10 or +30 rating): ${achievers.length}`);

  fs.writeFileSync('E:/csoc_achievements/achievements.json', JSON.stringify(achievements, null, 2));
  console.log('\nSaved → E:\\csoc_achievements\\achievements.json');
}

main().catch(e => { console.error('\nFatal:', e.message); process.exit(1); });

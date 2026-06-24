/**
 * Enriches achievements.json with rating data from chess-results art=9 pages.
 * For each tournament: fetch art=0 → get SNR by FIDE ID → fetch art=9 → parse stats.
 */

const https = require('https');
const fs    = require('fs');

const CR_BASE    = 'https://s1.chess-results.com';
const CONCURRENCY = 5;
const DELAY_MS    = 280;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function get(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// ── Parse art=0 starting list to get SNR + player name + tournament full name ─
async function getSnrAndName(tournId, fideId) {
  const url = `${CR_BASE}/tnr${tournId}.aspx?lan=1&art=0`;
  const r = await get(url);
  if (r.status !== 200) return { snr: null, cr_name: null, tournament_name_full: null };

  // Extract full tournament name from page title: "Chess-Results.com - NAME - Starting Rank"
  let tournament_name_full = null;
  const titleM = r.text.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleM) {
    const parts = titleM[1].split(/\s*-\s*/);
    // parts[0] = "Chess-Results.com", parts[1..n-1] = tournament name, parts[n] = "Starting Rank" / "Cross Table" etc
    if (parts.length >= 3) {
      tournament_name_full = parts.slice(1, -1).join(' - ').trim();
    } else if (parts.length === 2) {
      tournament_name_full = parts[1].trim();
    }
    if (tournament_name_full && tournament_name_full.length < 4) tournament_name_full = null;
  }

  const fideStr = String(fideId);
  for (const trm of r.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!trm[1].includes(fideStr)) continue;
    const snrHref = trm[1].match(/snr=(\d+)/i);
    const cells = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const snr = snrHref ? snrHref[1] : (cells[0] && /^\d+$/.test(cells[0]) ? cells[0] : null);
    const cr_name = cells.slice(1).find(c =>
      c.length >= 3 && /[A-Za-z]{3}/.test(c) && !/^\d+$/.test(c) && !/^[A-Z]{2,3}$/.test(c)
    ) || null;
    return { snr, cr_name, tournament_name_full };
  }
  return { snr: null, cr_name: null, tournament_name_full };
}

// ── Determine player_link from SNR ──────────────────────────────────────────
function playerLink(tournId, snr) {
  if (!snr) return `${CR_BASE}/tnr${tournId}.aspx?lan=1&art=1`;
  return `${CR_BASE}/tnr${tournId}.aspx?lan=1&art=9&snr=${snr}`;
}

// ── Parse art=9 individual player page ───────────────────────────────────────
function parsePlayerPage(html) {
  // Extract labelled fields from "Player info" section
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  function field(label) {
    const re = new RegExp(label + '\\s+([\\d\\+\\-\\.,]+)', 'i');
    const m = text.match(re);
    return m ? m[1].replace(',', '.') : null;
  }

  const ratingChange = field('FIDE rtg \\+/-');
  const perfRating   = field('Performance rating');
  const rating       = field('Rating international') || field('Rating ');
  const points       = field('Points');
  const rank         = field('Rank');

  return {
    rating_before:    rating       ? parseInt(rating)         : null,
    perf_rating:      perfRating   ? parseInt(perfRating)     : null,
    rating_change:    ratingChange ? parseFloat(ratingChange) : null,
    points:           points       ? parseFloat(points)       : null,
    rank_from_page:   rank         ? parseInt(rank)           : null,
  };
}

async function getRatingInfo(tournId, fideId) {
  try {
    const { snr, cr_name, tournament_name_full } = await getSnrAndName(tournId, fideId);
    const link = playerLink(tournId, snr);
    if (!snr) return { player_link: link, cr_name, tournament_name_full };
    await sleep(150);
    const r = await get(`${CR_BASE}/tnr${tournId}.aspx?lan=1&art=9&snr=${snr}`);
    if (r.status !== 200) return { player_link: link, cr_name, tournament_name_full };
    return { ...parsePlayerPage(r.text), snr, player_link: link, cr_name, tournament_name_full };
  } catch (_) {
    return {};
  }
}

// ── Concurrency pool ──────────────────────────────────────────────────────────
async function runPool(items, fn, limit) {
  const results = new Array(items.length);
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
  const data = JSON.parse(fs.readFileSync('E:/csoc_achievements/achievements.json', 'utf8'));

  // Flatten all (player, tournament) pairs
  const tasks = [];
  data.forEach((player, pi) => {
    player.tournaments.forEach((t, ti) => {
      if (t.tournament_id) tasks.push({ pi, ti, player_name: player.player_name, fide_id: player.fide_id, t });
    });
  });

  console.log(`Enriching ${tasks.length} tournament entries with rating data (${CONCURRENCY} workers)...`);

  let done = 0;
  await runPool(tasks, async ({ pi, ti, player_name, fide_id, t }) => {
    await sleep(DELAY_MS + Math.random() * 120);
    const info = await getRatingInfo(t.tournament_id, fide_id);
    // Merge into data
    Object.assign(data[pi].tournaments[ti], info);
    if (info.cr_name) data[pi].cr_name = info.cr_name;
    if (info.tournament_name_full) data[pi].tournaments[ti].tournament_name_full = info.tournament_name_full;
    done++;
    if (done % 30 === 0) process.stdout.write(`  ${done}/${tasks.length}\n`);
  }, CONCURRENCY);

  // Re-count achievers after enrichment
  const achievers = data.filter(p =>
    p.tournaments.some(t =>
      (t.rank && t.rank <= 10) ||
      (t.rating_change !== null && t.rating_change !== undefined && t.rating_change >= 30)
    )
  );

  console.log(`\nDone!`);
  console.log(`Achievers (top-10 or +30 rating): ${achievers.length}`);

  // Sample rating changes found
  let changesFound = 0;
  data.forEach(p => p.tournaments.forEach(t => { if (t.rating_change !== null && t.rating_change !== undefined) changesFound++; }));
  console.log(`Rating changes found: ${changesFound} / ${tasks.length}`);

  fs.writeFileSync('E:/csoc_achievements/achievements.json', JSON.stringify(data, null, 2));
  console.log('Saved → achievements.json');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

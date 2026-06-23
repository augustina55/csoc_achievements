const fs = require('fs');

function imgToBase64(filePath, mime) {
  try { return 'data:' + mime + ';base64,' + fs.readFileSync(filePath).toString('base64'); }
  catch(e) { console.warn('Could not load', filePath); return ''; }
}

const LOGO_B64  = imgToBase64('images/cc_logo.svg',     'image/svg+xml');
const MEDAL_B64 = imgToBase64('images/medals.png',      'image/png');
const CHESS_B64 = imgToBase64('images/chess_pieces.png','image/png');

const data = JSON.parse(fs.readFileSync('E:/csoc_achievements/achievements.json', 'utf8'));
data.sort((a, b) => a.player_name.localeCompare(b.player_name));

function isRated(name) {
  const n = (name || '').toUpperCase();
  return n.includes('FIDE') || n.includes('RATED');
}

// Build one row per qualifying tournament result
const achieverRows = [];
data.forEach(p => {
  p.tournaments.forEach(t => {
    const rank   = t.rank_from_page || t.rank;
    const rated  = isRated(t.tournament_name);
    const topRank    = rank != null && rank < 10;
    const ratingGain = rated && t.rating_change != null && t.rating_change >= 30;
    if (topRank || ratingGain) {
      achieverRows.push({
        player_name:     p.cr_name || p.player_name,
        fide_id:         p.fide_id,
        tournament_name: t.tournament_name,
        player_link:     t.player_link || t.tournament_link || '',
        date:            t.date || '',
        rank:            rank != null ? rank : null,
        rating_change:   t.rating_change != null ? t.rating_change : null,
        is_rated:        rated,
        type: (topRank && ratingGain) ? 'both' : (topRank ? 'rank' : 'rating')
      });
    }
  });
});

achieverRows.sort((a, b) => {
  const ar = a.rank != null ? a.rank : 9999;
  const br = b.rank != null ? b.rank : 9999;
  if (ar !== br) return ar - br;
  return (b.rating_change || 0) - (a.rating_change || 0);
});

const uniqueAchievers  = new Set(achieverRows.map(r => r.fide_id)).size;
const jsonStr          = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>');
const achieverRowsJson = JSON.stringify(achieverRows).replace(/<\/script>/gi, '<\\/script>');
const LOGO_JSON        = JSON.stringify(LOGO_B64);
const MEDAL_JSON       = JSON.stringify(MEDAL_B64);
const CHESS_JSON       = JSON.stringify(CHESS_B64);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSOC Achievements — June 2026</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:       #f5f0e8;
    --surface:  #ffffff;
    --surface2: #f0ebe0;
    --border:   #ddd0b8;
    --accent:   #b07d10;
    --text:     #1e1710;
    --text2:    #7a6545;
    --gold:     #b07d10;
    --green:    #1e7a3e;
    --red:      #c0392b;
    --brown:    #4D3F37;
    --radius:   10px;
  }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

  /* ── Header ── */
  header { background: linear-gradient(135deg, #4D3F37 0%, #2e2418 100%); border-bottom: 1px solid #2e2418; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .header-title { display: flex; align-items: center; gap: 14px; }
  .header-logo { height: 36px; display: block; }
  h1 { font-size: 1.22rem; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
  h1 span { color: #facf47; }
  .header-meta { display: flex; gap: 10px; flex-wrap: wrap; }
  .hbadge { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 4px 12px; font-size: 0.77rem; color: rgba(255,255,255,0.7); }
  .hbadge b { color: #fff; }

  /* ── Tabs ── */
  .tabs { display: flex; border-bottom: 2px solid var(--border); background: var(--surface); padding: 0 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .tab { padding: 13px 20px; font-size: 0.88rem; font-weight: 600; color: var(--text2); cursor: pointer; border-bottom: 3px solid transparent; transition: all .2s; white-space: nowrap; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-color: var(--accent); }
  .tab-badge { display: inline-block; background: var(--surface2); color: var(--text2); border-radius: 20px; padding: 1px 8px; font-size: 0.72rem; margin-left: 6px; }
  .tab-badge.gold { background: rgba(176,125,16,0.12); color: var(--gold); }

  /* ── Panels ── */
  .panel { display: none; }
  .panel.active { display: flex; height: calc(100vh - 122px); }

  /* ── Sidebar ── */
  .sidebar { width: 280px; min-width: 220px; border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .sidebar-search { padding: 12px; border-bottom: 1px solid var(--border); }
  .sidebar-search input { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 0.85rem; outline: none; }
  .sidebar-search input:focus { border-color: var(--accent); }
  .player-list { overflow-y: auto; flex: 1; }
  .player-item { padding: 11px 14px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 8px; transition: background .15s; }
  .player-item:hover { background: var(--surface2); }
  .player-item.active { background: rgba(176,125,16,0.1); border-left: 3px solid var(--accent); }
  .player-name-text { font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .player-count { font-size: 0.72rem; color: var(--text2); background: var(--surface2); border-radius: 12px; padding: 2px 7px; flex-shrink: 0; }
  .player-item.has-achievement .player-name-text { color: var(--gold); }

  /* ── Main content ── */
  .main { flex: 1; overflow-y: auto; padding: 24px 28px; }
  .placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 14px; color: var(--text2); }
  .placeholder-icon { font-size: 48px; opacity: 0.3; }
  .placeholder p { font-size: 0.95rem; }

  /* ── Player detail ── */
  .player-header { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
  .player-avatar { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, #4D3F37 0%, #d4a832 100%); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 700; flex-shrink: 0; color: #fff; }
  .player-info-block h2 { font-size: 1.15rem; font-weight: 700; }
  .player-info-block p { color: var(--text2); font-size: 0.82rem; margin-top: 3px; }
  .player-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 18px; text-align: center; min-width: 90px; }
  .stat-card .stat-val { font-size: 1.5rem; font-weight: 700; }
  .stat-card .stat-lbl { font-size: 0.7rem; color: var(--text2); margin-top: 2px; text-transform: uppercase; letter-spacing: .05em; }
  .stat-card.gold-border { border-color: var(--gold); }
  .stat-card.green-border { border-color: var(--green); }

  /* ── Tables ── */
  .table-wrap { overflow-x: auto; border-radius: var(--radius); border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
  th { background: var(--surface2); padding: 10px 14px; text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text2); white-space: nowrap; border-bottom: 1px solid var(--border); font-weight: 600; }
  td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(176,125,16,0.05); }
  .rank-chip { display: inline-block; font-weight: 700; font-size: 0.83rem; padding: 2px 9px; border-radius: 20px; }
  .rank-top3 { background: rgba(176,125,16,0.18); color: var(--gold); }
  .rank-top9 { background: rgba(176,125,16,0.09); color: var(--gold); }
  .rank-normal { color: var(--text2); }
  .rating-pos { color: var(--green); font-weight: 600; }
  .rating-neg { color: var(--red); }
  .rating-zero { color: var(--text2); }
  .btn-view { background: rgba(176,125,16,0.08); color: var(--accent); border: 1px solid rgba(176,125,16,0.22); border-radius: 6px; padding: 5px 12px; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; transition: background .15s; display: inline-block; }
  .btn-view:hover { background: rgba(176,125,16,0.16); }
  .na { color: var(--text2); opacity: 0.45; }

  /* ── Achievers panel ── */
  .achievers-panel { width: 100%; overflow-y: auto; padding: 20px 28px; }
  .achievers-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
  .achievers-title { font-size: 1rem; font-weight: 700; }
  .filter-row { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
  .filter-btn { border-radius: 20px; padding: 4px 14px; font-size: 0.78rem; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text2); transition: all .15s; }
  .filter-btn:hover { color: var(--text); border-color: var(--accent); }
  .filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .filter-btn.active-green { background: var(--green); color: #fff; border-color: var(--green); }
  .type-badge { border-radius: 20px; padding: 2px 9px; font-size: 0.71rem; font-weight: 700; white-space: nowrap; }
  .type-rank   { background: rgba(176,125,16,0.1);  color: var(--gold);  border: 1px solid rgba(176,125,16,0.25); }
  .type-rating { background: rgba(30,122,62,0.1);   color: var(--green); border: 1px solid rgba(30,122,62,0.25); }
  .type-both   { background: rgba(176,125,16,0.12); color: var(--gold);  border: 1px solid rgba(176,125,16,0.3); }
  .rated-pill { background: #b07d10; color: #fff; border-radius: 10px; padding: 1px 7px; font-size: 0.67rem; font-weight: 700; letter-spacing: .04em; vertical-align: middle; margin-left: 5px; }
  .btn-poster { background: #fff; color: var(--accent); border: 1px solid rgba(176,125,16,0.35); border-radius: 6px; padding: 5px 11px; font-size: 0.77rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all .15s; }
  .btn-poster:hover { background: rgba(176,125,16,0.08); border-color: var(--accent); }

  /* ── Modal ── */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; width: 440px; max-width: 96vw; box-shadow: 0 12px 48px rgba(0,0,0,0.18); }
  .modal-header { padding: 18px 22px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .modal-header h3 { font-size: 0.97rem; font-weight: 700; }
  .modal-close { background: none; border: none; color: var(--text2); font-size: 1.15rem; cursor: pointer; padding: 3px 7px; border-radius: 5px; line-height: 1; }
  .modal-close:hover { background: var(--surface2); color: var(--text); }
  .upload-area { border: 2px dashed var(--border); border-radius: 10px; padding: 18px 14px; text-align: center; cursor: pointer; transition: border-color .2s; background: var(--surface2); }
  .upload-area:hover { border-color: var(--accent); background: rgba(176,125,16,0.04); }
  .modal-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
  .mfield label { font-size: 0.71rem; color: var(--text2); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; display: block; margin-bottom: 5px; }
  .mval { font-size: 0.87rem; background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 8px 12px; }
  input.mval { outline: none; }
  input.mval:focus { border-color: var(--accent); }
  .upload-hint { color: var(--text2); font-size: 0.83rem; }
  .upload-hint strong { color: var(--accent); }
  #photo-preview { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent); display: none; margin: 0 auto 10px; }
  .color-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .cswatch { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: border-color .15s, transform .15s; }
  .cswatch:hover { transform: scale(1.15); }
  .cswatch.sel { border-color: #fff; transform: scale(1.15); }
  .modal-footer { padding: 14px 22px 18px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; }
  .btn-gen { background: linear-gradient(135deg, #c49b1a, #9a7810); color: #fff; border: none; border-radius: 8px; padding: 10px 22px; font-size: 0.88rem; font-weight: 700; cursor: pointer; }
  .btn-gen:hover { opacity: 0.88; }
  .btn-cnl { background: var(--surface2); color: var(--text2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 18px; font-size: 0.88rem; cursor: pointer; }
  .btn-cnl:hover { color: var(--text); }
  .btn-preview { background: var(--surface2); color: var(--accent); border: 1px solid rgba(176,125,16,0.35); border-radius: 8px; padding: 10px 18px; font-size: 0.88rem; font-weight: 600; cursor: pointer; }
  .btn-preview:hover { background: rgba(176,125,16,0.08); }

  /* ── Scrollbars ── */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<header>
  <div class="header-title">
    <img class="header-logo" src="${LOGO_B64}" alt="CircleChess">
    <div>
      <h1>CSOC <span>Achievements</span></h1>
      <div style="font-size:0.77rem;color:rgba(255,255,255,0.6);margin-top:2px">June 2026 · CircleChess Academy</div>
    </div>
  </div>
  <div class="header-meta">
    <div class="hbadge">Players <b id="stat-players">—</b></div>
    <div class="hbadge">Tournaments <b id="stat-tournaments">—</b></div>
    <div class="hbadge">Achievers <b id="stat-achievers">—</b></div>
  </div>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('achievers')">★ Achievers <span class="tab-badge gold" id="badge-achievers">—</span></div>
  <div class="tab" onclick="switchTab('all')">All Achievements <span class="tab-badge" id="badge-all">—</span></div>
</div>

<!-- All Achievements -->
<div class="panel" id="panel-all">
  <div class="sidebar">
    <div class="sidebar-search">
      <input id="search-input" type="text" placeholder="Search player…" oninput="filterPlayers(this.value)">
    </div>
    <div class="player-list" id="player-list"></div>
  </div>
  <div class="main" id="main-content">
    <div class="placeholder">
      <div class="placeholder-icon">♟</div>
      <p>Select a player to view their June 2026 results</p>
    </div>
  </div>
</div>

<!-- Achievers -->
<div class="panel active" id="panel-achievers">
  <div class="achievers-panel">
    <div class="achievers-header">
      <span class="achievers-title">★ Achievers</span>
      <div class="filter-row">
        <button class="filter-btn active" id="fbtn-all"   onclick="setFilter('all')">All</button>
        <button class="filter-btn"        id="fbtn-rank"  onclick="setFilter('rank')">Top 9</button>
        <button class="filter-btn"        id="fbtn-rated" onclick="setFilter('rated')">FIDE / Rated</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Player</th><th>Tournament</th><th>Date</th>
          <th>Rank</th><th>Rating ±</th><th>Type</th><th></th>
        </tr></thead>
        <tbody id="achievers-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- Poster Modal -->
<div class="modal-overlay" id="poster-modal">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>🏆 Generate Achievement Poster</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="mfield">
        <label>Player</label>
        <input type="text" class="mval" id="modal-player" value="—" style="width:100%;font-weight:600;cursor:text">
      </div>
      <div class="mfield">
        <label>Position</label>
        <div class="mval" id="modal-achievement" style="font-size:0.84rem;color:var(--text)">—</div>
      </div>
      <div class="mfield">
        <label>Tournament</label>
        <input type="text" class="mval" id="modal-tournament" value="—" style="width:100%;font-size:0.83rem;cursor:text">
      </div>
      <div class="mfield">
        <label>Player Photo (optional)</label>
        <div class="upload-area" onclick="document.getElementById('photo-input').click()">
          <img id="photo-preview" alt="preview">
          <div class="upload-hint" id="upload-hint"><strong>Click to upload</strong> a player photo</div>
          <input type="file" id="photo-input" accept="image/*" style="display:none" onchange="handlePhotoUpload(this)">
        </div>
      </div>
      <div class="mfield">
        <label>Poster Color</label>
        <div class="color-row" id="color-swatches"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-cnl" onclick="closeModal()">Cancel</button>
      <button class="btn-gen" onclick="generatePoster()">👁 Preview &amp; Download</button>
    </div>
  </div>
</div>

<script>
const DATA          = ${jsonStr};
const ACHIEVER_ROWS = ${achieverRowsJson};
const LOGO_B64      = ${LOGO_JSON};
const MEDAL_B64     = ${MEDAL_JSON};
const CHESS_B64     = ${CHESS_JSON};

// Stats
const totalTournaments = DATA.reduce(function(s,p){ return s + p.tournaments.length; }, 0);
document.getElementById('stat-players').textContent    = DATA.length;
document.getElementById('stat-tournaments').textContent = totalTournaments;
document.getElementById('stat-achievers').textContent  = ${uniqueAchievers};
document.getElementById('badge-all').textContent       = DATA.length;
document.getElementById('badge-achievers').textContent = ACHIEVER_ROWS.length;

// ── Helpers ──────────────────────────────────────────────────────────────────
function isRated(name) {
  var n = (name||'').toUpperCase();
  return n.includes('FIDE') || n.includes('RATED');
}

function isAchiever(p) {
  return p.tournaments.some(function(t) {
    var r = t.rank_from_page || t.rank;
    return (r && r < 10) || (isRated(t.tournament_name) && t.rating_change != null && t.rating_change >= 30);
  });
}

function initials(name) {
  return name.split(/[ ,]+/).filter(Boolean).slice(0,2).map(function(w){ return w[0].toUpperCase(); }).join('');
}

function rankChip(rank) {
  if (!rank || rank >= 9999) return '<span class="na">—</span>';
  if (rank <= 3) return \`<span class="rank-chip rank-top3">#\${rank}</span>\`;
  if (rank < 10) return \`<span class="rank-chip rank-top9">#\${rank}</span>\`;
  return \`<span class="rank-chip rank-normal">#\${rank}</span>\`;
}

function ratingChange(rc) {
  if (rc === null || rc === undefined) return '<span class="na">—</span>';
  var sign = rc > 0 ? '+' : '';
  var cls  = rc > 0 ? 'rating-pos' : rc < 0 ? 'rating-neg' : 'rating-zero';
  return \`<span class="\${cls}">\${sign}\${rc}</span>\`;
}

function fmtDate(d) { return d ? d.replace(/\\//g, '-') : '—'; }

function tournamentRows(tournaments) {
  return tournaments.map(function(t) {
    var rank = t.rank_from_page || t.rank;
    var pts  = t.points !== null && t.points !== undefined ? t.points : '—';
    var tn   = t.tournament_name.length > 32 ? t.tournament_name.slice(0,32)+'…' : t.tournament_name;
    return \`<tr>
      <td><a href="\${t.tournament_link||'#'}" target="_blank" style="color:var(--text);text-decoration:none;font-weight:500" title="\${t.tournament_name}">\${tn}</a></td>
      <td style="white-space:nowrap">\${fmtDate(t.date)}</td>
      <td>\${rankChip(rank)}</td>
      <td>\${pts !== '—' ? pts : '<span class="na">—</span>'}</td>
      <td>\${t.rating_before ? t.rating_before : '<span class="na">—</span>'}</td>
      <td>\${ratingChange(t.rating_change)}</td>
      <td>\${t.perf_rating ? t.perf_rating : '<span class="na">—</span>'}</td>
      <td>\${t.rounds||'—'}</td>
      <td>\${t.players||'—'}</td>
      <td><a class="btn-view" href="\${t.player_link||t.tournament_link||'#'}" target="_blank">View →</a></td>
    </tr>\`;
  }).join('');
}

// ── Player list ───────────────────────────────────────────────────────────────
function buildPlayerList(players) {
  document.getElementById('player-list').innerHTML = players.map(function(p) {
    var ach = isAchiever(p);
    return \`<div class="player-item\${ach?' has-achievement':''}" onclick="selectPlayer('\${p.fide_id}')" id="pitem-\${p.fide_id}">
      <span class="player-name-text" title="\${p.player_name}">\${p.player_name}</span>
      <span class="player-count">\${p.tournaments.length}</span>
    </div>\`;
  }).join('');
}
buildPlayerList(DATA);

function filterPlayers(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.player-item').forEach(function(el) {
    el.style.display = el.querySelector('.player-name-text').textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function selectPlayer(fideId) {
  var player = DATA.find(function(p){ return String(p.fide_id) === String(fideId); });
  if (!player) return;
  document.querySelectorAll('.player-item').forEach(function(el){ el.classList.remove('active'); });
  var item = document.getElementById('pitem-' + fideId);
  if (item) item.classList.add('active');

  var bestRank = Math.min.apply(null, player.tournaments.map(function(t){ return t.rank_from_page||t.rank||9999; }));
  var bestGain = player.tournaments.reduce(function(mx,t){
    return t.rating_change!=null && t.rating_change > mx ? t.rating_change : mx;
  }, -999);
  var valid  = player.tournaments.filter(function(t){ return t.points!=null; });
  var avgPts = valid.length ? (valid.reduce(function(s,t){ return s+t.points; },0)/valid.length).toFixed(1) : null;

  document.getElementById('main-content').innerHTML = \`
    <div class="player-header">
      <div class="player-avatar">\${initials(player.player_name)}</div>
      <div class="player-info-block">
        <h2>\${player.player_name}</h2>
        <p>FIDE \${player.fide_id} &nbsp;·&nbsp; \${player.tournaments.length} tournament\${player.tournaments.length!==1?'s':''} in June 2026</p>
      </div>
    </div>
    <div class="player-stats">
      <div class="stat-card\${bestRank<9999?' gold-border':''}">
        <div class="stat-val">\${bestRank<9999?'#'+bestRank:'—'}</div>
        <div class="stat-lbl">Best Rank</div>
      </div>
      <div class="stat-card\${bestGain>=30?' green-border':''}">
        <div class="stat-val">\${bestGain>-999?(bestGain>=0?'+':'')+bestGain:'—'}</div>
        <div class="stat-lbl">Best Rating Gain</div>
      </div>
      \${avgPts?'<div class="stat-card"><div class="stat-val">'+avgPts+'</div><div class="stat-lbl">Avg Points</div></div>':''}
      <div class="stat-card"><div class="stat-val">\${player.tournaments.length}</div><div class="stat-lbl">Tournaments</div></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Tournament</th><th>Date</th><th>Rank</th><th>Points</th>
          <th>Rating</th><th>FIDE ±</th><th>Perf</th><th>Rounds</th><th>Players</th><th></th>
        </tr></thead>
        <tbody>\${tournamentRows(player.tournaments)}</tbody>
      </table>
    </div>
  \`;
}

// ── Achievers table ───────────────────────────────────────────────────────────
var currentFilter = 'all';

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(function(b) {
    b.classList.remove('active', 'active-green');
  });
  var btn = document.getElementById('fbtn-' + f);
  if (btn) btn.classList.add(f === 'rated' ? 'active-green' : 'active');
  renderAchieversTable();
}

function renderAchieversTable() {
  var rows = ACHIEVER_ROWS.filter(function(r) {
    if (currentFilter === 'rank')  return r.type === 'rank' || r.type === 'both';
    if (currentFilter === 'rated') return r.is_rated;
    return true;
  });
  document.getElementById('achievers-tbody').innerHTML = rows.map(function(r, i) {
    var origIdx  = ACHIEVER_ROWS.indexOf(r);
    var tn       = r.tournament_name.length > 38 ? r.tournament_name.slice(0,38)+'…' : r.tournament_name;
    var typeLbl  = r.type==='both' ? 'Top 9 + Rating' : (r.type==='rank' ? 'Top 9' : '+Rating');
    var typeCls  = r.type==='rating' ? 'type-rating' : (r.type==='both' ? 'type-both' : 'type-rank');
    var ratedTag = r.is_rated ? '<span class="rated-pill">FIDE</span>' : '';
    return \`<tr>
      <td style="color:var(--text2);font-size:0.79rem">\${i+1}</td>
      <td style="font-weight:600;white-space:nowrap">\${r.player_name}</td>
      <td>
        <a href="\${r.player_link||'#'}" target="_blank" style="color:var(--text);text-decoration:none" title="\${r.tournament_name}">\${tn}</a>\${ratedTag}
      </td>
      <td style="white-space:nowrap;color:var(--text2)">\${fmtDate(r.date)}</td>
      <td>\${r.rank ? rankChip(r.rank) : '<span class="na">—</span>'}</td>
      <td>\${r.is_rated ? ratingChange(r.rating_change) : '<span class="na">—</span>'}</td>
      <td><span class="type-badge \${typeCls}">\${typeLbl}</span></td>
      <td><button class="btn-poster" onclick="openPosterModal(\${origIdx})">🖼 Poster</button></td>
    </tr>\`;
  }).join('');
}
renderAchieversTable();

// ── Poster modal ──────────────────────────────────────────────────────────────
var currentRow   = null;
var currentColor = '#d4a832';
var photoDataUri = '';

var POSTER_COLORS = [
  '#d4a832','#ff6b6b','#f7a440','#f9e04b','#6bcb77',
  '#4dabf7','#da77f2','#f06595','#38d9a9','#748ffc'
];

(function initSwatches() {
  document.getElementById('color-swatches').innerHTML = POSTER_COLORS.map(function(c, i) {
    return '<div class="cswatch'+(i===0?' sel':'')+'" style="background:'+c+'" '
      +'data-color="'+c+'" onclick="selectColor(this.dataset.color,this)" title="'+c+'"></div>';
  }).join('');
})();

function selectColor(c, el) {
  currentColor = String(c);
  document.querySelectorAll('.cswatch').forEach(function(s){ s.classList.remove('sel'); });
  el.classList.add('sel');
}

function rankToOrdinal(n) {
  var names = ['','First','Runner-Up','Second Runner-Up','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth'];
  return (n >= 1 && n <= 9) ? names[n] : 'Position ' + n;
}

function buildAchText(r) {
  if (r.rank != null && r.rank < 10) {
    var pos = 'Secured ' + rankToOrdinal(r.rank);
    if (r.is_rated && r.rating_change != null && r.rating_change >= 30)
      pos += '  ·  +' + r.rating_change + ' pts';
    return pos;
  }
  return '+' + r.rating_change + ' Rating Points';
}

function openPosterModal(idx) {
  currentRow   = ACHIEVER_ROWS[idx];
  photoDataUri = '';
  document.getElementById('modal-player').value            = currentRow.player_name;
  document.getElementById('modal-achievement').textContent = buildAchText(currentRow);
  document.getElementById('modal-tournament').value        = currentRow.tournament_name;
  document.getElementById('photo-preview').style.display   = 'none';
  document.getElementById('upload-hint').innerHTML         = '<strong>Click to upload</strong> a player photo';
  document.getElementById('photo-input').value             = '';
  document.getElementById('poster-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('poster-modal').classList.remove('open');
}

document.getElementById('poster-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

function handlePhotoUpload(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    photoDataUri = e.target.result;
    var prev = document.getElementById('photo-preview');
    prev.src   = photoDataUri;
    prev.style.display = 'block';
    document.getElementById('upload-hint').textContent = '✓ ' + file.name;
  };
  reader.readAsDataURL(file);
}

// ── Poster HTML (popup preview) ───────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildPosterHtml(name, posText, tournamentName, photoUri) {
  var base  = currentColor;
  var strip = darkenColor(base, 0.28);
  var bg    = lightenColor(base, 0.60);

  var css = ''
    +'* { margin:0; padding:0; box-sizing:border-box; }'
    +'body { background:#d8cfc3; }'
    +'.toolbar { position:fixed; top:0; left:0; right:0; background:#fff; padding:9px 20px;'
    +'  display:flex; align-items:center; justify-content:space-between; z-index:200;'
    +'  box-shadow:0 2px 10px rgba(0,0,0,0.12); font-family:Arial,sans-serif; }'
    +'.toolbar span { font-size:13px; color:#666; }'
    +'.dl-btn { background:#9a7810; color:#fff; border:none; border-radius:6px;'
    +'  padding:8px 20px; font-size:13px; font-weight:700; cursor:pointer; }'
    +'.poster-wrap { padding-top:56px; display:flex; justify-content:center; min-height:100vh; padding-bottom:24px; }'
    +'.poster { width:540px; height:700px; position:relative; overflow:hidden;'
    +'  background-color:'+bg+';'
    +'  background-image:radial-gradient(circle,rgba(150,200,180,0.5) 2.5px,transparent 2.5px);'
    +'  background-size:24px 24px; font-family:Arial,Helvetica,sans-serif; }'
    +'.strip { position:absolute; left:50px; top:55px; width:185px; height:590px;'
    +'  background:'+strip+'; border-top-left-radius:65px; border-bottom-left-radius:65px; z-index:2; }'
    +'.champ-text { position:absolute; right:312px; top:55px; writing-mode:vertical-rl;'
    +'  text-orientation:mixed; transform:rotate(180deg); font-size:105px; font-weight:900;'
    +'  font-family:"Arial Black",Arial,sans-serif; color:transparent;'
    +'  -webkit-text-stroke:5px #ffffff; letter-spacing:8px; white-space:nowrap; z-index:5; }'
    +'.grid-panel { position:absolute; left:233px; top:55px; width:307px; height:590px;'
    +'  background:#fff; z-index:2; border:1.5px solid #c0c0c0;'
    +'  box-shadow:-5px 0 16px rgba(0,0,0,.13),5px 5px 16px rgba(0,0,0,.09); }'
    +'.logo-area { position:absolute; right:10px; top:10px; }'
    +'.logo-area img { width:160px; height:80px; object-fit:contain; display:block; }'
    +'.student-name { position:absolute; top:168px; left:0; right:0; text-align:center;'
    +'  font-family:Georgia,serif; font-size:20px; font-weight:bold; color:#2c3e50; padding:0 14px; }'
    +'.divider { position:absolute; top:208px; left:14px; right:14px; height:2.5px; background:'+strip+'; }'
    +'.ach-pos { position:absolute; top:226px; left:0; right:0; text-align:center;'
    +'  font-size:15px; font-weight:700; color:#3a4a5c; padding:0 14px; line-height:1.6; }'
    +'.ach-tourn { position:absolute; top:254px; left:0; right:0; text-align:center;'
    +'  font-size:15px; font-weight:700; color:#2c3e50; padding:0 14px; line-height:1.5; }'
    +'.medal { position:absolute; top:-35px; left:-50px; width:200px; z-index:10; }'
    +'.chess { position:absolute; bottom:-40px; right:-30px; width:260px; z-index:10; }'
    +'.profile { position:absolute; left:48px; bottom:20px; width:210px; height:210px;'
    +'  border-radius:50%; overflow:hidden; background:#ddd; border:4px solid '+strip+'; z-index:6; }'
    +'.profile img { width:100%; height:100%; object-fit:cover; display:block; }'
    +'.footer-url { position:absolute; bottom:10px; right:14px; font-size:10px; color:#999; z-index:5; }';

  /* ── popup canvas script (all double-quoted JS, no single-quote conflicts) ── */
  var sc = [
    'var BG="'+bg+'",ST="'+strip+'";',
    'function wT(c,t,x,y,mw,lh){',
    '  var ws=t.split(" "),ln="";',
    '  for(var i=0;i<ws.length;i++){',
    '    var ts=ln?ln+" "+ws[i]:ws[i];',
    '    if(c.measureText(ts).width>mw&&ln){c.fillText(ln,x,y);ln=ws[i];y+=lh;}else ln=ts;',
    '  }if(ln)c.fillText(ln,x,y);return y;',
    '}',
    'function dlPNG(){',
    '  var W=540,H=700;',
    '  var cv=document.createElement("canvas");cv.width=W;cv.height=H;',
    '  var ctx=cv.getContext("2d");',
    '  ctx.fillStyle=BG;ctx.fillRect(0,0,W,H);',
    '  ctx.fillStyle="rgba(100,180,140,0.42)";',
    '  for(var dy=12;dy<H;dy+=24)for(var dx=12;dx<W;dx+=24){ctx.beginPath();ctx.arc(dx,dy,2.5,0,Math.PI*2);ctx.fill();}',
    '  var sx=50,sy=55,sw=185,sh=590,sr=65;',
    '  ctx.beginPath();ctx.moveTo(sx+sr,sy);ctx.lineTo(sx+sw,sy);ctx.lineTo(sx+sw,sy+sh);',
    '  ctx.lineTo(sx+sr,sy+sh);ctx.quadraticCurveTo(sx,sy+sh,sx,sy+sh-sr);',
    '  ctx.lineTo(sx,sy+sr);ctx.quadraticCurveTo(sx,sy,sx+sr,sy);',
    '  ctx.closePath();ctx.fillStyle=ST;ctx.fill();',
    '  ctx.save();ctx.translate(sx+sw/2,sy+sh/2);ctx.rotate(-Math.PI/2);',
    '  ctx.font="900 85px Arial,sans-serif";ctx.strokeStyle="rgba(255,255,255,0.82)";',
    '  ctx.lineWidth=4;ctx.textAlign="center";ctx.textBaseline="middle";',
    '  ctx.strokeText("CHAMP",0,0);ctx.restore();',
    '  var px=233,py=55,pw=307,ph=590;',
    '  ctx.save();ctx.shadowColor="rgba(0,0,0,0.13)";ctx.shadowBlur=16;',
    '  ctx.shadowOffsetX=-5;ctx.shadowOffsetY=4;ctx.fillStyle="#fff";ctx.fillRect(px,py,pw,ph);ctx.restore();',
    '  ctx.strokeStyle="#c0c0c0";ctx.lineWidth=1;ctx.strokeRect(px,py,pw,ph);',
    '  var nm=document.querySelector(".student-name").textContent.trim();',
    '  var pt=document.querySelector(".ach-pos").textContent.trim();',
    '  var tt=document.querySelector(".ach-tourn").textContent.trim();',
    '  var cxP=px+pw/2;',
    '  ctx.fillStyle="#2c3e50";ctx.font="bold 19px Georgia,serif";',
    '  ctx.textAlign="center";ctx.textBaseline="alphabetic";',
    '  wT(ctx,nm,cxP,237,pw-32,24);',
    '  ctx.fillStyle=ST;ctx.fillRect(px+14,263,pw-28,2);',
    '  ctx.fillStyle="#3a4a5c";ctx.font="bold 15px Arial,sans-serif";',
    '  wT(ctx,pt,cxP,293,pw-28,20);',
    '  ctx.fillStyle="#2c3e50";ctx.font="bold 15px Arial,sans-serif";',
    '  wT(ctx,tt,cxP,321,pw-28,20);',
    '  ctx.fillStyle="#bbb";ctx.font="10px Arial,sans-serif";ctx.textAlign="right";',
    '  ctx.fillText("learn.circlechess.com",px+pw-10,635);',
    '  var md=document.querySelector(".medal");',
    '  var ch=document.querySelector(".chess");',
    '  var lg=document.querySelector(".logo-area img");',
    '  var pf=document.querySelector(".profile img");',
    '  var tot=4,dn=0;',
    '  var fn=nm.replace(/[^a-zA-Z0-9]/g,"_")+"_poster.png";',
    '  function fin(){var a=document.createElement("a");a.download=fn;a.href=cv.toDataURL("image/png");document.body.appendChild(a);a.click();document.body.removeChild(a);}',
    '  function od(){if(++dn===tot)fin();}',
    '  function di(img,dx,dy,dw,dh){if(!img){od();return;}var i2=new Image();i2.onload=function(){ctx.drawImage(i2,dx,dy,dw,dh);od();};i2.onerror=od;i2.src=img.src;}',
    '  function dc(img,cx2,cy2,cr){if(!img){od();return;}var i2=new Image();i2.onload=function(){ctx.save();ctx.beginPath();ctx.arc(cx2,cy2,cr,0,Math.PI*2);ctx.clip();ctx.drawImage(i2,cx2-cr,cy2-cr,cr*2,cr*2);ctx.restore();ctx.beginPath();ctx.arc(cx2,cy2,cr,0,Math.PI*2);ctx.strokeStyle=ST;ctx.lineWidth=4;ctx.stroke();od();};i2.onerror=od;i2.src=img.src;}',
    '  di(md,-50,-35,200,200);',
    '  di(ch,W-230,H-220,260,260);',
    '  di(lg,px+pw-170,py+10,160,80);',
    '  dc(pf,153,575,105);',
    '}'
  ].join('\\n');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    +'<title>Poster Preview</title><style>'+css+'</style></head>'
    +'<body>'
    +'<div class="toolbar">'
    +'  <span>Achievement Poster — Preview</span>'
    +'  <button class="dl-btn" onclick="dlPNG()">&#11015; Download PNG</button>'
    +'</div>'
    +'<div class="poster-wrap">'
    +'<div id="poster-div" class="poster">'
    +'  <img class="medal" src="'+MEDAL_B64+'" alt="">'
    +'  <div class="strip"></div>'
    +'  <div class="champ-text">CHAMP</div>'
    +'  <div class="grid-panel">'
    +'    <div class="logo-area"><img src="'+LOGO_B64+'" alt="CircleChess"></div>'
    +'    <div class="student-name">'+escHtml(name)+'</div>'
    +'    <div class="divider"></div>'
    +'    <div class="ach-pos">'+escHtml(posText)+'</div>'
    +'    <div class="ach-tourn">'+escHtml(tournamentName)+'</div>'
    +'  </div>'
    +(photoUri ? '  <div class="profile"><img src="'+photoUri+'" alt=""></div>' : '')
    +'  <img class="chess" src="'+CHESS_B64+'" alt="">'
    +'  <div class="footer-url">learn.circlechess.com</div>'
    +'</div>'
    +'</div>'
    +'<'+'script>'+sc+'<'+'/scri'+'pt>'
    +'</body></html>';
}

function generatePoster() {
  if (!currentRow) return;
  var playerName     = (document.getElementById('modal-player').value     || '').trim() || currentRow.player_name;
  var tournamentName = (document.getElementById('modal-tournament').value || '').trim() || currentRow.tournament_name;
  var posText        = buildAchText(currentRow);
  var posterHtml     = buildPosterHtml(playerName, posText, tournamentName, photoDataUri);
  var win = window.open('', '_blank', 'width=600,height=800,toolbar=no,menubar=no,scrollbars=yes,location=no');
  if (!win) { alert('Please allow pop-ups for this page to preview the poster.'); return; }
  win.document.open();
  win.document.write(posterHtml);
  win.document.close();
}

function downloadPosterPng(popupWin) {
  var poster   = popupWin.document.getElementById('poster-div');
  var styleTag = popupWin.document.querySelector('style');
  if (!poster) { alert('Poster element not found.'); return; }
  var css = styleTag ? styleTag.textContent : '';
  var W = 540, H = 700;
  var nameEl = poster.querySelector('.student-name');
  var fname  = (nameEl ? nameEl.textContent : 'poster').trim().replace(/[^a-zA-Z0-9]/g, '_');
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
    + '<defs><style><![CDATA[' + css + ']]></style></defs>'
    + '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">'
    + '<div xmlns="http://www.w3.org/1999/xhtml">' + poster.outerHTML + '</div>'
    + '</foreignObject>'
    + '</svg>';
  var blob = new Blob([svg], {type: 'image/svg+xml;charset=utf-8'});
  var url  = URL.createObjectURL(blob);
  var img  = new Image();
  img.onload = function() {
    var cv  = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    try {
      var a = document.createElement('a');
      a.download = fname + '_poster.png';
      a.href = cv.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch(e) {
      alert('Export failed: ' + e.message + '. Try Chrome or Edge.');
    }
  };
  img.onerror = function() { alert('SVG render failed.'); };
  img.src = url;
}

// ── Poster generation (Canvas → PNG download) ─────────────────────────────────
function darkenColor(hex, amt) {
  var n = parseInt(hex.replace('#',''),16);
  var r=(n>>16)&0xff, g=(n>>8)&0xff, b=n&0xff;
  return '#'
    +Math.max(0,Math.round(r*(1-amt))).toString(16).padStart(2,'0')
    +Math.max(0,Math.round(g*(1-amt))).toString(16).padStart(2,'0')
    +Math.max(0,Math.round(b*(1-amt))).toString(16).padStart(2,'0');
}

function lightenColor(hex, amt) {
  var n = parseInt(hex.replace('#',''),16);
  var r=(n>>16)&0xff, g=(n>>8)&0xff, b=n&0xff;
  return '#'
    +Math.min(255,Math.round(r+(255-r)*amt)).toString(16).padStart(2,'0')
    +Math.min(255,Math.round(g+(255-g)*amt)).toString(16).padStart(2,'0')
    +Math.min(255,Math.round(b+(255-b)*amt)).toString(16).padStart(2,'0');
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  var words = text.split(' ');
  var line  = '';
  for (var i = 0; i < words.length; i++) {
    var test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = words[i];
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

function drawAndDownloadPoster() {
  if (!currentRow) return;

  var playerName    = (document.getElementById('modal-player').value     || '').trim() || currentRow.player_name;
  var tournamentName = (document.getElementById('modal-tournament').value || '').trim() || currentRow.tournament_name;
  var base  = currentColor;
  var strip = darkenColor(base, 0.28);
  var bg    = lightenColor(base, 0.60);

  // Achievement lines
  var achLine1 = buildAchText(currentRow);
  var achLine2 = tournamentName;

  var W = 540, H = 700;
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');

  // 1. Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 2. Dot grid
  ctx.fillStyle = 'rgba(100,180,140,0.42)';
  for (var dy = 12; dy < H; dy += 24) {
    for (var dx = 12; dx < W; dx += 24) {
      ctx.beginPath();
      ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Left strip (rounded on left side only)
  var sx = 50, sy = 55, sw = 185, sh = 590, sr = 65;
  ctx.beginPath();
  ctx.moveTo(sx + sr, sy);
  ctx.lineTo(sx + sw, sy);
  ctx.lineTo(sx + sw, sy + sh);
  ctx.lineTo(sx + sr, sy + sh);
  ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh - sr);
  ctx.lineTo(sx, sy + sr);
  ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
  ctx.closePath();
  ctx.fillStyle = strip;
  ctx.fill();

  // 4. CHAMP vertical stroke text centred on strip
  ctx.save();
  ctx.translate(sx + sw / 2, sy + sh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '900 85px Arial, sans-serif';
  ctx.strokeStyle = 'rgba(255,255,255,0.82)';
  ctx.lineWidth = 4;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('CHAMP', 0, 0);
  ctx.restore();

  // 5. White panel with shadow
  var px = 233, py = 55, pw = 307, ph = 590;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.13)';
  ctx.shadowBlur  = 16;
  ctx.shadowOffsetX = -5;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();
  ctx.strokeStyle = '#c0c0c0';
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);

  // 6. Panel text (drawn before images so logo/medal overlay correctly)
  var cx = px + pw / 2;

  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 19px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, playerName, cx, py + 174, pw - 32, 24);

  ctx.fillStyle = strip;
  ctx.fillRect(px + 14, py + 208, pw - 28, 2);

  ctx.fillStyle = '#3a4a5c';
  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  var lastY = wrapText(ctx, achLine1, cx, py + 234, pw - 28, 20);

  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 15px Arial, sans-serif';
  wrapText(ctx, achLine2, cx, lastY + 22, pw - 28, 20);

  ctx.fillStyle = '#bbb';
  ctx.font = '10px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('learn.circlechess.com', px + pw - 10, py + ph - 10);

  // 7. Images loaded async; download after all done
  var total  = 3 + (photoDataUri ? 1 : 0);
  var loaded = 0;

  function onDone() {
    if (++loaded < total) return;
    var link = document.createElement('a');
    link.download = playerName.replace(/[^a-zA-Z0-9]/g, '_') + '_poster.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    closeModal();
  }

  var logoImg = new Image();
  logoImg.onload = function() {
    ctx.drawImage(logoImg, px + pw - 168, py + 8, 155, 82);
    onDone();
  };
  logoImg.onerror = onDone;
  logoImg.src = LOGO_B64;

  var medalImg = new Image();
  medalImg.onload = function() {
    ctx.drawImage(medalImg, -40, 20, 210, 210);
    onDone();
  };
  medalImg.onerror = onDone;
  medalImg.src = MEDAL_B64;

  var chessImg = new Image();
  chessImg.onload = function() {
    ctx.drawImage(chessImg, W - 255, H - 248, 280, 280);
    onDone();
  };
  chessImg.onerror = onDone;
  chessImg.src = CHESS_B64;

  if (photoDataUri) {
    var photoImg = new Image();
    photoImg.onload = function() {
      var cx2 = sx + sw / 2, cy2 = sy + sh - 112, cr = 88;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(photoImg, cx2 - cr, cy2 - cr, cr * 2, cr * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
      ctx.strokeStyle = strip;
      ctx.lineWidth = 4;
      ctx.stroke();
      onDone();
    };
    photoImg.onerror = onDone;
    photoImg.src = photoDataUri;
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(function(el, i) {
    el.classList.toggle('active', (i===0) === (tab==='all'));
  });
  document.getElementById('panel-all').classList.toggle('active', tab==='all');
  document.getElementById('panel-achievers').classList.toggle('active', tab==='achievers');
}
</script>
</body>
</html>`;

fs.writeFileSync('E:/csoc_achievements/index.html', html);
console.log('Built index.html');
console.log('File size:', (fs.statSync('E:/csoc_achievements/index.html').size / 1024).toFixed(1) + ' KB');

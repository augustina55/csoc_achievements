const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

// ── 1. Fix broken sc BG/ST/RT variable line ──────────────────────────────────
const BAD_SC = `    "var BG=\\""+bg+"\\"",
    "+\\",ST=\\""+strip+"\\"",
    "+\\",RT="+(ratingPoints!==null?("\\""+ratingPoints+"\\""):"null")
      +",SW="+JSON.stringify(stripWords)+",SL="+(stripLabel?("\\""+stripLabel+"\\""):"null")+";",`;

const GOOD_SC = `    "var BG=\\""+bg+"\\""+",ST=\\""+strip+"\\""+",RT="+(ratingPoints!==null?("\\""+ratingPoints+"\\""):"null")+",SW="+JSON.stringify(stripWords)+",SL="+(stripLabel?("\\""+stripLabel+"\\""):"null")+";",`;

if (h.includes(BAD_SC)) {
  h = h.replace(BAD_SC, GOOD_SC);
  console.log('Fixed sc BG/ST line');
} else {
  console.log('WARNING: sc BG/ST pattern not found - checking alt');
  // Try to find and fix manually
  const fnStart = h.indexOf('function buildPosterHtml');
  const scStart = h.indexOf('var sc = [', fnStart);
  console.log('sc at:', scStart);
  console.log(JSON.stringify(h.slice(scStart, scStart+200)));
}

// ── 2. Got Rating: replace FIDE ID header with Mobile ────────────────────────
h = h.replace(
  '<th>#</th><th>Player</th><th>Status</th><th>FIDE ID</th>\n          <th>Classical</th><th>Rapid</th><th>Blitz</th><th>Period</th><th></th>',
  '<th>#</th><th>Player</th><th>Mobile</th><th>Status</th>\n          <th>Classical</th><th>Rapid</th><th>Blitz</th><th>Period</th><th></th>'
);

// Got Rating row: replace fide_id cell with mobile_number, remove FIDE ID cell
h = h.replace(
  `'<td style="font-weight:600">'+(p.cr_name||p.player_name)+'</td>' +\n      '<td style="color:var(--text2)">'+(p.mobile_number||'—')+'</td>' +\n      '<td>'+statusLabel(p.status)+'</td>' +\n      '<td style="color:var(--text2)">'+(p.fide_id||'—')+'</td>' +`,
  `'<td style="font-weight:600">'+(p.cr_name||p.player_name)+'</td>' +\n      '<td style="color:var(--text2)">'+(p.mobile_number||'—')+'</td>' +\n      '<td>'+statusLabel(p.status)+'</td>' +`
);

// Fix colspan for no-results rows in got rating
h = h.replace(
  'colspan="9" style="text-align:center;color:#aaa;padding:28px">No data in sheet for',
  'colspan="8" style="text-align:center;color:#aaa;padding:28px">No data in sheet for'
);

// ── 3. Achievers: replace Date column with Mobile ────────────────────────────
h = h.replace(
  '<th>#</th><th>Player</th><th>Status</th><th>Tournament</th><th>Date</th>\n          <th>Rank</th><th>Rating ±</th><th></th>',
  '<th>#</th><th>Player</th><th>Mobile</th><th>Status</th><th>Tournament</th>\n          <th>Rank</th><th>Rating ±</th><th></th>'
);

// Achievers row: remove Date cell, add Mobile after player name
h = h.replace(
  `'<td style="font-weight:600;white-space:nowrap">'+(r.player_name||'')+'</td>' +\n      '<td>'+statusLabel(r.status)+'</td>' +\n      '<td><a href="'+(r.tournament_link||'#')+'" target="_blank" style="color:var(--text);text-decoration:none" title="'+(r.tournament_name||'')+'">'+tn+'</a>'+ratedTag+'</td>' +\n      '<td style="white-space:nowrap;color:var(--text2)">'+fmtDate(r.date||'')+'</td>' +`,
  `'<td style="font-weight:600;white-space:nowrap">'+(r.player_name||'')+'</td>' +\n      '<td style="color:var(--text2)">'+(r.mobile_number||'—')+'</td>' +\n      '<td>'+statusLabel(r.status)+'</td>' +\n      '<td><a href="'+(r.tournament_link||'#')+'" target="_blank" style="color:var(--text);text-decoration:none" title="'+(r.tournament_name||'')+'">'+tn+'</a>'+ratedTag+'</td>' +`
);

fs.writeFileSync('index.html', h, 'utf8');
console.log('Done.');

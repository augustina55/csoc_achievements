const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

// 1. Add Mobile column header to Got Rating table
h = h.replace(
  '<th>#</th><th>Player</th><th>Status</th><th>FIDE ID</th>\n          <th>Classical</th><th>Rapid</th><th>Blitz</th><th>Period</th><th></th>',
  '<th>#</th><th>Player</th><th>Mobile</th><th>Status</th><th>FIDE ID</th>\n          <th>Classical</th><th>Rapid</th><th>Blitz</th><th>Period</th><th></th>'
);

// 2. Fix colspan in No data row
h = h.replace(
  'colspan="8" style="text-align:center;color:#aaa;padding:28px">No data in sheet for',
  'colspan="9" style="text-align:center;color:#aaa;padding:28px">No data in sheet for'
);
h = h.replace(
  'colspan="8" style="text-align:center;color:#aaa;padding:28px">No results.</td>',
  'colspan="9" style="text-align:center;color:#aaa;padding:28px">No results.</td>'
);

// 3. Add mobile cell in row builder
h = h.replace(
  "'<td style=\"font-weight:600\">'+(p.cr_name||p.player_name)+'</td>' +\n      '<td>'+statusLabel(p.status)+'</td>' +\n      '<td style=\"color:var(--text2)\">'+(p.fide_id||'—')+'</td>' +",
  "'<td style=\"font-weight:600\">'+(p.cr_name||p.player_name)+'</td>' +\n      '<td style=\"color:var(--text2)\">'+(p.mobile_number||'—')+'</td>' +\n      '<td>'+statusLabel(p.status)+'</td>' +\n      '<td style=\"color:var(--text2)\">'+(p.fide_id||'—')+'</td>' +"
);

fs.writeFileSync('index.html', h, 'utf8');
console.log('Done.');

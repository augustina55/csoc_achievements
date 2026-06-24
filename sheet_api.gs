/**
 * sheet_api.gs — CSOC Achievements Google Sheets API
 *
 * HOW TO DEPLOY:
 *   1. Open your GAS project (same one as fide_rating.gs)
 *   2. Add this as a new script file
 *   3. Click Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 *   4. Copy the Web App URL and paste it into build_html.js as GAS_URL
 *   5. Rebuild: node build_html.js
 *
 * Sheets required in the spreadsheet:
 *   "Got Rating"   — stores Got Rating records
 *   "Achivements"  — stores Achievement records (note: matches existing sheet name)
 */

var SS_ID = '1oXqceUMlEYF9mpHyBteh8lD-gb69EsYIvNqOune31mI';

// ── Got Rating headers ──────────────────────────────────────────────────────
var GOT_HEADERS  = ['Player Name','FIDE ID','Status','Period','Classical','Rapid','Blitz','Saved At'];

// ── Achievements headers ────────────────────────────────────────────────────
// Columns: Player Name | FIDE ID | Tournament | Rank | Rating ± | Rated | Date | Saved At
var ACH_HEADERS  = ['Player Name','FIDE ID','Tournament','Rank','Rating ±','Rated','Date','Saved At'];

// ── doGet ───────────────────────────────────────────────────────────────────
function doGet(e) {
  var p = e.parameter;
  var result;
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var action = p.action;

    if (action === 'read_got_rating') {
      // Returns rows matching a specific month (Period column = index 3)
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var all = sh.getDataRange().getValues();
      var month = p.month || '';
      // Skip header row; filter by period
      var rows = all.slice(1).filter(function(r){ return !month || String(r[3]) === month; });
      result = { ok: true, rows: rows };

    } else if (action === 'write_got_rating') {
      // rows: [[name, fide_id, status, period, std, rap, bli], ...]
      var rows = JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var added = appendDedup(sh, rows, [1, 3]); // dedup on fide_id + period
      result = { ok: true, added: added, skipped: rows.length - added };

    } else if (action === 'read_achievements') {
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var all = sh.getDataRange().getValues();
      result = { ok: true, rows: all.slice(1) };

    } else if (action === 'write_achievements') {
      // rows: [[name, fide_id, tournament, rank, rating_change, rated, date], ...]
      var rows = JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var added = appendDedup(sh, rows, [1, 2]); // dedup on fide_id (col1) + tournament (col2)
      result = { ok: true, added: added, skipped: rows.length - added };

    } else {
      result = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getOrCreateSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }
  return sh;
}

/**
 * Appends rows that aren't already present, deduplicating on the given column indices.
 * Returns the count of newly added rows.
 */
function appendDedup(sh, newRows, keyColIndices) {
  var existing = sh.getDataRange().getValues();
  var seen = new Set();
  // Build set of existing keys from data rows (skip header)
  for (var i = 1; i < existing.length; i++) {
    seen.add(makeKey(existing[i], keyColIndices));
  }
  var added = 0;
  var now = new Date();
  newRows.forEach(function(row) {
    var key = makeKey(row, keyColIndices);
    if (!seen.has(key)) {
      sh.appendRow(row.concat([now])); // append Saved At timestamp
      seen.add(key);
      added++;
    }
  });
  return added;
}

function makeKey(row, colIndices) {
  return colIndices.map(function(i){ return String(row[i]||'').trim().toLowerCase(); }).join('|');
}

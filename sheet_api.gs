/**
 * sheet_api.gs — CSOC Achievements Google Sheets API
 *
 * HOW TO DEPLOY:
 *   1. Open your GAS project
 *   2. Replace the contents of sheet_api.gs with this file
 *   3. Run setupDailySync() once to create the 1pm daily trigger
 *   4. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone)
 *   5. Copy the Web App URL → paste as GAS_URL in build_html.js
 *
 * Sheets required (auto-created if missing):
 *   "Players"       — master player list (synced daily from circlechess explorer)
 *   "Got Rating"    — monthly FIDE first-rating records
 *   "Achivements"   — achievement records (note: matches existing sheet name)
 */

var SS_ID = '1oXqceUMlEYF9mpHyBteh8lD-gb69EsYIvNqOune31mI';
var EXPLORER_URL = 'https://explorer.circlechess.com/1171/';

// ── Sheet headers ────────────────────────────────────────────────────────────
var PLAYERS_HEADERS = ['Player Name','FIDE ID','Mobile','Subscription Start','Subscription End','Status','Updated At'];
var GOT_HEADERS     = ['Player Name','FIDE ID','Status','Subscription End','Period','Classical','Rapid','Blitz','Saved At'];
var STATUS_LABELS   = {1:'Active', 2:'Expired', 3:'Upcoming', 5:'Pause'};
var ACH_HEADERS     = ['Player Name','FIDE ID','Tournament','Rank','Rating ±','Rated','Date','Saved At'];

// ── doPost — handles write operations sent as JSON body ───────────────────────
function doPost(e) {
  var body = {};
  try {
    var raw = e.postData ? e.postData.contents : '';
    body = JSON.parse(raw);
  } catch(_) {}
  var p = Object.assign({}, e.parameter, body);
  return _handle(p);
}

// ── doGet ────────────────────────────────────────────────────────────────────
function doGet(e) {
  var p = e.parameter;
  return _handle(p);
}

function _handle(p) {
  var result;
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var action = p.action;

    if (action === 'read_players') {
      var sh = getOrCreateSheet(ss, 'Players', PLAYERS_HEADERS);
      var all = sh.getDataRange().getValues();
      if (all.length < 2) { result = { ok: true, rows: [], count: 0 }; }
      else {
        // Detect columns by header name (case-insensitive) so sheet column order doesn't matter
        var hdrs = all[0].map(function(h){ return String(h).toLowerCase().trim(); });
        var ci = {
          name:  colIdx(hdrs, ['player name','player_name','name','player']),
          fide:  colIdx(hdrs, ['fide id','fide_id','fideid','fide']),
          mob:   colIdx(hdrs, ['mobile','mobile number','mobile_number','phone']),
          start: colIdx(hdrs, ['subscription start','subscription_start_date','start date','sub start','start']),
          end:   colIdx(hdrs, ['subscription end','subscription_end_date','end date','sub end','end']),
          stat:  colIdx(hdrs, ['status'])
        };
        var rows = all.slice(1).map(function(r) {
          return [
            ci.name  >= 0 ? r[ci.name]  : '',
            ci.fide  >= 0 ? r[ci.fide]  : '',
            ci.mob   >= 0 ? r[ci.mob]   : '',
            ci.start >= 0 ? r[ci.start] : '',
            ci.end   >= 0 ? r[ci.end]   : '',
            ci.stat  >= 0 ? r[ci.stat]  : 1
          ];
        }).filter(function(r){ return r[1]; }); // must have fide_id
        result = { ok: true, rows: rows, count: rows.length, headers: all[0] };
      }

    } else if (action === 'write_players') {
      var rows = Array.isArray(p.rows) ? p.rows : JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Players', PLAYERS_HEADERS);
      var counts = upsertPlayers(sh, rows);
      result = { ok: true, added: counts.added, updated: counts.updated };

    } else if (action === 'read_got_rating') {
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var all = sh.getDataRange().getValues();
      var month = p.month || '';
      var rows = all.slice(1).filter(function(r){ return !month || String(r[4]) === month; });
      result = { ok: true, rows: rows };

    } else if (action === 'read_all_got_rating') {
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var all = sh.getDataRange().getValues();
      result = { ok: true, rows: all.slice(1) };

    } else if (action === 'write_got_rating') {
      var rows = Array.isArray(p.rows) ? p.rows : JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var added = appendDedup(sh, rows, [1, 4]); // dedup on fide_id + period
      result = { ok: true, added: added, skipped: rows.length - added };

    } else if (action === 'read_achievements') {
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var all = sh.getDataRange().getValues();
      result = { ok: true, rows: all.slice(1) };

    } else if (action === 'write_achievements') {
      var rows = Array.isArray(p.rows) ? p.rows : JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var added = appendDedup(sh, rows, [1, 2]); // dedup on fide_id + tournament
      result = { ok: true, added: added, skipped: rows.length - added };

    } else if (action === 'fide_history') {
      // CORS proxy: fetch FIDE rating history server-side and return to browser
      var fideId = String(p.fide_id || '').trim();
      if (!fideId) {
        result = { ok: false, error: 'Missing fide_id' };
      } else {
        var apiUrl = 'https://api.chesstools.org/fide/player_history/?fide_id=' + encodeURIComponent(fideId);
        var apiResp = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
        if (apiResp.getResponseCode() === 200) {
          result = { ok: true, data: JSON.parse(apiResp.getContentText()) };
        } else {
          result = { ok: false, error: 'chesstools API ' + apiResp.getResponseCode() };
        }
      }

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

// ── Daily sync from circlechess.com/1171 ─────────────────────────────────────
function syncPlayersFromExplorer() {
  Logger.log('=== syncPlayersFromExplorer START ===');
  try {
    var resp = UrlFetchApp.fetch(EXPLORER_URL, {
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/json, text/html' }
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('HTTP error: ' + resp.getResponseCode());
      return;
    }

    var text = resp.getContentText();
    var players = [];

    // Try JSON first
    try {
      var parsed = JSON.parse(text);
      var arr = Array.isArray(parsed) ? parsed : (parsed.data || parsed.players || parsed.results || []);
      players = arr.map(function(p) {
        return [
          p.player_name || p.name || p.Name || '',
          p.fide_id    || p.fideId || p.fide || '',
          p.mobile_number || p.mobile || p.phone || '',
          p.subscription_start_date || p.start_date || p.startDate || '',
          p.subscription_end_date   || p.end_date   || p.endDate   || '',
          p.status !== undefined ? p.status : 1
        ];
      }).filter(function(r){ return r[0] || r[1]; });

    } catch (_) {
      // Parse HTML table
      var rows = text.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      var isFirst = true;
      rows.forEach(function(row) {
        if (isFirst) { isFirst = false; return; } // skip header row
        var cells = [];
        var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi, m;
        while ((m = tdRe.exec(row)) !== null) {
          cells.push(m[1].replace(/<[^>]+>/g, '').trim());
        }
        // Expected columns: Name, FIDE ID, Mobile, Sub Start, Sub End, Status
        if (cells.length >= 2 && (cells[0] || cells[1])) {
          players.push([
            cells[0] || '',  // name
            cells[1] || '',  // fide_id
            cells[2] || '',  // mobile
            cells[3] || '',  // sub start
            cells[4] || '',  // sub end
            cells[5] || 1    // status
          ]);
        }
      });
    }

    if (players.length === 0) {
      Logger.log('No players parsed from ' + EXPLORER_URL);
      return;
    }

    var ss = SpreadsheetApp.openById(SS_ID);
    var sh = getOrCreateSheet(ss, 'Players', PLAYERS_HEADERS);
    var counts = upsertPlayers(sh, players);
    Logger.log('Synced ' + players.length + ' players: ' + counts.added + ' added, ' + counts.updated + ' updated');

  } catch (e) {
    Logger.log('syncPlayersFromExplorer error: ' + e.toString());
  }
  Logger.log('=== syncPlayersFromExplorer END ===');
}

// ── Setup daily 1pm trigger — run this ONCE manually ─────────────────────────
function setupDailySync() {
  // Remove any existing triggers for syncPlayersFromExplorer
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncPlayersFromExplorer') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncPlayersFromExplorer')
    .timeBased()
    .everyDays(1)
    .atHour(13) // 1pm (script timezone)
    .create();
  Logger.log('Daily sync trigger created at 1pm');
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
 * Upsert players by FIDE ID (column index 1). Adds new rows, updates existing.
 */
function upsertPlayers(sh, newRows) {
  var existing = sh.getDataRange().getValues();
  var fideToRowNum = {}; // fide_id → 1-based sheet row number
  for (var i = 1; i < existing.length; i++) {
    var fid = String(existing[i][1]).trim();
    if (fid) fideToRowNum[fid] = i + 1;
  }
  var added = 0, updated = 0;
  var now = new Date();
  newRows.forEach(function(row) {
    var fid = String(row[1]).trim();
    if (!fid) return;
    var withTs = row.slice(0, 6).concat([now]); // ensure 7 columns
    if (fideToRowNum[fid]) {
      sh.getRange(fideToRowNum[fid], 1, 1, withTs.length).setValues([withTs]);
      updated++;
    } else {
      sh.appendRow(withTs);
      fideToRowNum[fid] = sh.getLastRow();
      added++;
    }
  });
  return { added: added, updated: updated };
}

/**
 * Appends rows that aren't already present, deduplicating on the given column indices.
 */
function appendDedup(sh, newRows, keyColIndices) {
  var existing = sh.getDataRange().getValues();
  var seen = new Set();
  for (var i = 1; i < existing.length; i++) {
    seen.add(makeKey(existing[i], keyColIndices));
  }
  var added = 0;
  var now = new Date();
  newRows.forEach(function(row) {
    var key = makeKey(row, keyColIndices);
    if (!seen.has(key)) {
      sh.appendRow(row.concat([now]));
      seen.add(key);
      added++;
    }
  });
  return added;
}

function makeKey(row, colIndices) {
  return colIndices.map(function(i){ return String(row[i]||'').trim().toLowerCase(); }).join('|');
}

// Find first header index matching any of the candidate names
function colIdx(hdrs, candidates) {
  for (var i = 0; i < hdrs.length; i++) {
    for (var j = 0; j < candidates.length; j++) {
      if (hdrs[i] === candidates[j]) return i;
    }
  }
  return -1;
}

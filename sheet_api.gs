/**
 * sheet_api.gs — CSOC Achievements Google Sheets API
 *
 * HOW TO DEPLOY:
 *   1. Open your GAS project
 *   2. Replace the contents of sheet_api.gs with this file
 *   3. Project Settings → Script properties: add EXPLORER_USER and EXPLORER_PASS
 *      (explorer.circlechess.com login); set Time zone to Asia/Kolkata
 *   4. Run setupDailySync() once → daily triggers: players sync 5pm, achievements check 9pm
 *   5. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone)
 *   6. Copy the Web App URL → paste as GAS_URL in build_html.js
 *
 * Sheets required (auto-created if missing):
 *   "Players"       — master player list (synced daily from circlechess explorer)
 *   "Got Rating"    — monthly FIDE first-rating records
 *   "Achivements"   — achievement records (note: matches existing sheet name)
 */

var SS_ID = '1oXqceUMlEYF9mpHyBteh8lD-gb69EsYIvNqOune31mI';
var EXPLORER_BASE     = 'https://explorer.circlechess.com';
var EXPLORER_QUERY_ID = 1171; // full player list incl. expired: mobile_number, player_name, fide_id, subscription dates, status
var CR_API_URL        = 'https://csoc-achievements.vercel.app/api/chess-results';
var ACH_LOOKBACK_DAYS = 3;    // check tournaments that ended in the last N days
var ACH_BATCH         = 10;   // parallel API calls per batch
var ACH_MAIL_TO       = 'augustin@circlechess.com';
var ACH_MAIL_MAX_RANK = 5;    // mail when final rank <= this ...
var ACH_MAIL_MIN_GAIN = 20;   // ... and rating change > this

// ── Sheet headers ────────────────────────────────────────────────────────────
var PLAYERS_HEADERS = ['Player Name','FIDE ID','Mobile','Subscription Start','Subscription End','Status','Updated At'];
var GOT_HEADERS     = ['Player Name','FIDE ID','Status','Subscription End','Period','Classical','Rapid','Blitz','Mobile','Saved At'];
var STATUS_LABELS   = {1:'Active', 2:'Expired', 3:'Upcoming', 5:'Pause'};
var ACH_HEADERS     = ['Player Name','FIDE ID','Tournament','Rank','Rating ±','Rated','Date','Tournament Link','Mobile','Saved At'];
var CONSENT_HEADERS = ['Player Name','Mobile','FIDE ID','Consent'];

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

// ── Script cache for read actions ────────────────────────────────────────────
// Each data group has a generation id; cache keys include it, so a write just
// bumps the generation and every cached read of that group becomes unreachable.
var READ_CACHE_TTL = 600; // seconds
var READ_GROUPS = {
  read_players: 'players', read_consent: 'consent',
  read_got_rating: 'got', read_all_got_rating: 'got',
  read_achievements: 'ach'
};

function cacheGen_(group) {
  var c = CacheService.getScriptCache(), g = c.get('gen_' + group);
  if (!g) { g = String(Date.now()); c.put('gen_' + group, g, 21600); }
  return g;
}

function invalidateCache_(group) {
  try { CacheService.getScriptCache().put('gen_' + group, Date.now() + '_' + Math.random(), 21600); } catch (_) {}
}

// Values over ~95 KB are split into chunks (cache limit is 100 KB per value)
var CACHE_CHUNK = 25000; // chars; stays under 100 KB even for multi-byte text
function cacheGetStr_(key) {
  var c = CacheService.getScriptCache();
  var hit = c.get(key);
  if (hit !== null) return hit;
  var n = Number(c.get(key + '_n') || 0);
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var parts = c.getAll(keys), out = '';
  for (var j = 0; j < n; j++) { if (parts[keys[j]] === undefined) return null; out += parts[keys[j]]; }
  return out;
}

function cachePutStr_(key, s, ttl) {
  var c = CacheService.getScriptCache();
  try {
    if (s.length < CACHE_CHUNK) { c.put(key, s, ttl); return; }
    var chunks = {}, n = Math.ceil(s.length / CACHE_CHUNK);
    if (n > 30) return; // too big to be worth caching
    for (var i = 0; i < n; i++) chunks[key + '_' + i] = s.substr(i * CACHE_CHUNK, CACHE_CHUNK);
    c.putAll(chunks, ttl);
    c.put(key + '_n', String(n), ttl);
  } catch (_) {} // caching is best-effort
}

function cachedJson_(key, ttlSec, build) {
  var hit = cacheGetStr_(key);
  if (hit !== null) return hit;
  var result = build();
  var s = JSON.stringify(result);
  if (result && result.ok) cachePutStr_(key, s, ttlSec);
  return s;
}

function jsonOut_(str) {
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}

function _handle(p) {
  var action = p.action;
  var group = READ_GROUPS[action];
  if (group) {
    // Cached reads: no spreadsheet access at all on a cache hit
    try {
      var key = action + '_' + (p.month || 'All') + '_' + cacheGen_(group);
      return jsonOut_(cachedJson_(key, READ_CACHE_TTL, function() { return _handleUncached(p); }));
    } catch (err) {
      return jsonOut_(JSON.stringify({ ok: false, error: err.toString() }));
    }
  }
  return jsonOut_(JSON.stringify(_handleUncached(p)));
}

function _handleUncached(p) {
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
      invalidateCache_('players');
      result = { ok: true, added: counts.added, updated: counts.updated };

    } else if (action === 'read_got_rating') {
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var all = sh.getDataRange().getValues();
      var hdrs = all[0].map(function(h){ return String(h).toLowerCase().trim(); });
      var mobCol = colIdx(hdrs, ['mobile','mobile number','mobile_number']);
      var month = p.month || '';
      var rows = all.slice(1).filter(function(r){ return !month || normalizePeriod(r[4]) === month; });
      rows = rows.map(function(r){
        var nr = r.slice(0, 8); // Name,FIDE,Status,SubEnd,Period,Classical,Rapid,Blitz
        nr[4] = normalizePeriod(r[4]);
        nr[8] = mobCol >= 0 ? String(r[mobCol] || '') : '';
        return nr;
      });
      result = { ok: true, rows: rows };

    } else if (action === 'read_all_got_rating') {
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var all = sh.getDataRange().getValues();
      var hdrs = all[0].map(function(h){ return String(h).toLowerCase().trim(); });
      var mobCol = colIdx(hdrs, ['mobile','mobile number','mobile_number']);
      var rows = all.slice(1).map(function(r){
        var nr = r.slice(0, 8);
        nr[4] = normalizePeriod(r[4]);
        nr[8] = mobCol >= 0 ? String(r[mobCol] || '') : '';
        return nr;
      });
      result = { ok: true, rows: rows };

    } else if (action === 'write_got_rating') {
      var rows = Array.isArray(p.rows) ? p.rows : JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Got Rating', GOT_HEADERS);
      var added = appendDedup(sh, rows, [1, 4]); // dedup on fide_id + period
      invalidateCache_('got');
      result = { ok: true, added: added, skipped: rows.length - added };

    } else if (action === 'read_achievements') {
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var all = sh.getDataRange().getValues();
      var hdrsA = all[0].map(function(h){ return String(h).toLowerCase().trim(); });
      var mobColA = colIdx(hdrsA, ['mobile','mobile number','mobile_number']);
      var tlColA  = colIdx(hdrsA, ['tournament link','tournament_link']);
      var month = p.month || '';
      var rows = all.slice(1);
      if (month) {
        var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        rows = rows.filter(function(r) {
          var d = String(r[6] || '');
          var parts = d.match(/(\d{4})[\/-](\d{2})/);
          if (!parts) {
            if (r[6] instanceof Date) {
              return r[6].getFullYear() + '-' + mn[r[6].getMonth()] === month;
            }
            return false;
          }
          return parts[1] + '-' + (mn[parseInt(parts[2])-1] || parts[2]) === month;
        });
      }
      // Normalize: always return mobile at [8], tournament_link at [7]
      rows = rows.map(function(r) {
        var nr = r.slice(0, 7); // Name,FIDE,Tournament,Rank,Rating±,Rated,Date
        nr[7] = tlColA  >= 0 ? String(r[tlColA]  || '') : '';
        nr[8] = mobColA >= 0 ? String(r[mobColA] || '') : '';
        return nr;
      });
      result = { ok: true, rows: rows };

    } else if (action === 'write_achievements') {
      var rows = Array.isArray(p.rows) ? p.rows : JSON.parse(p.rows || '[]');
      var sh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
      var added = appendDedup(sh, rows, [1, 2]); // dedup on fide_id + tournament
      invalidateCache_('ach');
      result = { ok: true, added: added, skipped: rows.length - added };

    } else if (action === 'read_consent') {
      var sh = getOrCreateSheet(ss, 'Consent', CONSENT_HEADERS);
      var all = sh.getDataRange().getValues();
      var rows = all.length < 2 ? [] : all.slice(1);
      result = { ok: true, rows: rows };

    } else if (action === 'write_consent') {
      var fideId  = String(p.fide_id  || '').trim();
      var name    = String(p.name     || '').trim();
      var mobile  = String(p.mobile   || '').trim();
      var consent = String(p.consent  || 'No').trim();
      if (!fideId) { result = { ok: false, error: 'Missing fide_id' }; }
      else {
        var sh = getOrCreateSheet(ss, 'Consent', CONSENT_HEADERS);
        var all = sh.getDataRange().getValues();
        var rowNum = -1;
        for (var i = 1; i < all.length; i++) {
          if (String(all[i][2]).trim() === fideId) { rowNum = i + 1; break; }
        }
        if (rowNum > 0) {
          sh.getRange(rowNum, 1, 1, 4).setValues([[name, mobile, fideId, consent]]);
        } else {
          sh.appendRow([name, mobile, fideId, consent]);
        }
        invalidateCache_('consent');
        result = { ok: true };
      }

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
  return result;
}

// ── Daily 5pm: sync Players sheet from explorer query 1171 ──────────────────
// Needs Script Properties EXPLORER_USER and EXPLORER_PASS
// (Project Settings → Script properties). The explorer requires a login.
function syncPlayersFromExplorer() {
  Logger.log('=== syncPlayersFromExplorer START ===');
  try {
    var props = PropertiesService.getScriptProperties();
    var user = props.getProperty('EXPLORER_USER'), pass = props.getProperty('EXPLORER_PASS');
    if (!user || !pass) throw new Error('Set EXPLORER_USER and EXPLORER_PASS in Script Properties');

    var cookies = explorerLogin(user, pass);
    var resp = UrlFetchApp.fetch(EXPLORER_BASE + '/' + EXPLORER_QUERY_ID + '/download', {
      muteHttpExceptions: true, followRedirects: false,
      headers: { 'Cookie': cookies.join('; ') }
    });
    if (resp.getResponseCode() !== 200) throw new Error('Query download HTTP ' + resp.getResponseCode());
    var text = resp.getContentText();
    if (/<html/i.test(text.slice(0, 500))) throw new Error('Got HTML instead of CSV — login probably failed');

    var csv = Utilities.parseCsv(text);
    var hdrs = csv[0].map(function(h){ return String(h).toLowerCase().trim(); });
    var ci = {
      name:  colIdx(hdrs, ['player_name']),
      fide:  colIdx(hdrs, ['fide_id']),
      mob:   colIdx(hdrs, ['mobile_number']),
      start: colIdx(hdrs, ['subscription_start_date']),
      end:   colIdx(hdrs, ['subscription_end_date']),
      stat:  colIdx(hdrs, ['status'])
    };
    if (ci.fide < 0) throw new Error('fide_id column missing in query ' + EXPLORER_QUERY_ID + ': ' + csv[0].join(','));
    var players = csv.slice(1).map(function(r) {
      return [
        ci.name  >= 0 ? r[ci.name]  : '',
        r[ci.fide],
        ci.mob   >= 0 ? r[ci.mob]   : '',
        ci.start >= 0 ? r[ci.start] : '',
        ci.end   >= 0 ? r[ci.end]   : '',
        ci.stat  >= 0 && r[ci.stat] !== '' ? Number(r[ci.stat]) : 1
      ];
    }).filter(function(r){ return String(r[1] || '').trim(); });

    if (players.length === 0) throw new Error('No players in query ' + EXPLORER_QUERY_ID);

    var ss = SpreadsheetApp.openById(SS_ID);
    var sh = getOrCreateSheet(ss, 'Players', PLAYERS_HEADERS);
    var counts = upsertPlayers(sh, players);
    invalidateCache_('players');
    Logger.log('Synced ' + players.length + ' players: ' + counts.added + ' added, ' + counts.updated + ' updated');
  } catch (e) {
    Logger.log('syncPlayersFromExplorer error: ' + e.toString());
    throw e; // show as a failed run in Executions
  }
  Logger.log('=== syncPlayersFromExplorer END ===');
}

// ── One-off: remove rows written into the wrong columns by the first sync ────
// Those rows have the player NAME in the mobile column and a timestamp in the
// last column. Run once from the editor, then run syncPlayersFromExplorer.
function cleanupBadPlayerRows() {
  var sh = SpreadsheetApp.openById(SS_ID).getSheetByName('Players');
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function(h){ return String(h).toLowerCase().trim(); });
  var mobCol = colIdx(hdrs, ['mobile','mobile number','mobile_number','phone']);
  if (mobCol < 0) throw new Error('No mobile column found');
  var bad = [];
  for (var i = 1; i < data.length; i++) {
    var mob = String(data[i][mobCol]).trim();
    if (mob && /[A-Za-z]/.test(mob)) bad.push(i + 1); // a name where a phone number should be
  }
  Logger.log('Bad rows: ' + bad.length + (bad.length ? ' (sheet rows ' + bad[0] + '–' + bad[bad.length - 1] + ')' : ''));
  // delete bottom-up in contiguous blocks
  for (var j = bad.length - 1; j >= 0; ) {
    var end = bad[j], start = end;
    while (j - 1 >= 0 && bad[j - 1] === start - 1) { j--; start--; }
    sh.deleteRows(start, end - start + 1);
    j--;
  }
  // header for the timestamp column the first sync wrote without a header
  var lastCol = sh.getLastColumn();
  var hdrRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < hdrRow.length; c++) {
    if (String(hdrRow[c]).trim() === '') { sh.getRange(1, c + 1).setValue('Updated At'); break; }
  }
  invalidateCache_('players');
  Logger.log('Deleted ' + bad.length + ' rows; Players now has ' + (sh.getLastRow() - 1) + ' rows');
}

// Django login on the explorer → cookie list incl. sessionid
function explorerLogin(user, pass) {
  var r1 = UrlFetchApp.fetch(EXPLORER_BASE + '/', { muteHttpExceptions: true, followRedirects: false });
  var cookies = mergeCookieList([], readSetCookies(r1));
  var csrf = (r1.getContentText().match(/csrfmiddlewaretoken[^>]*value=["']([^"']+)/) || [])[1] || '';
  var r2 = UrlFetchApp.fetch(EXPLORER_BASE + '/', {
    method: 'post', muteHttpExceptions: true, followRedirects: false,
    headers: { 'Cookie': cookies.join('; '), 'Referer': EXPLORER_BASE + '/' },
    payload: { username: user, password: pass, csrfmiddlewaretoken: csrf, next: '/' }
  });
  cookies = mergeCookieList(cookies, readSetCookies(r2));
  if (!cookies.some(function(c){ return c.indexOf('sessionid=') === 0; })) {
    throw new Error('Explorer login failed (HTTP ' + r2.getResponseCode() + ')');
  }
  return cookies;
}

function readSetCookies(resp) {
  var h = resp.getAllHeaders()['Set-Cookie'];
  if (!h) return [];
  return (Array.isArray(h) ? h : [h]).map(function(c){ return String(c).split(';')[0].trim(); });
}

function mergeCookieList(a, b) {
  var m = {};
  a.concat(b).forEach(function(c){ var k = c.split('=')[0]; if (k) m[k] = c; });
  return Object.keys(m).map(function(k){ return m[k]; });
}

// ── Daily 9pm: achievements for tournaments that ended in the last 3 days ────
// Only finished tournaments (end date before today). Skips anything already in
// the Achivements sheet, saves new rows, mails rank <= 5 with rating + > 20.
function checkRecentAchievements() {
  Logger.log('=== checkRecentAchievements START ===');
  var tz = Session.getScriptTimeZone();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var fromD = new Date(today); fromD.setDate(fromD.getDate() - ACH_LOOKBACK_DAYS);
  var toD   = new Date(today); toD.setDate(toD.getDate() - 1); // ended yesterday or earlier = over
  var fmtCR = function(d){ return Utilities.formatDate(d, tz, 'dd.MM.yyyy'); };

  var ss = SpreadsheetApp.openById(SS_ID);

  // Eligible players (same rules as the web page's Fetch from API)
  var pAll = getOrCreateSheet(ss, 'Players', PLAYERS_HEADERS).getDataRange().getValues();
  var ph = pAll[0].map(function(h){ return String(h).toLowerCase().trim(); });
  var pc = {
    name:  colIdx(ph, ['player name','player_name','name','player']),
    fide:  colIdx(ph, ['fide id','fide_id','fideid','fide']),
    mob:   colIdx(ph, ['mobile','mobile number','mobile_number','phone']),
    start: colIdx(ph, ['subscription start','subscription_start_date','start date','sub start','start']),
    end:   colIdx(ph, ['subscription end','subscription_end_date','end date','sub end','end']),
    stat:  colIdx(ph, ['status'])
  };
  var players = pAll.slice(1).map(function(r) {
    return {
      name:    pc.name >= 0 ? String(r[pc.name] || '') : '',
      fide_id: pc.fide >= 0 ? String(r[pc.fide] || '').trim() : '',
      mobile:  pc.mob  >= 0 ? String(r[pc.mob]  || '') : '',
      start:   pc.start >= 0 ? r[pc.start] : '',
      end:     pc.end   >= 0 ? r[pc.end]   : '',
      status:  pc.stat  >= 0 ? Number(r[pc.stat]) : 1
    };
  }).filter(function(p) {
    if (!p.fide_id) return false;
    if (p.status === 5) return true;
    if (p.status === 1) return !p.start || new Date(p.start) <= today;
    if (p.status === 2) return !!(p.start && p.end && new Date(p.start) <= today && new Date(p.end) >= fromD);
    return false;
  });

  // Already-fetched results, keyed like write_achievements (fide_id | tournament)
  var achSh = getOrCreateSheet(ss, 'Achivements', ACH_HEADERS);
  var seen = {};
  achSh.getDataRange().getValues().slice(1).forEach(function(r){ seen[makeKey(r, [1, 2])] = true; });

  var newRows = [], toMail = [], errors = 0;
  for (var i = 0; i < players.length; i += ACH_BATCH) {
    var batch = players.slice(i, i + ACH_BATCH);
    var resps = UrlFetchApp.fetchAll(batch.map(function(p) {
      return {
        url: CR_API_URL + '?fide_id=' + encodeURIComponent(p.fide_id) +
             '&from_date=' + encodeURIComponent(fmtCR(fromD)) + '&to_date=' + encodeURIComponent(fmtCR(toD)),
        muteHttpExceptions: true
      };
    }));
    resps.forEach(function(resp, j) {
      var p = batch[j], d = null;
      try { d = JSON.parse(resp.getContentText()); } catch (_) {}
      if (!d || !d.ok) { errors++; return; }
      (d.tournaments || []).forEach(function(t) {
        var endD = parseCrDate(t.date);
        if (!endD || endD >= today || endD < fromD) return; // not finished yet / outside window
        var hasRc = t.rating_change !== null && t.rating_change !== undefined && t.rating_change !== '';
        var row = [t.player_name_cr || p.name, p.fide_id, t.tournament_name || '',
                   t.rank || '', hasRc ? t.rating_change : '',
                   t.is_rated ? 'RATED' : '', t.date || '', t.tournament_link || '', p.mobile];
        var key = makeKey(row, [1, 2]);
        if (seen[key]) return; // already fetched
        seen[key] = true;
        newRows.push(row);
        if (t.rank && Number(t.rank) <= ACH_MAIL_MAX_RANK && hasRc && Number(t.rating_change) > ACH_MAIL_MIN_GAIN) {
          toMail.push(row);
        }
      });
    });
  }

  var now = new Date();
  if (newRows.length) {
    achSh.getRange(achSh.getLastRow() + 1, 1, newRows.length, newRows[0].length + 1)
      .setValues(newRows.map(function(r){ return r.concat([now]); }));
    invalidateCache_('ach');
  }
  Logger.log('Checked ' + players.length + ' players, ended ' + fmtCR(fromD) + '–' + fmtCR(toD) + ': ' +
             newRows.length + ' new results, ' + toMail.length + ' to mail, ' + errors + ' API errors');

  if (toMail.length) sendAchievementMail(toMail, fmtCR(fromD), fmtCR(toD));
  Logger.log('=== checkRecentAchievements END ===');
}

// chess-results end date "2026/06/20" → Date at local midnight
function parseCrDate(s) {
  var m = String(s || '').match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// rows: [Name, FIDE ID, Tournament, Rank, Rating ±, Rated, End date, Link, Mobile]
function sendAchievementMail(rows, fromTxt, toTxt) {
  var esc = function(s){ return String(s === null || s === undefined ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
  var th = 'style="padding:6px 10px;border:1px solid #ddd;background:#f5f5f5;text-align:left"';
  var td = 'style="padding:6px 10px;border:1px solid #ddd"';
  var html = '<p>' + rows.length + ' new achievement(s) — final rank ≤ ' + ACH_MAIL_MAX_RANK +
    ' and rating + &gt; ' + ACH_MAIL_MIN_GAIN + ' (tournaments ended ' + fromTxt + ' – ' + toTxt + ').</p>' +
    '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px"><tr>' +
    ['Player','FIDE ID','Mobile','Tournament','End date','Rank','Rating ±','Rated'].map(function(h){ return '<th ' + th + '>' + h + '</th>'; }).join('') +
    '</tr>' +
    rows.map(function(r) {
      var tn = r[7] ? '<a href="' + esc(r[7]) + '">' + esc(r[2]) + '</a>' : esc(r[2]);
      return '<tr><td ' + td + '><b>' + esc(r[0]) + '</b></td><td ' + td + '>' + esc(r[1]) + '</td><td ' + td + '>' + esc(r[8]) +
        '</td><td ' + td + '>' + tn + '</td><td ' + td + '>' + esc(r[6]) + '</td><td ' + td + '>#' + esc(r[3]) +
        '</td><td ' + td + '>+' + esc(r[4]) + '</td><td ' + td + '>' + (r[5] ? 'FIDE' : '—') + '</td></tr>';
    }).join('') + '</table>';
  var text = rows.map(function(r) {
    return r[0] + ' (FIDE ' + r[1] + ', ' + r[8] + ') — rank #' + r[3] + ', +' + r[4] + ' — ' + r[2] + ' (ended ' + r[6] + ') ' + r[7];
  }).join('\n');
  MailApp.sendEmail({
    to: ACH_MAIL_TO,
    subject: 'CSOC achievers: ' + rows.length + ' new (' + fromTxt + ' – ' + toTxt + ')',
    body: text,
    htmlBody: html
  });
  Logger.log('Mailed ' + rows.length + ' achievements to ' + ACH_MAIL_TO);
}

// ── Setup daily triggers — run this ONCE manually (re-running replaces them) ─
// Hours use the script time zone (Project Settings → Time zone).
function setupDailySync() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncPlayersFromExplorer' || fn === 'checkRecentAchievements') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncPlayersFromExplorer')
    .timeBased().everyDays(1).atHour(17).nearMinute(0).create(); // 5pm
  ScriptApp.newTrigger('checkRecentAchievements')
    .timeBased().everyDays(1).atHour(21).nearMinute(0).create(); // 9pm
  Logger.log('Daily triggers created: players sync 5pm, achievements check 9pm (' + Session.getScriptTimeZone() + ')');
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
 * Upsert players by FIDE ID. newRows: [name, fide_id, mobile, sub start, sub end, status].
 * Columns are found by header name (sheet column order doesn't matter); missing
 * columns are added. Everything is written back in one batch.
 */
function upsertPlayers(sh, newRows) {
  var data = sh.getDataRange().getValues();
  if (data.length === 0 || (data.length === 1 && data[0].join('') === '')) data = [PLAYERS_HEADERS.slice()];
  var hdrs = data[0].map(function(h){ return String(h).toLowerCase().trim(); });
  var fields = [
    ['player name','player_name','name','player'],
    ['fide id','fide_id','fideid','fide'],
    ['mobile','mobile number','mobile_number','phone'],
    ['subscription start','subscription_start_date','start date','sub start','start'],
    ['subscription end','subscription_end_date','end date','sub end','end'],
    ['status'],
    ['updated at','updated_at']
  ];
  var cols = fields.map(function(cands, k) {
    var c = colIdx(hdrs, cands);
    if (c < 0) { c = data[0].length; data[0].push(PLAYERS_HEADERS[k]); hdrs.push(cands[0]); }
    return c;
  });
  var width = data[0].length;
  data = data.map(function(r){ while (r.length < width) r.push(''); return r; });

  var fideToIdx = {}; // fide_id → index in data
  for (var i = 1; i < data.length; i++) {
    var f = String(data[i][cols[1]]).trim();
    if (f) fideToIdx[f] = i;
  }
  var added = 0, updated = 0, now = new Date();
  newRows.forEach(function(row) {
    var fid = String(row[1]).trim();
    if (!fid) return;
    var idx = fideToIdx[fid];
    if (idx === undefined) {
      var blank = []; for (var c = 0; c < width; c++) blank.push('');
      data.push(blank); idx = data.length - 1; fideToIdx[fid] = idx; added++;
    } else {
      updated++;
    }
    for (var k = 0; k < 6; k++) data[idx][cols[k]] = row[k];
    data[idx][cols[6]] = now;
  });
  sh.getRange(1, 1, data.length, width).setValues(data);
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
  var now = new Date(), toAdd = [];
  newRows.forEach(function(row) {
    var key = makeKey(row, keyColIndices);
    if (!seen.has(key)) {
      toAdd.push(row.concat([now]));
      seen.add(key);
    }
  });
  if (toAdd.length) {
    // one write instead of appendRow per row; pad rows to the same width
    var width = toAdd.reduce(function(w, r){ return Math.max(w, r.length); }, 0);
    toAdd = toAdd.map(function(r){ while (r.length < width) r.push(''); return r; });
    sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, width).setValues(toAdd);
  }
  return toAdd.length;
}

function normalizePeriod(val) {
  if (!val) return '';
  if (val instanceof Date) {
    var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return val.getFullYear() + '-' + mn[val.getMonth()];
  }
  var s = String(val);
  var iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    var mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return iso[1] + '-' + (mn[parseInt(iso[2])-1] || iso[2]);
  }
  return s;
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

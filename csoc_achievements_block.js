// csoc_achievements_block.js — CSOC Achievements (NocoBase JS-block) — LIGHT theme
//
// NocoBase port of index.html (csoc-achievements.vercel.app). Tabs:
//   1. Achievers     — tournament results per month (cc_csoc_achievements);
//                      "Fetch from API" adds finished chess-results tournaments
//   2. Got Rating    — first FIDE ratings per month (cc_csoc_got_rating);
//                      "Fetch from API" checks FIDE history of players active that month
//   3. Rating Stats  — Got Rating counts per month (active vs non-active) + CSV export
//   4. Custom Poster — free-form poster editor
// Posters are drawn on a <canvas> inside the block (live preview) and
// downloaded as PNG — same layout as the site's dlPNG().
//
// Data: NocoBase — CSOC tables (csoc_tables.sql) in the main data source,
// players = cc_users ⋈ cc_csoc_registration (circlechess, status 1). Lookups go to the
// Vercel proxies (api/*.js) and chesstools — cross-origin, so they go through
// extRequest(), which drops the NocoBase auth/role headers (they would leak
// the user's token and force a CORS preflight).
//
// Sandbox rules (see nocobase-jsblocks skill): no document/window/fetch/
// alert/confirm/localStorage; everything renders inside ctx.element; modal is
// position:absolute inside #csa (position:fixed breaks inside NocoBase).

async function getEnvironmentValue(key, fallbackValue = '') {
  try {
    const response = await ctx.api.resource('environmentVariables').get({ filterByTk: key });
    return response && response.data && response.data.data
      ? response.data.data.value || fallbackValue
      : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

// Override with a NocoBase environment variable of the same name.
const PROXY_BASE = await getEnvironmentValue('CSOC_PROXY_URL', 'https://csoc-achievements.vercel.app');

// Collection -> NocoBase data source. Players come from the circlechess DB;
// the CSOC tables (csoc_tables.sql) live in NocoBase's main database.
const TBL = {
  users: 'cc_users',
  reg: 'cc_csoc_registration',
  ach: 'cc_csoc_achievements',
  got: 'cc_csoc_got_rating',
  consent: 'cc_csoc_cx_consent',
};
const TBL_SOURCE = {
  [TBL.users]: 'circlechess',
  [TBL.reg]: 'circlechess',
  [TBL.ach]: 'main',
  [TBL.got]: 'main',
  [TBL.consent]: 'main',
};
function dbHeaders(collection, write) {
  const ds = TBL_SOURCE[collection] || 'main';
  return write ? { 'x-data-source': ds } : { 'x-data-source': ds, 'x-role': '__union__', 'x-with-acl-meta': 'true' };
}
// Poster artwork, served by the Vercel deployment with Access-Control-Allow-Origin: *
// (required so the poster canvas can still be exported).
const ASSET_URLS = {
  logo: PROXY_BASE + '/images/cc_logo.svg',
  medal: PROXY_BASE + '/images/medals.png',
  chess: PROXY_BASE + '/images/chess_pieces.png',
  csoc: PROXY_BASE + '/csoc.png',
  badge: PROXY_BASE + '/achieved%20badge%20icon.png',
};

const PAGE_SIZE = 50;
const ACH_BATCH_SIZE = 40;     // FIDE IDs per /api/chess-results batch request
const ACH_BATCH_PARALLEL = 6;  // requests in flight at once
const GOT_PARALLEL = 10;
const STATUS_LABEL = { 1: 'Active', 2: 'Expired', 3: 'Upcoming', 5: 'Pause' };
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function errMsg(error, fallback) {
  const d = error && error.response && error.response.data;
  return (d && (d.error || d.message)) || (error && error.message) || fallback;
}

// ── Palette + components — blue / slate theme ──
const F = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif";
const C = { ink: '#0F172A', ink2: '#334155', sub: '#64748B', mute: '#94A3B8', line: '#E2E8F0', line2: '#CBD5E1', grid: '#EEF2F6',
            bg: '#F1F5F9', card: '#F8FAFC', thead: '#F8FAFC',
            green: '#059669', amber: '#D97706', red: '#DC2626', blue: '#2563EB', blueDk: '#1D4ED8', blueLt: '#EFF6FF', purple: '#7C3AED',
            gold: '#B45309', goldLt: '#FEF3C7' };
const BTN = (bg) => 'display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:' + bg + ';color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 1px 2px rgba(15,23,42,.12);';
const GHOST = 'display:inline-flex;align-items:center;gap:6px;padding:7px 12px;background:#fff;color:' + C.ink2 + ';border:1px solid ' + C.line2 + ';border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;';
const INP = 'padding:8px 12px;border:1px solid ' + C.line2 + ';border-radius:8px;font-size:13px;color:' + C.ink + ';background:#fff;min-height:36px;';
const TH = 'padding:11px 14px;font-size:11px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;background:' + C.thead + ';border-bottom:1px solid ' + C.line + ';text-align:left;white-space:nowrap;';
const TD = 'padding:11px 14px;font-size:13px;border-bottom:1px solid ' + C.grid + ';text-align:left;color:' + C.ink + ';vertical-align:middle;';
const LBL = 'display:block;font-size:11px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;';
const PILL = (bg, ink, bd) => 'display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:600;background:' + bg + ';color:' + ink + ';border:1px solid ' + bd + ';white-space:nowrap;';
const CARD = 'background:#fff;border:1px solid ' + C.line + ';border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.05);';
const SEG = 'display:inline-flex;gap:2px;padding:3px;background:#E2E8F0;border-radius:10px;flex-wrap:wrap;';
const MUTED = 'color:' + C.mute + ';';

const STATUS_PILL = {
  1: PILL('#ECFDF5', '#047857', '#A7F3D0'),
  2: PILL('#F1F5F9', C.sub, C.line),
  3: PILL('#F0F9FF', '#0369A1', '#BAE6FD'),
  5: PILL('#FFFBEB', '#B45309', '#FDE68A'),
};
const STATUS_DOT = { 1: '#10B981', 2: C.mute, 3: '#0EA5E9', 5: '#F59E0B' };
const dot = color => '<span style="width:7px;height:7px;border-radius:999px;background:' + color + ';display:inline-block;flex-shrink:0;"></span>';

// Segmented-control button; wrap groups in a SEG container.
function tabStyle(on, ink) {
  return 'display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;border:0;'
    + (on ? 'background:#fff;color:' + (ink || C.blue) + ';box-shadow:0 1px 3px rgba(15,23,42,.1);'
          : 'background:transparent;color:' + C.sub + ';');
}

// ── Icons (Lucide, MIT) ──
const ICON_PATHS = {
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  barChart: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  externalLink: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
};
function icon(name, size) {
  const s = size || 15;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;vertical-align:middle;" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
}

// ── Dates / formatting ──────────────────────────────────────────────────────
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function currentMonthKey() { const d = new Date(); return d.getFullYear() + '-' + MON_ABBR[d.getMonth()]; }
function monthLabel(key) { const p = String(key || '').split('-'); const i = MON_ABBR.indexOf(p[1]); return i >= 0 ? MON_FULL[i] + ' ' + p[0] : String(key || ''); }
function monthKeyToDate(key) { const p = String(key).split('-'); return new Date(parseInt(p[0], 10), MON_ABBR.indexOf(p[1]), 1); }
function crDate(d) { return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); } // chess-results dd.mm.yyyy
function monthSortDesc(a, b) {
  const ap = a.split('-'), bp = b.split('-');
  return (parseInt(bp[0], 10) || 0) - (parseInt(ap[0], 10) || 0) || MON_ABBR.indexOf(bp[1]) - MON_ABBR.indexOf(ap[1]);
}

// Period → "2026-Jun" (accepts "2026-06" or an ISO date)
function normalizePeriod(val) {
  if (!val) return '';
  const s = String(val);
  const iso = s.match(/^(\d{4})-(\d{2})/);
  return iso ? iso[1] + '-' + (MON_ABBR[parseInt(iso[2], 10) - 1] || iso[2]) : s;
}

// End date from DB / API → "yyyy-mm-dd" (DB may hand back an ISO timestamp)
function normEndDate(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  const m = s.match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : s;
}

// Local-midnight Date from "YYYY-MM-DD…" (avoids UTC offset drift)
function parseYMD(s) {
  const p = String(s || '').slice(0, 10).match(/(\d{4})-(\d{2})-(\d{2})/);
  return p ? new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10)) : null;
}

function fmtYMD(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[3]) + ' ' + MON_ABBR[Number(m[2]) - 1] + ' ' + m[1] : (ymd || '');
}

function tnrId(link) { const m = String(link || '').match(/tnr(\d+)/); return m ? m[1] : ''; }

// Rated only if the tournament name says FIDE or RATED (but not "unrated" / "non-FIDE" / "non rated")
function isRatedName(name) {
  const n = String(name || '');
  if (/\bun-?rated\b|\bnon[\s-]*(fide|rated)\b/i.test(n)) return false;
  return /\b(fide|rated)\b/i.test(n);
}

// Status may be a number (DB) or a label ("Active").
function statusNum(s) {
  const n = Number(s);
  if (!isNaN(n) && n) return n;
  const rev = { active: 1, expired: 2, upcoming: 3, pause: 5 };
  return rev[String(s || '').trim().toLowerCase()] || 0;
}
function statusLabel(s) { return STATUS_LABEL[statusNum(s)] || (s ? String(s) : ''); }
function statusChip(s) {
  const n = statusNum(s);
  if (!n) return '<span style="' + MUTED + '">—</span>';
  return '<span style="' + (STATUS_PILL[n] || STATUS_PILL[2]) + '">' + dot(STATUS_DOT[n] || C.mute) + esc(STATUS_LABEL[n]) + '</span>';
}

function rankChip(rank) {
  if (!rank) return '<span style="' + MUTED + '">—</span>';
  const base = 'display:inline-block;font-weight:700;font-size:12px;padding:2px 9px;border-radius:999px;';
  if (rank <= 3) return '<span style="' + base + 'background:' + C.goldLt + ';color:' + C.gold + ';">#' + rank + '</span>';
  if (rank < 10) return '<span style="' + base + 'background:#FFF7E6;color:' + C.gold + ';">#' + rank + '</span>';
  return '<span style="' + base + 'color:' + C.sub + ';font-weight:500;">#' + rank + '</span>';
}

function ratingDelta(rc) {
  if (rc === null || rc === undefined) return '<span style="' + MUTED + '">—</span>';
  const color = rc > 0 ? C.green : rc < 0 ? C.red : C.sub;
  return '<span style="color:' + color + ';font-weight:' + (rc > 0 ? 700 : 500) + ';">' + (rc > 0 ? '+' : '') + rc + '</span>';
}

function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// ── Cross-origin requests ───────────────────────────────────────────────────
// Fresh axios instance (no NocoBase interceptors) when available; either way
// only CORS-safelisted headers are sent, so GET/POST stay "simple" requests.
const EXT_AXIOS = (() => {
  try {
    const ax = ctx.api && ctx.api.axios;
    return ax && typeof ax.create === 'function' ? ax.create({}) : null;
  } catch (e) {
    return null;
  }
})();

function keepSimpleHeaders(data, headers) {
  if (headers) {
    const keys = typeof headers.toJSON === 'function' ? Object.keys(headers.toJSON()) : Object.keys(headers);
    keys.forEach(k => {
      if (/^(accept|content-type)$/i.test(k)) return;
      if (typeof headers.delete === 'function') headers.delete(k); else delete headers[k];
    });
    if (data !== undefined && data !== null) {
      // text/plain keeps the request "simple" (no CORS preflight).
      if (typeof headers.set === 'function') headers.set('Content-Type', 'text/plain;charset=utf-8');
      else headers['Content-Type'] = 'text/plain;charset=utf-8';
    }
  }
  return data === undefined || data === null || typeof data === 'string' ? data : JSON.stringify(data);
}

async function extRequest(method, url, params, data, timeout) {
  const conf = {
    method, url, params, data,
    withCredentials: false, timeout: timeout || 120000,
    transformRequest: [keepSimpleHeaders],
    skipNotify: true, skipAuth: true, // NocoBase: no error toasts / auth handling for foreign hosts
  };
  const res = EXT_AXIOS ? await EXT_AXIOS.request(conf) : await ctx.api.request(conf);
  let body = res && res.data;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* non-JSON body */ } }
  return body;
}
const proxyGet = (path, params) => extRequest('get', PROXY_BASE + path, params);

// ── Database (NocoBase data sources, see TBL_SOURCE) ─────────────────────────────────────────────────
async function fetchAll(collection, params) {
  const pageSize = 500;
  const out = [];
  for (let page = 1; page <= 100; page++) {
    const res = await ctx.api.request({ url: collection + ':list', method: 'get', headers: dbHeaders(collection, false), params: { ...params, page, pageSize } });
    const rows = (res && res.data && res.data.data) || [];
    out.push(...rows);
    const totalPage = res && res.data && res.data.meta && Number(res.data.meta.totalPage);
    if (!totalPage || page >= totalPage || rows.length < pageSize) break;
  }
  return out;
}

async function dbCreate(collection, values) {
  const res = await ctx.api.request({ url: collection + ':create', method: 'post', headers: dbHeaders(collection, true), data: values });
  return res && res.data && res.data.data;
}

async function dbUpdate(collection, id, values) {
  const res = await ctx.api.request({ url: collection + ':update', method: 'post', headers: dbHeaders(collection, true), params: { filterByTk: id }, data: values });
  return res && res.data && res.data.data;
}

function ymdOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
// "2026-Aug" -> ['2026-08-01', '2026-08-31']
function monthRange(key) {
  const first = monthKeyToDate(key);
  return [ymdOf(first), ymdOf(new Date(first.getFullYear(), first.getMonth() + 1, 0))];
}
// "2026-Aug" -> "2026-08" (cc_csoc_got_rating.period)
function periodToDb(key) { const p = String(key).split('-'); return p[0] + '-' + pad2(MON_ABBR.indexOf(p[1]) + 1); }

// Runs worker over items, at most `limit` at a time.
async function runPool(items, limit, worker) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// ── Root markup ─────────────────────────────────────────────────────────────
// Force ctx.element itself to stretch (NocoBase wrapper can shrink-to-content).
ctx.element.style.display = 'block';
ctx.element.style.width = '100%';

function monthOptions(fromYear, withAll) {
  const now = new Date();
  const cur = currentMonthKey();
  const keys = [];
  for (let y = now.getFullYear(); y >= fromYear; y--) {
    for (let m = (y === now.getFullYear() ? now.getMonth() : 11); m >= 0; m--) keys.push(y + '-' + MON_ABBR[m]);
  }
  return keys.map(v => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + monthLabel(v) + '</option>').join('')
    + (withAll ? '<option value="All">All months</option>' : '');
}

function searchBox(scope, placeholder) {
  return '<div style="position:relative;"><span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:' + C.mute + ';display:flex;pointer-events:none;">' + icon('search', 15) + '</span>'
    + '<input data-c="search" data-scope="' + scope + '" placeholder="' + placeholder + '" style="' + INP + 'min-width:230px;padding-left:34px;" /></div>';
}

function panelHead(title, sub) {
  return '<div style="margin:2px 2px 12px;"><div style="font-size:15px;font-weight:700;letter-spacing:-.01em;">' + title + '</div>'
    + '<div style="color:' + C.sub + ';font-size:12.5px;margin-top:2px;">' + sub + '</div></div>';
}

// Month / filters / search / fetch toolbar + progress + status line, shared by Achievers and Got Rating.
function dataPanelHtml(scope, opts) {
  return panelHead(opts.title, opts.sub)
    + '<div style="' + CARD + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:10px;">'
    + '<select data-c="month" data-scope="' + scope + '" style="' + INP + 'min-width:170px;cursor:pointer;font-weight:600;">' + opts.months + '</select>'
    + (opts.extra || '')
    + searchBox(scope, opts.searchPh)
    + '<div style="flex:1;"></div>'
    + '<button data-a="refresh" data-scope="' + scope + '" title="Reload" style="' + GHOST + 'min-height:36px;">' + icon('refresh', 14) + 'Reload</button>'
    + (opts.buttons || '')
    + '<button id="csaFetch_' + scope + '" data-a="fetch" data-scope="' + scope + '" style="' + BTN(C.blue) + 'min-height:36px;">' + icon('download', 14) + 'Fetch from API</button>'
    + '</div>'
    + '<div id="csaProg_' + scope + '" style="display:none;height:4px;border-radius:999px;background:' + C.line + ';overflow:hidden;margin:0 2px 8px;"><div style="height:100%;width:0;background:' + C.blue + ';border-radius:999px;transition:width .25s;"></div></div>'
    + '<div id="csaStatus_' + scope + '" style="min-height:18px;margin:0 2px 10px;font-size:12.5px;color:' + C.sub + ';"></div>'
    + '<div id="csaKpis_' + scope + '" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>'
    + '<div style="' + CARD + 'overflow-x:auto;"><table id="csaTable_' + scope + '" style="min-width:' + opts.minWidth + 'px;"></table></div>'
    + '<div id="csaPager_' + scope + '"></div>';
}

ctx.element.innerHTML =
  '<style>'
  + "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');"
  + '#csa *{box-sizing:border-box;font-family:' + F + ';}'
  + '#csa{-webkit-font-smoothing:antialiased;line-height:1.5;font-variant-numeric:tabular-nums;}'
  + '#csa button{transition:background .15s,border-color .15s,box-shadow .15s,color .15s,filter .15s;}'
  + '#csa button:hover:not(:disabled){filter:brightness(.97);}'
  + '#csa button:disabled{opacity:.5;cursor:not-allowed;}'
  + '#csa input:focus,#csa select:focus,#csa textarea:focus{outline:none;border-color:' + C.blue + '!important;box-shadow:0 0 0 3px rgba(37,99,235,.15);}'
  + '#csa ::placeholder{color:' + C.mute + ';}'
  + '#csa table{width:100%;border-collapse:collapse;}'
  + '#csa tbody tr:last-child td{border-bottom:none;}'
  + '#csa tbody tr:hover td{background:#F8FAFC;}'
  + '#csa .csa-link{font-weight:600;color:' + C.ink + ';cursor:pointer;white-space:nowrap;}'
  + '#csa .csa-link:hover{color:' + C.blue + ';text-decoration:underline;}'
  + '#csa a.csa-t{color:' + C.ink + ';text-decoration:none;}'
  + '#csa a.csa-t:hover{color:' + C.blue + ';text-decoration:underline;}'
  + '#csa th[data-a="sort"]{cursor:pointer;user-select:none;}'
  + '#csa th[data-a="sort"]:hover{color:' + C.ink + ';}'
  + '#csa td.csa-cell{cursor:pointer;}'
  + '#csa td.csa-cell:hover{filter:brightness(.95);}'
  + '</style>'
  + '<div id="csa" style="position:relative;width:100%;min-height:520px;background:' + C.bg + ';padding:20px;border:1px solid ' + C.line + ';border-radius:16px;color:' + C.ink + ';font-size:13px;">'
  // Tabs + player count
  + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">'
  + '<div id="csaTabs" style="' + SEG + '"></div><div style="flex:1;"></div>'
  + '<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:10px;background:' + C.blueLt + ';color:' + C.blueDk + ';font-size:12.5px;font-weight:600;">' + icon('users', 15) + 'Players <span id="csaPlayers" style="font-weight:700;">—</span></div>'
  + '</div>'
  // Panels
  + '<div id="csaPanel_ach">' + dataPanelHtml('ach', {
    title: 'Achievers',
    sub: 'Tournament results for the selected month. “Fetch from API” adds finished chess-results tournaments not saved yet.',
    months: monthOptions(2026, true),
    extra: '<div id="csaFilter_ach" style="' + SEG + '"></div>',
    searchPh: 'Search player, FIDE ID, tournament',
    minWidth: 1060,
  }) + '</div>'
  + '<div id="csaPanel_got" style="display:none;">' + dataPanelHtml('got', {
    title: 'Got Rating',
    sub: 'Players who received their first FIDE rating in the selected month. “Fetch from API” checks players active that month with no rating saved yet; “Fetch all ratings” saves every player’s first rating.',
    months: monthOptions(2025, true),
    searchPh: 'Search player, FIDE ID, mobile',
    buttons: '<button data-a="fetch-log" title="Status of the last fetch, player by player" style="' + GHOST + 'min-height:36px;">' + icon('info', 14) + 'Fetch log</button>'
      + '<button id="csaFetchAll_got" data-a="fetch-all" title="Save the first FIDE rating of every player not rated yet" style="' + GHOST + 'min-height:36px;color:' + C.blue + ';">' + icon('star', 14) + 'Fetch all ratings</button>',
    minWidth: 1000,
  }) + '</div>'
  + '<div id="csaPanel_stats" style="display:none;"></div>'
  + '<div id="csaPanel_consent" style="display:none;">'
  + panelHead('Consent', 'Players who gave consent for posters and publicity (' + TBL.consent + '). The Consent ticks in Achievers and Got Rating come from here.')
  + '<div style="' + CARD + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:10px;">'
  + searchBox('consent', 'Search player, FIDE ID, mobile')
  + '<div style="flex:1;"></div>'
  + '<button data-a="refresh" data-scope="consent" title="Reload" style="' + GHOST + 'min-height:36px;">' + icon('refresh', 14) + 'Reload</button>'
  + '<button data-a="consent-add" style="' + BTN(C.blue) + 'min-height:36px;">' + icon('checkCircle', 14) + 'Add consent</button>'
  + '</div>'
  + '<div id="csaStatus_consent" style="min-height:18px;margin:0 2px 10px;font-size:12.5px;color:' + C.sub + ';"></div>'
  + '<div style="' + CARD + 'overflow-x:auto;"><table id="csaTable_consent" style="min-width:760px;"></table></div>'
  + '<div id="csaPager_consent"></div>'
  + '</div>'
  + '<div id="csaPanel_custom" style="display:none;"></div>'
  // Modal
  + '<div id="csaBackdrop" style="display:none;position:absolute;inset:0;z-index:50;background:rgba(15,23,42,.45);backdrop-filter:blur(2px);border-radius:16px;">'
  + '<div id="csaModal" style="max-width:760px;width:94%;margin:0 auto;border-radius:16px;background:#fff;border:1px solid ' + C.line + ';box-shadow:0 24px 48px -12px rgba(15,23,42,.35);"></div>'
  + '</div>'
  // Off-screen helpers: poster artwork, export canvas, download link
  + '<div id="csaHidden" style="position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;">'
  + '<div id="csaImgs"></div><canvas id="csaCvOut"></canvas><a id="csaDl"></a></div>'
  + '</div>';

const Q = id => ctx.element.querySelector('#' + id);

const TABS = [
  { key: 'ach', label: 'Achievers', icon: 'trophy', badge: true },
  { key: 'got', label: 'Got Rating', icon: 'star', badge: true },
  { key: 'stats', label: 'Rating Stats', icon: 'barChart' },
  { key: 'consent', label: 'Consent', icon: 'checkCircle', badge: true },
  { key: 'custom', label: 'Custom Poster', icon: 'image' },
];

const state = {
  tab: 'ach',
  players: [],
  playerMap: new Map(),
  playersPromise: null,
  // cc_csoc_cx_consent rows with is_consent = true: a player is ticked in the Achievers /
  // Got Rating tables when their FIDE ID or mobile number appears there.
  consent: { rows: [], loaded: false, search: '', page: 0, sort: { key: null, dir: 1 } },
  consentFide: new Set(),
  consentMobile: new Set(), // last 10 digits
  consentMissing: false, // collection not found in the data source (list -> 404)
  ach: { month: currentMonthKey(), filter: 'all', search: '', rows: [], loaded: false, page: 0, sort: { key: null, dir: 1 }, seq: 0, busy: false, cache: {} },
  got: { month: currentMonthKey(), search: '', rows: [], loaded: false, page: 0, sort: { key: null, dir: 1 }, seq: 0, busy: false, cache: {} },
  stats: { loaded: false, loading: false, rows: [], monthMap: {}, periods: [], period: '' },
  poster: { modal: null, custom: null },
  modal: null,
};

// ── Players & consent ───────────────────────────────────────────────────────
// Players = cc_users ⋈ cc_csoc_registration on mobile_number, registration
// status 1 only, latest registration per mobile (subscription_end_date, then
// subscription_start_date, newest first), users with fide_id > 0. Same as:
//   SELECT DISTINCT ON (csoc.mobile_number) … WHERE csoc.status = 1 AND u.fide_id > 0
//   ORDER BY csoc.mobile_number, subscription_end_date DESC, subscription_start_date DESC
// statuses: registration statuses to include, e.g. [1] or [1, 2] (1 = active, 2 = expired).
async function fetchPlayerList(statuses) {
  const [regs, users] = await Promise.all([
    fetchAll(TBL.reg, {
      filter: JSON.stringify({ status: { $in: statuses } }),
      fields: 'id,mobile_number,subscription_start_date,subscription_end_date,status',
    }),
    fetchAll(TBL.users, {
      filter: JSON.stringify({ fide_id: { $gt: 0 } }),
      fields: 'id,mobile_number,first_name,last_name,fide_id',
    }),
  ]);
  const latest = new Map();
  regs.forEach(r => {
    const mobile = String(r.mobile_number || '').trim();
    if (!mobile) return;
    const end = normEndDate(r.subscription_end_date), start = normEndDate(r.subscription_start_date);
    const cur = latest.get(mobile);
    if (!cur || end > cur.end || (end === cur.end && start > cur.start)) latest.set(mobile, { end, start, status: Number(r.status) || 1 });
  });
  const seen = new Set();
  const players = [];
  users.forEach(u => {
    const mobile = String(u.mobile_number || '').trim();
    const reg = latest.get(mobile);
    if (!reg || seen.has(mobile)) return;
    seen.add(mobile);
    players.push({
      player_name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim(),
      fide_id: String(u.fide_id || '').trim(),
      mobile_number: mobile,
      subscription_start_date: reg.start,
      subscription_end_date: reg.end,
      status: reg.status,
    });
  });
  return players.filter(p => p.fide_id && p.fide_id !== '0');
}

function loadPlayers(force) {
  if (state.playersPromise && !force) return state.playersPromise;
  Q('csaPlayers').textContent = '…';
  state.playersPromise = fetchPlayerList([1]).then(players => {
    state.players = players;
    state.playerMap = new Map(state.players.map(p => [p.fide_id, p]));
    Q('csaPlayers').textContent = fmtNum(state.players.length);
    // Status / mobile columns come from the player list.
    renderAch();
    renderGot();
  }).catch(e => {
    console.error('[csa] players load failed', e);
    Q('csaPlayers').textContent = '!';
    state.playersPromise = null;
  });
  return state.playersPromise;
}

function playerById(fideId) { return state.playerMap.get(String(fideId || '').trim()) || null; }

function mobileKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function hasConsent(fid, mobile) {
  const f = String(fid || '').trim();
  const m = mobileKey(mobile);
  return !!((f && f !== '0' && state.consentFide.has(f)) || (m && state.consentMobile.has(m)));
}

// No `fields` param: only fide_id / mobile_number are needed, and asking for a column the
// table doesn't have would fail the whole request.
const isTrue = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

// cc_csoc_cx_consent record -> row. A missing is_consent column counts as consent given.
function consentRowFromDb(rec) {
  return {
    id: rec.id,
    player_name: String(rec.player_name || ''),
    fide_id: String(rec.fide_id || '').trim(),
    mobile_number: rec.mobile_number ? String(rec.mobile_number) : '',
    yes: rec.is_consent === undefined ? true : isTrue(rec.is_consent),
    added: normEndDate(rec.createdAt || rec.created_at || ''),
  };
}

function loadConsent(note) {
  setStatus('consent', 'Loading…');
  return fetchAll(TBL.consent, {}).then(recs => {
    const rows = recs.map(consentRowFromDb);
    const fide = new Set(), mobile = new Set();
    rows.filter(r => r.yes).forEach(r => {
      if (r.fide_id && r.fide_id !== '0') fide.add(r.fide_id);
      const m = mobileKey(r.mobile_number);
      if (m) mobile.add(m);
    });
    state.consent.rows = rows;
    state.consent.loaded = true;
    state.consentFide = fide;
    state.consentMobile = mobile;
    state.consentMissing = false;
    setStatus('consent', (note ? note + ' · ' : '') + rows.length + ' records, ' + rows.filter(r => r.yes).length + ' with consent', note ? 'ok' : '');
    renderAch();
    renderGot();
    renderConsent();
    renderTabs();
  }).catch(e => {
    state.consent.loaded = true;
    // 404 = the table isn't registered as a collection in this data source (TBL_SOURCE).
    if (e && e.response && e.response.status === 404) {
      state.consentMissing = true;
      console.warn('[csa] ' + TBL.consent + ' collection not found in the "' + TBL_SOURCE[TBL.consent] + '" data source');
      setStatus('consent', TBL.consent + ' is not set up as a collection in the "' + TBL_SOURCE[TBL.consent] + '" data source.', 'err');
    } else {
      console.error('[csa] consent load failed', e);
      setStatus('consent', 'Could not load consent: ' + errMsg(e, 'unknown error'), 'err');
    }
    renderAch();
    renderGot();
    renderConsent();
  });
}

// ── Shared UI bits ──────────────────────────────────────────────────────────
function setStatus(scope, text, tone) {
  const el = Q('csaStatus_' + scope);
  if (!el) return;
  const color = tone === 'err' ? '#B91C1C' : tone === 'ok' ? '#047857' : C.sub;
  const ic = tone === 'err' ? 'alert' : tone === 'ok' ? 'checkCircle' : null;
  el.innerHTML = text ? '<span style="display:inline-flex;align-items:center;gap:6px;color:' + color + ';font-weight:' + (tone ? 600 : 500) + ';">' + (ic ? icon(ic, 14) : '') + esc(text) + '</span>' : '';
}

function setProgress(scope, pct) {
  const el = Q('csaProg_' + scope);
  if (!el) return;
  el.style.display = pct === null ? 'none' : 'block';
  el.firstChild.style.width = (pct === null ? 0 : Math.max(3, Math.min(100, pct))) + '%';
}

function kpi(label, value, color, sub) {
  return '<div style="flex:1;min-width:150px;padding:12px 16px;' + CARD + '">'
    + '<div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;">' + dot(color) + label + '</div>'
    + '<div style="font-size:22px;font-weight:700;color:' + C.ink + ';margin-top:2px;letter-spacing:-.01em;">' + value + '</div>'
    + (sub ? '<div style="font-size:11.5px;color:' + C.sub + ';">' + sub + '</div>' : '')
    + '</div>';
}

// Sort helper: nulls/empties always last, strings case-insensitive
function sortRows(rows, getter, dir) {
  return rows.slice().sort((a, b) => {
    const x = getter(a), y = getter(b);
    const xe = x === null || x === undefined || x === '', ye = y === null || y === undefined || y === '';
    if (xe && ye) return 0;
    if (xe) return 1;
    if (ye) return -1;
    if (typeof x === 'string') return x.localeCompare(y, undefined, { sensitivity: 'base' }) * dir;
    return (x - y) * dir;
  });
}

function thCell(scope, col) {
  const st = state[scope].sort;
  const align = col.num ? 'text-align:right;' : col.center ? 'text-align:center;' : '';
  if (!col.sort) return '<th style="' + TH + align + (col.w ? 'width:' + col.w + ';' : '') + '">' + col.label + '</th>';
  const on = st.key === col.sort;
  const arrow = on ? (st.dir > 0 ? '▲' : '▼') : '↕';
  return '<th data-a="sort" data-scope="' + scope + '" data-key="' + col.sort + '" style="' + TH + align + (on ? 'color:' + C.blue + ';' : '') + '">'
    + col.label + ' <span style="font-size:9px;' + (on ? '' : 'opacity:.45;') + '">' + arrow + '</span></th>';
}

function pagerHtml(scope, page, total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return total ? '<div style="text-align:center;padding:12px 0 0;font-size:12px;color:' + C.sub + ';">' + total + ' rows</div>' : '';
  const btn = (p, label, on) => '<button data-a="page" data-scope="' + scope + '" data-page="' + p + '" style="' + (on ? BTN(C.blue) : GHOST) + 'padding:5px 11px;min-width:34px;justify-content:center;font-size:12.5px;">' + label + '</button>';
  let html = '';
  if (page > 0) html += btn(page - 1, icon('chevronLeft', 14));
  for (let i = Math.max(0, page - 2); i <= Math.min(pages - 1, page + 2); i++) html += btn(i, i + 1, i === page);
  if (page < pages - 1) html += btn(page + 1, icon('chevronRight', 14));
  return '<div style="display:flex;gap:4px;align-items:center;justify-content:center;flex-wrap:wrap;padding:14px 0 0;">' + html
    + '<span style="font-size:12px;color:' + C.sub + ';margin-left:8px;">' + (page * PAGE_SIZE + 1) + '–' + Math.min((page + 1) * PAGE_SIZE, total) + ' of ' + total + '</span></div>';
}

function emptyRow(cols, text) {
  return '<tr><td colspan="' + cols + '" style="' + TD + 'color:' + C.sub + ';text-align:center;padding:44px 16px;">' + text + '</td></tr>';
}

function playerCell(fid, name, mobile) {
  return '<span class="csa-link" data-a="player" data-fid="' + esc(fid) + '" data-name="' + esc(name) + '" data-mobile="' + esc(mobile) + '">' + esc(name || '—') + '</span>';
}

// Read-only consent box: green tick = consent given, red cross = not given / no record.
function consentCell(fid, name, mobile) {
  const yes = hasConsent(fid, mobile);
  const title = state.consentMissing ? 'Consent table (' + TBL.consent + ') is not set up in NocoBase'
    : yes ? 'Consent given' : 'Consent not given';
  return '<span class="csa-consent" data-yes="' + (yes ? 1 : 0) + '" title="' + esc(title) + '" style="display:inline-flex;align-items:center;justify-content:center;'
    + 'width:18px;height:18px;border-radius:4px;vertical-align:middle;color:#fff;'
    + (yes ? 'background:' + C.green + ';border:1.5px solid ' + C.green + ';' : 'background:#FEF2F2;border:1.5px solid ' + C.red + ';color:' + C.red + ';') + '">'
    + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (yes ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>') + '</svg></span>';
}

function renderTabs() {
  const counts = {
    ach: state.ach.loaded ? state.ach.rows.length : null,
    got: state.got.loaded ? state.got.rows.length : null,
    consent: state.consent.loaded ? state.consent.rows.filter(r => r.yes).length : null,
  };
  Q('csaTabs').innerHTML = TABS.map(t => {
    const on = state.tab === t.key;
    const badge = t.badge
      ? ' <span style="min-width:22px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;text-align:center;'
        + (on ? 'background:' + C.blueLt + ';color:' + C.blueDk + ';' : 'background:rgba(255,255,255,.6);color:' + C.sub + ';') + '">'
        + (counts[t.key] === null ? '—' : counts[t.key]) + '</span>'
      : '';
    return '<button data-a="tab" data-tab="' + t.key + '" style="' + tabStyle(on) + '">' + icon(t.icon, 15) + t.label + badge + '</button>';
  }).join('');
}

function switchTab(tab) {
  state.tab = tab;
  TABS.forEach(t => { Q('csaPanel_' + t.key).style.display = t.key === tab ? 'block' : 'none'; });
  renderTabs();
  if (tab === 'stats' && !state.stats.loaded && !state.stats.loading) loadStats();
  if (tab === 'stats') renderStats();
  if (tab === 'consent') renderConsent();
  if (tab === 'custom') renderCustom();
}

function renderScope(scope) {
  if (scope === 'ach') renderAch();
  else if (scope === 'got') renderGot();
  else if (scope === 'consent') renderConsent();
}

// ── Consent tab (cc_csoc_cx_consent) ───────────────────────────────────────
const CONSENT_SORT_GET = {
  name: r => r.player_name || '',
  fide: r => Number(r.fide_id) || null,
  yes: r => (r.yes ? 1 : 0),
  added: r => r.added || '',
};

function renderConsent() {
  const c = state.consent;
  const s = c.search.trim().toLowerCase();
  let rows = c.rows.filter(r => !s || [r.player_name, r.fide_id, r.mobile_number].some(v => String(v || '').toLowerCase().includes(s)));
  if (c.sort.key) rows = sortRows(rows, CONSENT_SORT_GET[c.sort.key], c.sort.dir);
  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'FIDE ID', sort: 'fide' }, { label: 'Mobile' },
    { label: 'Consent', sort: 'yes', center: true }, { label: 'Added', sort: 'added' },
  ];
  const thead = '<thead><tr>' + cols.map(col => thCell('consent', col)).join('') + '</tr></thead>';
  let body;
  if (!c.loaded) body = emptyRow(cols.length, 'Loading consent…');
  else if (!rows.length) body = emptyRow(cols.length, c.rows.length ? 'No records match this search.' : 'No consent records yet. Use “Add consent” to add one.');
  else {
    c.page = Math.min(c.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = c.page * PAGE_SIZE;
    body = rows.slice(offset, offset + PAGE_SIZE).map((r, i) => '<tr>'
      + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (offset + i + 1) + '</td>'
      + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, r.mobile_number) + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(r.fide_id || '—') + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(r.mobile_number || '—') + '</td>'
      + '<td style="' + TD + 'text-align:center;">' + (r.yes
        ? '<span style="' + PILL('#ECFDF5', '#047857', '#A7F3D0') + '">' + icon('checkCircle', 12) + 'Yes</span>'
        : '<span style="' + PILL('#FEF2F2', '#B91C1C', '#FECACA') + '">' + icon('x', 12) + 'No</span>') + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(fmtYMD(r.added) || '—') + '</td>'
      + '</tr>').join('');
  }
  Q('csaTable_consent').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_consent').innerHTML = c.loaded ? pagerHtml('consent', c.page, rows.length) : '';
}

function openConsentForm() {
  const field = (id, label, placeholder, extra) => '<div style="margin-bottom:12px;"><label style="' + LBL + '">' + label + '</label>'
    + '<input id="' + id + '" placeholder="' + placeholder + '" ' + (extra || '') + ' style="' + INP + 'width:100%;"></div>';
  openModal('consent', 480, modalShell('checkCircle', 'Add consent', 'Saved to ' + esc(TBL.consent),
    field('csaCfFide', 'FIDE ID', 'e.g. 25092340', 'inputmode="numeric"')
    + '<div id="csaCfHint" style="margin:-6px 0 12px;font-size:12px;color:' + C.sub + ';">Enter a FIDE ID to fill in a known player’s name and mobile.</div>'
    + field('csaCfName', 'Player name', 'e.g. Magnus Carlsen')
    + field('csaCfMobile', 'Mobile number', 'e.g. 919876543210', 'inputmode="tel"')
    + '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.card + ';cursor:pointer;font-weight:600;">'
    + '<input type="checkbox" id="csaCfYes" checked style="width:16px;height:16px;accent-color:' + C.green + ';"> Consent given</label>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
    + '<button data-a="close" style="' + GHOST + '">Cancel</button>'
    + '<button data-a="consent-save" style="' + BTN(C.blue) + '">Save</button></div>'));
  Q('csaCfFide').focus();
}

// Typing a known FIDE ID fills in the player's name / mobile (only empty fields).
function consentFormLookup() {
  const p = playerById(Q('csaCfFide').value);
  const existing = state.consent.rows.find(r => r.fide_id && r.fide_id === String(Q('csaCfFide').value).trim());
  if (p) {
    if (!Q('csaCfName').value.trim()) Q('csaCfName').value = p.player_name;
    if (!Q('csaCfMobile').value.trim()) Q('csaCfMobile').value = p.mobile_number;
  }
  Q('csaCfHint').textContent = existing
    ? 'This FIDE ID already has a consent record — saving will update it.'
    : p ? 'Found: ' + p.player_name + '.' : 'Enter a FIDE ID to fill in a known player’s name and mobile.';
}

// Adds a record, or updates the existing one for the same FIDE ID (else mobile number).
async function saveConsentForm(btn) {
  const fid = Q('csaCfFide').value.trim();
  const name = Q('csaCfName').value.trim();
  const mobile = Q('csaCfMobile').value.trim();
  const yes = Q('csaCfYes').checked;
  if (!name) { modalMessage('Enter the player name.', 'error'); return; }
  if (!fid && !mobile) { modalMessage('Enter a FIDE ID or a mobile number.', 'error'); return; }
  if (fid && !/^\d+$/.test(fid)) { modalMessage('FIDE ID must be a number.', 'error'); return; }
  const values = { player_name: name, fide_id: fid ? Number(fid) : null, mobile_number: mobile || null, is_consent: yes };
  const existing = state.consent.rows.find(r => (fid && r.fide_id === fid) || (!fid && mobile && mobileKey(r.mobile_number) === mobileKey(mobile)));
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    if (existing) await dbUpdate(TBL.consent, existing.id, values);
    else await dbCreate(TBL.consent, values);
    closeModal();
    await loadConsent((existing ? 'Updated ' : 'Added ') + name);
  } catch (e) {
    console.error('[csa] consent save failed', e);
    modalMessage('Could not save: ' + errMsg(e, 'unknown error'), 'error');
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── 1. Achievers ────────────────────────────────────────────────────────────
// cc_csoc_achievements record -> table row
function achRowFromDb(rec, i) {
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  return {
    _i: i,
    player_name: rec.player_name || '',
    fide_id: String(rec.fide_id || '').trim(),
    mobile: rec.mobile_number ? String(rec.mobile_number) : '',
    tournament_name: rec.tournament_name || '',
    tournament_id: rec.tournament_id ? String(rec.tournament_id) : tnrId(rec.tournament_link),
    tournament_link: rec.tournament_link || '',
    rank: num(rec.rank) || null,
    rating_change: num(rec.rating_change),
    is_rated: rec.is_rated === true || rec.is_rated === 1 || isRatedName(rec.tournament_name),
    date: normEndDate(rec.end_date),
  };
}

function rowMobile(r) { const p = playerById(r.fide_id); return r.mobile || (p && p.mobile_number) || ''; }
function achStatus(r) { const p = playerById(r.fide_id); return p ? p.status : ''; }

const ACH_SORT_GET = {
  name: r => r.player_name || '',
  status: r => statusLabel(achStatus(r)),
  tournament: r => r.tournament_name || '',
  date: r => r.date || '',
  rank: r => r.rank || null,
  rc: r => r.rating_change,
};

function achVisibleRows() {
  const a = state.ach;
  const s = a.search.trim().toLowerCase();
  let rows = a.rows.filter(r => {
    if (a.filter === 'rated' && !r.is_rated) return false;
    if (a.filter === 'podium' && !(r.rank && r.rank <= 3)) return false;
    if (s && ![r.player_name, r.fide_id, r.tournament_name, rowMobile(r)].some(v => String(v || '').toLowerCase().includes(s))) return false;
    return true;
  });
  if (a.sort.key) rows = sortRows(rows, ACH_SORT_GET[a.sort.key], a.sort.dir);
  return rows;
}

function renderAch() {
  const a = state.ach;
  Q('csaFilter_ach').innerHTML = [['all', 'All results'], ['rated', 'FIDE rated'], ['podium', 'Podium']].map(f =>
    '<button data-a="filter" data-filter="' + f[0] + '" style="' + tabStyle(a.filter === f[0]) + 'padding:6px 12px;">' + f[1] + '</button>').join('');
  const rows = achVisibleRows();

  const players = new Set(rows.map(r => r.fide_id)).size;
  const podium = rows.filter(r => r.rank && r.rank <= 3).length;
  const gained = rows.reduce((s, r) => s + (r.is_rated && r.rating_change > 0 ? r.rating_change : 0), 0);
  Q('csaKpis_ach').innerHTML = !a.loaded ? '' :
    kpi('Results', fmtNum(rows.length), C.blue, monthLabel(a.month === 'All' ? 'All months' : a.month))
    + kpi('Players', fmtNum(players), '#0D9488', 'with a result')
    + kpi('Podium finishes', fmtNum(podium), '#F59E0B', 'rank 1–3')
    + kpi('Rating gained', '+' + fmtNum(gained), '#10B981', 'FIDE-rated events');

  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'Mobile' }, { label: 'Consent', center: true },
    { label: 'Status', sort: 'status' }, { label: 'Tournament', sort: 'tournament' }, { label: 'End date', sort: 'date' },
    { label: 'Rank', sort: 'rank' }, { label: 'Rating ±', sort: 'rc', num: true }, { label: '', w: '1%' },
  ];
  const thead = '<thead><tr>' + cols.map(c => thCell('ach', c)).join('') + '</tr></thead>';
  let body;
  if (!a.loaded) body = emptyRow(cols.length, 'Loading results…');
  else if (!rows.length) {
    body = emptyRow(cols.length, a.rows.length ? 'No results match these filters.'
      : 'No results saved for ' + esc(a.month === 'All' ? 'any month' : monthLabel(a.month)) + '. Use “Fetch from API” to load finished tournaments.');
  } else {
    a.page = Math.min(a.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = a.page * PAGE_SIZE;
    body = rows.slice(offset, offset + PAGE_SIZE).map((r, i) => {
      const full = r.tournament_name || '';
      const short = full.length > 44 ? full.slice(0, 44) + '…' : full;
      const mobile = rowMobile(r);
      const tourn = r.tournament_link
        ? '<a class="csa-t" href="' + esc(r.tournament_link) + '" target="_blank" rel="noopener noreferrer" title="' + esc(full) + '">' + esc(short) + '</a>'
        : '<span title="' + esc(full) + '">' + esc(short) + '</span>';
      return '<tr>'
        + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (offset + i + 1) + '</td>'
        + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, mobile) + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(mobile || '—') + '</td>'
        + '<td style="' + TD + 'text-align:center;">' + consentCell(r.fide_id, r.player_name, mobile) + '</td>'
        + '<td style="' + TD + '">' + statusChip(achStatus(r)) + '</td>'
        + '<td style="' + TD + '">' + tourn
        + (r.is_rated ? ' <span style="background:' + C.blueLt + ';color:' + C.blueDk + ';border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;letter-spacing:.04em;margin-left:4px;">FIDE</span>' : '') + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(fmtYMD(r.date) || '—') + '</td>'
        + '<td style="' + TD + '">' + rankChip(r.rank) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + ratingDelta(r.rating_change) + '</td>'
        + '<td style="' + TD + '"><button data-a="poster-ach" data-i="' + r._i + '" style="' + GHOST + 'padding:5px 11px;font-size:12px;color:' + C.blue + ';">' + icon('image', 13) + 'Poster</button></td>'
        + '</tr>';
    }).join('');
  }
  Q('csaTable_ach').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_ach').innerHTML = a.loaded ? pagerHtml('ach', a.page, rows.length) : '';
}

async function loadAch(note) {
  const a = state.ach;
  const month = a.month;
  const seq = ++a.seq;
  const label = month === 'All' ? 'all months' : monthLabel(month);
  const prefix = note ? note + ' · ' : '';
  const cached = a.cache[month];
  // Show the copy from earlier in this visit instantly, then refresh from the database.
  if (cached) {
    a.rows = cached.map(achRowFromDb);
    a.loaded = true;
    setStatus('ach', prefix + cached.length + ' results for ' + label + ' · refreshing…', note ? 'ok' : '');
  } else {
    a.loaded = false;
    a.page = 0;
    setStatus('ach', prefix + 'Loading…', note ? 'ok' : '');
  }
  renderAch();
  renderTabs();
  try {
    const recs = await loadAchRecords(month);
    if (seq !== a.seq) return; // a newer month was selected meanwhile
    a.cache[month] = recs;
    a.rows = recs.map(achRowFromDb);
    a.loaded = true;
    if (!cached) a.page = 0;
    setStatus('ach', prefix + a.rows.length + ' results for ' + label, note ? 'ok' : '');
  } catch (e) {
    if (seq !== a.seq) return;
    console.error('[csa] achievements load failed', e);
    a.loaded = true;
    setStatus('ach', cached ? 'Showing the earlier copy — could not refresh.' : 'Could not load achievements: ' + errMsg(e, 'unknown error'), 'err');
  }
  renderAch();
  renderTabs();
}

// Results whose tournament ended in `month` ('All' = everything)
function loadAchRecords(month) {
  const params = { sort: '-end_date' };
  if (month !== 'All') {
    const range = monthRange(month);
    params.filter = JSON.stringify({ $and: [{ end_date: { $gte: range[0] } }, { end_date: { $lte: range[1] } }] });
  }
  return fetchAll(TBL.ach, params);
}

function confirmFetchAch() {
  const month = state.ach.month;
  if (state.ach.busy) return;
  if (!month || month === 'All') { setStatus('ach', 'Select a month to fetch.', 'err'); return; }
  openConfirm('Fetch achievements', 'Fetch finished tournaments for <b>' + esc(monthLabel(month)) + '</b> from chess-results.com?'
    + '<div style="margin-top:8px;color:' + C.sub + ';">Only tournaments that have already ended are fetched, and results already saved are skipped.</div>',
  'Fetch results', () => fetchAch(month));
}

async function fetchAch(month) {
  const a = state.ach;
  const first = monthKeyToDate(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const to = last < yesterday ? last : yesterday; // only tournaments that have ended (end date before today)
  if (to < first) { setStatus('ach', 'No finished tournaments yet for ' + monthLabel(month) + ' — tournaments are fetched after their end date.', 'err'); return; }

  a.busy = true;
  Q('csaFetch_ach').disabled = true;
  setProgress('ach', 0);
  try {
    setStatus('ach', 'Loading player list…');
    await loadPlayers();
    // Players are status 1 (active) only; skip those whose subscription starts after the month.
    const srcPlayers = state.players.filter(p => !p.subscription_start_date || parseYMD(p.subscription_start_date) <= last);
    if (!srcPlayers.length) { setStatus('ach', 'No active players for ' + monthLabel(month) + '.', 'err'); return; }

    // Already fetched = already saved for this month (by tournament id, else by name)
    setStatus('ach', 'Checking already-saved results…');
    const saved = await loadAchRecords(month);
    const seenTnr = {}, seenName = {};
    saved.map(achRowFromDb).forEach(r => {
      if (r.tournament_id) (seenTnr[r.fide_id] = seenTnr[r.fide_id] || []).push(r.tournament_id);
      seenName[r.fide_id + '|' + r.tournament_name.trim().toLowerCase()] = true;
    });

    const fromStr = crDate(first), toStr = crDate(to);
    const byFid = {};
    srcPlayers.forEach(p => { byFid[String(p.fide_id).trim()] = p; });
    const total = srcPlayers.length;
    let done = 0, apiErrors = 0, skipped = 0, savedCount = 0, failed = 0;
    const progress = () => {
      setProgress('ach', done / total * 100);
      setStatus('ach', 'Checked ' + done + ' / ' + total + ' players — ' + savedCount + ' new results saved' + (failed ? ', ' + failed + ' failed' : '') + '…');
    };
    setStatus('ach', 'Fetching 0 / ' + total + ' players (' + fromStr + ' – ' + toStr + ')…');

    // Saved right away; shown in the table if this month (or All) is on screen.
    const saveRow = async values => {
      try {
        const rec = (await dbCreate(TBL.ach, values)) || values;
        savedCount++;
        [month, 'All'].forEach(k => { if (a.cache[k]) a.cache[k].push(rec); });
        if (a.loaded && (a.month === month || a.month === 'All')) {
          a.rows.push(achRowFromDb(rec, a.rows.length));
          renderAch();
          renderTabs();
        }
      } catch (e) {
        failed++;
        console.error('[csa] achievement save failed', values, e);
      }
      progress();
    };

    const handlePlayer = async (fid, resp) => {
      const player = byFid[fid];
      if (!resp || !resp.ok) { apiErrors++; return; }
      skipped += resp.skipped || 0;
      for (const t of resp.tournaments || []) {
        const end = parseYMD(normEndDate(t.date));
        if (!end || end >= today || end < first || end > last) continue; // still running / other month
        const key = fid + '|' + String(t.tournament_name || '').trim().toLowerCase();
        if (seenName[key] || (seenTnr[fid] || []).indexOf(String(t.tournament_id)) >= 0) { skipped++; continue; }
        seenName[key] = true;
        await saveRow({
          player_name: t.player_name_cr || player.player_name,
          fide_id: Number(fid),
          mobile_number: player.mobile_number || null,
          tournament_name: t.tournament_name,
          tournament_id: t.tournament_id ? String(t.tournament_id) : null,
          tournament_link: t.tournament_link || null,
          rank: t.rank === null || t.rank === undefined ? null : Number(t.rank),
          rating_change: t.rating_change === null || t.rating_change === undefined ? null : Number(t.rating_change),
          is_rated: isRatedName(t.tournament_name),
          end_date: normEndDate(t.date),
        });
      }
    };

    // Batch API (fide_ids=…) when the deployed proxy supports it, else one request per player.
    let batchMode = true;
    const fetchBatch = async (ids, attempt) => {
      const skip = {};
      ids.forEach(fid => { if (seenTnr[fid]) skip[fid] = seenTnr[fid]; });
      try {
        const d = await proxyGet('/api/chess-results', {
          fide_ids: ids.join(','), from_date: fromStr, to_date: toStr,
          ...(Object.keys(skip).length ? { skip: JSON.stringify(skip) } : {}),
        });
        if (d && d.ok && d.results) return d.results;
        if (d && d.error && /missing fide_id/i.test(d.error)) { batchMode = false; return null; } // old single-player proxy
        throw new Error((d && d.error) || 'bad response');
      } catch (e) {
        if (attempt < 1) return fetchBatch(ids, attempt + 1);
        return null;
      }
    };
    const fetchSingle = async (fid, attempt) => {
      try {
        return await proxyGet('/api/chess-results', {
          fide_id: fid, from_date: fromStr, to_date: toStr,
          ...(seenTnr[fid] ? { skip_tnr: seenTnr[fid].join(',') } : {}),
        });
      } catch (e) {
        return attempt < 1 ? fetchSingle(fid, attempt + 1) : null;
      }
    };

    const groups = [];
    const ids = Object.keys(byFid);
    for (let i = 0; i < ids.length; i += ACH_BATCH_SIZE) groups.push(ids.slice(i, i + ACH_BATCH_SIZE));
    await runPool(groups, ACH_BATCH_PARALLEL, async group => {
      const results = batchMode ? await fetchBatch(group, 0) : null;
      for (const fid of group) {
        await handlePlayer(fid, results ? results[fid] : await fetchSingle(fid, 0));
        done++;
        progress();
      }
    });

    const note = 'Fetch done: ' + savedCount + ' new saved, ' + skipped + ' already saved'
      + (apiErrors ? ', ' + apiErrors + ' errors' : '') + (failed ? ' — ' + failed + ' could not be saved (see console)' : '');
    if (a.month === month || a.month === 'All') loadAch(note);
    else setStatus('ach', note, 'ok');
  } catch (e) {
    console.error('[csa] fetch achievements failed', e);
    setStatus('ach', 'Fetch failed: ' + errMsg(e, 'unknown error'), 'err');
  } finally {
    a.busy = false;
    Q('csaFetch_ach').disabled = false;
    setProgress('ach', null);
  }
}

// ── 2. Got Rating ───────────────────────────────────────────────────────────
// cc_csoc_got_rating: one row per player — the first rating of each type and the
// month it first appeared on a FIDE list ('YYYY-MM'); a type never rated stays empty.
const GOT_TYPES = [
  { key: 'std', label: 'Classical', rating: 'classical_rating', period: 'classical_period' },
  { key: 'rap', label: 'Rapid', rating: 'rapid_rating', period: 'rapid_period' },
  { key: 'bli', label: 'Blitz', rating: 'blitz_rating', period: 'blitz_period' },
];

// record -> { player_name, fide_id, mobile, std/rap/bli (rating, 0 = none), stdP/rapP/bliP ('2026-Aug') }
function gotRecord(rec) {
  const r = { player_name: String(rec.player_name || ''), fide_id: String(rec.fide_id || '').trim(), mobile: rec.mobile_number ? String(rec.mobile_number) : '' };
  GOT_TYPES.forEach(t => {
    const per = normalizePeriod(String(rec[t.period] || '').trim());
    r[t.key + 'P'] = per;
    r[t.key] = per ? Number(rec[t.rating]) || 0 : 0;
  });
  return r;
}

// Table row for `month`: only the rating types first earned in that month ('All' = every type).
// row.period = that month ('All': the player's earliest first-rating month).
function gotRowFor(rec, month, i) {
  const r = gotRecord(rec);
  const row = { _i: i, player_name: r.player_name, fide_id: r.fide_id, mobile: r.mobile };
  GOT_TYPES.forEach(t => {
    const on = r[t.key] && (month === 'All' || r[t.key + 'P'] === month);
    row[t.key] = on ? r[t.key] : 0;
    row[t.key + 'P'] = on ? r[t.key + 'P'] : '';
  });
  row.period = month === 'All' ? GOT_TYPES.map(t => row[t.key + 'P']).filter(Boolean).sort(monthSortDesc).pop() || '' : month;
  return row;
}

// month "2026-Aug" (any type first rated that month), or null / 'All' for every record
function loadGotRecords(month) {
  if (!month || month === 'All') return fetchAll(TBL.got, { sort: 'player_name' });
  const per = periodToDb(month);
  return fetchAll(TBL.got, { filter: JSON.stringify({ $or: GOT_TYPES.map(t => ({ [t.period]: { $eq: per } })) }), sort: 'player_name' });
}

function gotMonthLabel(month) { return month === 'All' ? 'all months' : monthLabel(month); }

const GOT_SORT_GET = {
  name: r => r.player_name || '',
  status: r => statusLabel(achStatus(r)),
  std: r => r.std || null,
  rap: r => r.rap || null,
  bli: r => r.bli || null,
};

function gotVisibleRows() {
  const g = state.got;
  const s = g.search.trim().toLowerCase();
  let rows = g.rows.filter(r => !s || [r.player_name, r.fide_id, rowMobile(r)].some(v => String(v || '').toLowerCase().includes(s)));
  if (g.sort.key) rows = sortRows(rows, GOT_SORT_GET[g.sort.key], g.sort.dir);
  return rows;
}

function renderGot() {
  const g = state.got;
  const rows = gotVisibleRows();
  Q('csaKpis_got').innerHTML = !g.loaded ? '' :
    kpi('New FIDE ratings', fmtNum(rows.length), C.blue, g.month === 'All' ? 'All months' : monthLabel(g.month))
    + kpi('Classical', fmtNum(rows.filter(r => r.std).length), '#2563EB', 'first standard rating')
    + kpi('Rapid', fmtNum(rows.filter(r => r.rap).length), '#0D9488', 'first rapid rating')
    + kpi('Blitz', fmtNum(rows.filter(r => r.bli).length), '#7C3AED', 'first blitz rating');

  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'Mobile' }, { label: 'Consent', center: true },
    { label: 'Status', sort: 'status' }, { label: 'Classical', sort: 'std', num: true }, { label: 'Rapid', sort: 'rap', num: true },
    { label: 'Blitz', sort: 'bli', num: true }, { label: 'First rated' }, { label: '', w: '1%' },
  ];
  const thead = '<thead><tr>' + cols.map(c => thCell('got', c)).join('') + '</tr></thead>';
  // 'All months' shows each type's own first-rating month under the rating.
  const cell = (v, per) => v
    ? '<span style="color:' + C.blue + ';font-weight:700;">' + v + '</span>'
      + (g.month === 'All' && per ? '<div style="font-size:11px;color:' + C.sub + ';white-space:nowrap;">' + esc(monthLabel(per)) + '</div>' : '')
    : '<span style="' + MUTED + '">—</span>';
  let body;
  if (!g.loaded) body = emptyRow(cols.length, 'Loading ratings…');
  else if (!rows.length) {
    body = emptyRow(cols.length, g.rows.length ? 'No players match this search.'
      : 'No players saved for ' + esc(gotMonthLabel(g.month)) + '. Use “Fetch from API” to check a month, or “Fetch all ratings”.');
  } else {
    g.page = Math.min(g.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = g.page * PAGE_SIZE;
    body = rows.slice(offset, offset + PAGE_SIZE).map((r, i) => {
      const mobile = rowMobile(r);
      return '<tr>'
        + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (offset + i + 1) + '</td>'
        + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, mobile) + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(mobile || '—') + '</td>'
        + '<td style="' + TD + 'text-align:center;">' + consentCell(r.fide_id, r.player_name, mobile) + '</td>'
        + '<td style="' + TD + '">' + statusChip(achStatus(r)) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.std, r.stdP) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.rap, r.rapP) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.bli, r.bliP) + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(r.period ? monthLabel(r.period) : '—') + '</td>'
        + '<td style="' + TD + '"><button data-a="poster-got" data-i="' + r._i + '" style="' + GHOST + 'padding:5px 11px;font-size:12px;color:' + C.blue + ';">' + icon('image', 13) + 'Poster</button></td>'
        + '</tr>';
    }).join('');
  }
  Q('csaTable_got').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_got').innerHTML = g.loaded ? pagerHtml('got', g.page, rows.length) : '';
}

async function loadGot(note) {
  const g = state.got;
  const month = g.month;
  const seq = ++g.seq;
  const prefix = note ? note + ' · ' : '';
  const cached = g.cache[month];
  if (cached) {
    g.rows = cached.map((rec, i) => gotRowFor(rec, month, i));
    g.loaded = true;
    setStatus('got', prefix + cached.length + ' players for ' + gotMonthLabel(month) + ' · refreshing…', note ? 'ok' : '');
  } else {
    g.loaded = false;
    g.page = 0;
    setStatus('got', prefix + 'Loading…', note ? 'ok' : '');
  }
  renderGot();
  renderTabs();
  try {
    const recs = await loadGotRecords(month);
    if (seq !== g.seq) return;
    g.cache[month] = recs;
    g.rows = recs.map((rec, i) => gotRowFor(rec, month, i));
    g.loaded = true;
    if (!cached) g.page = 0;
    setStatus('got', prefix + g.rows.length + ' players for ' + gotMonthLabel(month), note ? 'ok' : '');
  } catch (e) {
    if (seq !== g.seq) return;
    console.error('[csa] got rating load failed', e);
    g.loaded = true;
    setStatus('got', cached ? 'Showing the earlier copy — could not refresh.' : 'Could not load ratings: ' + errMsg(e, 'unknown error'), 'err');
  }
  renderGot();
  renderTabs();
}

function confirmFetchGot() {
  const month = state.got.month;
  if (state.got.busy || !month) return;
  if (month === 'All') { setStatus('got', 'Select a month to fetch, or use “Fetch all ratings”.', 'err'); return; }
  openConfirm('Fetch FIDE ratings', 'Fetch FIDE ratings for <b>' + esc(monthLabel(month)) + '</b>?'
    + '<div style="margin-top:8px;color:' + C.sub + ';">Checks players active in that month. Players who already have a rating saved (any month) are skipped.</div>',
  'Fetch ratings', () => fetchGot(month));
}

function confirmFetchAllRatings() {
  if (state.got.busy) return;
  openConfirm('Fetch all ratings', 'Fetch the <b>first FIDE rating</b> of every active or expired player (status 1 and 2) who has no rating saved yet?'
    + '<div style="margin-top:8px;color:' + C.sub + ';">No month filter: every FIDE ID is checked, and the first Classical, Rapid and Blitz rating are saved, each with the month (period) it first appeared on a FIDE rating list; '
    + 'from then on the monthly fetch skips them. Players with no FIDE rating yet are not saved and stay in the monthly check. '
    + 'This checks every player, so it can take several minutes.</div>',
  'Fetch all ratings', () => fetchGot(null));
}

// FIDE rating history, first source that answers:
//   1. Vercel /api/fide-history (FIDE's own rating-chart data, then chesstools, server-side)
//   2. chesstools directly from the browser
// → { ok:true, data:[{ period:'YYYY-MM', classical_rating, rapid_rating, blitz_rating }], source, name }
//   { ok:false, error }
async function fideHistory(fid) {
  const errors = [];
  try {
    const d = await extRequest('get', PROXY_BASE + '/api/fide-history', { fide_id: fid }, undefined, 45000);
    if (d && d.ok) return { ok: true, data: d.data || [], source: d.source || 'proxy', name: d.name || '' };
    errors.push('proxy: ' + ((d && d.error) || 'bad response'));
  } catch (e) { errors.push('proxy: ' + errMsg(e, 'failed')); }
  try {
    const d = await extRequest('get', 'https://api.chesstools.org/fide/player_history/', { fide_id: fid }, undefined, 10000);
    if (Array.isArray(d)) return { ok: true, data: d, source: 'chesstools', name: '' };
    errors.push('chesstools: bad response');
  } catch (e) { errors.push('chesstools: ' + errMsg(e, 'failed')); }
  return { ok: false, error: errors.join('; ') };
}

// ── Fetch log pop-up (Got Rating fetches): FIDE ID | player | fetched | source | status ──
const LOG_STATUS = {
  queued: { label: 'Queued', ink: C.mute },
  checking: { label: 'Checking…', ink: C.blue },
  saved: { label: 'Saved', ink: C.green },
  skipped: { label: 'Already rated — skipped', ink: C.sub },
  unrated: { label: 'No FIDE rating yet', ink: C.amber },
  other: { label: 'No new rating this month', ink: C.sub },
  error: { label: 'Error', ink: C.red },
  stopped: { label: 'Not checked (stopped)', ink: C.mute },
};
const LOG_FILTERS = [
  ['all', 'All', null], ['saved', 'Saved', ['saved']], ['unrated', 'Not rated', ['unrated', 'other']],
  ['skipped', 'Already rated', ['skipped']], ['error', 'Errors', ['error']],
];

function startLog(title, todo, skipped) {
  const rows = todo.map(p => ({ fid: String(p.fide_id), name: p.player_name, fetched: '', source: '', status: 'queued', detail: '' }))
    .concat(skipped.map(p => ({ fid: String(p.fide_id), name: p.player_name, fetched: '', source: '', status: 'skipped', detail: '' })));
  state.got.log = { title, rows, byFid: new Map(rows.map(r => [r.fid, r])), filter: 'all', running: true, result: '' };
  openLog();
}

function logUpdate(fid, patch) {
  const row = state.got.log && state.got.log.byFid.get(String(fid));
  if (row) Object.assign(row, patch);
  scheduleLogRender();
}

function openLog() {
  const log = state.got.log;
  if (!log) { setStatus('got', 'No fetch has run yet — the log appears when you fetch ratings.', 'err'); return; }
  openModal('fetchlog', 1000, modalShell('star', esc(log.title), 'Live status per player · closing this window does not stop the fetch',
    '<div id="csaLogHead"></div>'
    + '<div style="overflow:auto;max-height:480px;border:1px solid ' + C.line + ';border-radius:10px;"><table style="min-width:860px;"><thead><tr>'
    + ['#', 'FIDE ID', 'Player', 'Fetched', 'Source', 'Status'].map(h => '<th style="' + TH + 'position:sticky;top:0;">' + h + '</th>').join('')
    + '</tr></thead><tbody id="csaLogBody"></tbody></table></div>'));
  renderLog();
}

let logTimer = null;
function scheduleLogRender() {
  if (logTimer) return;
  logTimer = setTimeout(() => { logTimer = null; renderLog(); }, 250);
}

function renderLog() {
  const log = state.got.log;
  if (!log || !state.modal || state.modal.kind !== 'fetchlog' || !Q('csaLogBody')) return;
  const count = sts => log.rows.filter(r => !sts || sts.includes(r.status)).length;
  const total = log.rows.filter(r => r.status !== 'skipped').length;
  const checked = log.rows.filter(r => !['queued', 'checking', 'skipped', 'stopped'].includes(r.status)).length;
  const pct = total ? Math.round(checked / total * 100) : 100;
  const chip = f => '<button data-a="log-filter" data-filter="' + f[0] + '" style="' + tabStyle(log.filter === f[0]) + 'padding:5px 11px;font-size:12.5px;">'
    + f[1] + ' <span style="opacity:.7;">' + count(f[2]) + '</span></button>';
  Q('csaLogHead').innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">'
    + '<div style="font-weight:700;">Checked ' + fmtNum(checked) + ' / ' + fmtNum(total) + '</div>'
    + '<span style="' + (log.running ? PILL(C.blueLt, C.blueDk, '#DBEAFE') : PILL('#ECFDF5', '#047857', '#A7F3D0')) + '">' + (log.running ? (state.got.stop ? 'Stopping…' : 'Running') : 'Finished') + '</span>'
    + '<div style="flex:1;"></div>'
    + (log.running && !state.got.stop ? '<button data-a="fetch-stop" style="' + GHOST + 'color:' + C.red + ';">' + icon('x', 14) + 'Stop</button>' : '')
    + '</div>'
    + '<div style="height:6px;border-radius:999px;background:' + C.line + ';overflow:hidden;margin-bottom:10px;"><div style="height:100%;width:' + pct + '%;background:' + C.blue + ';border-radius:999px;transition:width .25s;"></div></div>'
    + (log.result ? '<div style="font-size:12.5px;color:#047857;font-weight:600;margin-bottom:10px;">' + esc(log.result) + '</div>' : '')
    + '<div style="' + SEG + 'margin-bottom:10px;">' + LOG_FILTERS.map(chip).join('') + '</div>';
  const f = LOG_FILTERS.find(x => x[0] === log.filter) || LOG_FILTERS[0];
  const rows = log.rows.filter(r => !f[2] || f[2].includes(r.status));
  Q('csaLogBody').innerHTML = rows.length ? rows.map((r, i) => {
    const st = LOG_STATUS[r.status] || LOG_STATUS.queued;
    const fetched = r.fetched === 'yes' ? '<span style="color:' + C.green + ';font-weight:600;">Yes</span>'
      : r.fetched === 'no' ? '<span style="color:' + C.red + ';font-weight:600;">No</span>' : '<span style="' + MUTED + '">—</span>';
    return '<tr>'
      + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (i + 1) + '</td>'
      + '<td style="' + TD + 'font-variant-numeric:tabular-nums;">' + esc(r.fid) + '</td>'
      + '<td style="' + TD + 'font-weight:600;">' + esc(r.name || '—') + '</td>'
      + '<td style="' + TD + '">' + fetched + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(r.source || '—') + '</td>'
      + '<td style="' + TD + '"><span style="color:' + st.ink + ';font-weight:600;">' + st.label + '</span>'
      + (r.detail ? '<div style="font-size:11.5px;color:' + (r.status === 'error' ? C.red : C.sub) + ';word-break:break-word;">' + esc(r.detail) + '</div>' : '') + '</td>'
      + '</tr>';
  }).join('') : emptyRow(6, 'No players in this group.');
  fitRootToModal();
}

// fide_ids with a Got Rating record in any month -- never checked again.
async function ratedFideIds() {
  const recs = await fetchAll(TBL.got, { fields: 'id,fide_id' });
  return new Set(recs.map(r => String(r.fide_id).trim()));
}

// First rating of each type from a player's FIDE history (oldest first):
// { std: { rating, key: '2026-Aug' }, rap: …, bli: … } — types never rated are absent.
function firstRatings(hist) {
  const out = {};
  GOT_TYPES.forEach(t => {
    const h = hist.find(x => Number(x[t.rating]) > 0);
    if (h) out[t.key] = { rating: Number(h[t.rating]), key: normalizePeriod(h.period) };
  });
  return out;
}

// month "2026-Aug": monthly check of players active that month;
// month null: "Fetch all ratings" for every player.
// Either way players who already have a Got Rating record are skipped.
async function fetchGot(month) {
  const g = state.got;
  g.busy = true;
  g.stop = false;
  Q('csaFetch_got').disabled = true;
  Q('csaFetchAll_got').disabled = true;
  setProgress('got', 0);
  try {
    setStatus('got', 'Loading player list…');
    let srcPlayers;
    if (month) {
      await loadPlayers();
      srcPlayers = state.players;
      const firstOfMonth = monthKeyToDate(month);
      // Active in the month = subscription_start_date <= 1st of month <= subscription_end_date
      srcPlayers = srcPlayers.filter(p => p.subscription_start_date && p.subscription_end_date
        && parseYMD(p.subscription_start_date) <= firstOfMonth && firstOfMonth <= parseYMD(p.subscription_end_date));
    } else {
      // "Fetch all ratings" also covers expired (status 2) students.
      srcPlayers = await fetchPlayerList([1, 2]);
    }
    if (!srcPlayers.length) { setStatus('got', month ? 'No players active in ' + monthLabel(month) + '.' : 'No players found.', 'err'); return; }

    setStatus('got', 'Checking players who already have a rating…');
    const rated = await ratedFideIds();
    const todo = srcPlayers.filter(p => !rated.has(String(p.fide_id).trim()));
    const alreadyRated = srcPlayers.length - todo.length;
    startLog(month ? 'Fetch ratings — ' + monthLabel(month) : 'Fetch all ratings',
      todo, srcPlayers.filter(p => rated.has(String(p.fide_id).trim())));

    // "Fetch all ratings" saves each player under their own first-rating month: show all months.
    if (!month && g.month !== 'All') {
      g.month = 'All';
      Q('csaPanel_got').querySelector('select[data-c="month"]').value = 'All';
      await loadGot();
    }

    let done = 0, apiErrors = 0, savedCount = 0, failed = 0;
    // Saved right away; shown in the table if it belongs to the month on screen.
    const saveRec = async rec => {
      try {
        const created = (await dbCreate(TBL.got, rec)) || rec;
        savedCount++;
        state.stats.loaded = false; // stats are rebuilt next time
        const view = g.month;
        if (view === 'All' || GOT_TYPES.some(t => rec[t.period] === periodToDb(view))) {
          if (g.cache[view]) g.cache[view].push(created);
          if (g.loaded) {
            g.rows.push(gotRowFor(created, view, g.rows.length));
            renderGot();
            renderTabs();
          }
        }
        return '';
      } catch (e) {
        failed++;
        console.error('[csa] rating save failed', rec, e);
        return errMsg(e, 'save failed');
      }
    };
    setStatus('got', 'Fetching 0 / ' + todo.length + ' players…');
    await runPool(todo, GOT_PARALLEL, async player => {
      const fid = String(player.fide_id);
      if (g.stop) { logUpdate(fid, { status: 'stopped' }); return; }
      logUpdate(fid, { status: 'checking' });
      try {
        const resp = await fideHistory(player.fide_id);
        if (!resp.ok) { apiErrors++; logUpdate(fid, { fetched: 'no', status: 'error', detail: resp.error }); return; }
        logUpdate(fid, { fetched: 'yes', source: resp.source });
        const hist = (resp.data || []).slice().sort((a, b) => new Date(a.period + '-01') - new Date(b.period + '-01'));
        const first = firstRatings(hist);
        const types = Object.keys(first);
        const firstText = GOT_TYPES.filter(t => first[t.key]).map(t => t.label + ' ' + first[t.key].rating + ' (' + monthLabel(first[t.key].key) + ')').join(', ');
        if (!types.length) { logUpdate(fid, { status: 'unrated' }); return; } // never rated
        if (month && !types.some(k => first[k].key === month)) { logUpdate(fid, { status: 'other', detail: 'First rated: ' + firstText }); return; }
        // FIDE spelling of the name, used for display + DB
        let name = resp.name || player.player_name;
        if (!resp.name) {
          try {
            const info = await extRequest('get', 'https://api.chesstools.org/fide/player_info/', { fide_id: player.fide_id, history: 'false' }, undefined, 8000);
            if (info && info.name) name = info.name;
          } catch (e) { /* keep registered name */ }
        }
        // All fields are text in cc_csoc_got_rating.
        const rec = { player_name: name, fide_id: String(player.fide_id), mobile_number: player.mobile_number ? String(player.mobile_number) : null };
        GOT_TYPES.forEach(t => {
          rec[t.rating] = first[t.key] ? String(first[t.key].rating) : null;
          rec[t.period] = first[t.key] ? periodToDb(first[t.key].key) : null;
        });
        const saveErr = await saveRec(rec);
        logUpdate(fid, saveErr ? { status: 'error', detail: 'Save failed: ' + saveErr } : { status: 'saved', name, detail: firstText });
      } catch (e) {
        apiErrors++;
        logUpdate(fid, { status: 'error', detail: errMsg(e, 'unknown error') });
      } finally {
        done++;
        setProgress('got', done / todo.length * 100);
        setStatus('got', 'Checked ' + done + ' / ' + todo.length + ' players — ' + savedCount + ' new ratings saved' + (failed ? ', ' + failed + ' failed' : '') + '…');
      }
    });

    const note = (g.stop ? 'Stopped: ' : 'Fetch done: ') + savedCount + ' new saved, ' + alreadyRated + ' already rated (skipped)'
      + (apiErrors ? ', ' + apiErrors + ' errors' : '') + (failed ? ' — ' + failed + ' could not be saved (see console)' : '');
    g.log.running = false;
    g.log.result = note;
    renderLog();
    if (savedCount) g.cache = {};
    loadGot(note);
  } catch (e) {
    console.error('[csa] fetch got rating failed', e);
    setStatus('got', 'Fetch failed: ' + errMsg(e, 'unknown error'), 'err');
    if (g.log && g.log.running) { g.log.running = false; g.log.result = 'Fetch failed: ' + errMsg(e, 'unknown error'); renderLog(); }
  } finally {
    g.busy = false;
    Q('csaFetch_got').disabled = false;
    Q('csaFetchAll_got').disabled = false;
    setProgress('got', null);
  }
}

// ── 3. Rating Stats ─────────────────────────────────────────────────────────
const STAT_GROUPS = [
  { key: 'active', label: 'Active', head: '#D1FAE5', headInk: '#065F46', cell: '#F0FDF4', ink: C.green },
  { key: 'nonactive', label: 'Non-Active', head: '#FEE2E2', headInk: '#991B1B', cell: '#FFF5F5', ink: C.red },
];
const STAT_COLS = [['all', 'Total'], ['std', 'Classical'], ['rap', 'Rapid'], ['bli', 'Blitz']];

async function loadStats() {
  const s = state.stats;
  s.loading = true;
  renderStats();
  try {
    const [recs] = await Promise.all([loadGotRecords(null), loadPlayers()]);
    // One row per player per month in which they first got a rating type.
    s.rows = [];
    recs.forEach(rec => {
      const r = gotRecord(rec);
      if (!r.fide_id) return;
      new Set(GOT_TYPES.map(t => r[t.key + 'P']).filter(Boolean)).forEach(per => s.rows.push(gotRowFor(rec, per, 0)));
    });
    // Group by period; active = subscription covers the 1st of that month.
    const monthMap = {};
    s.rows.forEach(r => {
      const pd = MON_ABBR.indexOf(r.period.split('-')[1]) >= 0 ? monthKeyToDate(r.period) : null;
      const player = playerById(r.fide_id);
      let isActive = false;
      if (pd && player) {
        const start = parseYMD(player.subscription_start_date), end = parseYMD(player.subscription_end_date);
        if (start && end) isActive = pd >= start && pd <= end;
      }
      const m = monthMap[r.period] || (monthMap[r.period] = { active: [], nonactive: [] });
      m[isActive ? 'active' : 'nonactive'].push({ ...r, player });
    });
    s.monthMap = monthMap;
    s.periods = Object.keys(monthMap).sort(monthSortDesc);
    if (s.period && !monthMap[s.period]) s.period = '';
    s.loaded = true;
    s.error = '';
  } catch (e) {
    console.error('[csa] stats load failed', e);
    s.error = errMsg(e, 'unknown error');
  }
  s.loading = false;
  renderStats();
}

function statList(period, group, col) {
  const list = (state.stats.monthMap[period] || {})[group] || [];
  return col === 'all' ? list : list.filter(r => r[col] > 0);
}

function renderStats() {
  const s = state.stats;
  const host = Q('csaPanel_stats');
  const head = panelHead('Rating Stats', 'First FIDE ratings per month, split by whether the student’s subscription was active that month. Click a count to see the players.');
  if (!s.loaded) {
    host.innerHTML = head + '<div style="' + CARD + 'padding:44px;text-align:center;color:' + (s.error ? '#B91C1C' : C.sub) + ';">'
      + (s.loading || !s.error ? 'Loading stats…' : esc('Could not load stats: ' + s.error) + '<div style="margin-top:12px;"><button data-a="stats-refresh" style="' + GHOST + '">' + icon('refresh', 14) + 'Retry</button></div>')
      + '</div>';
    return;
  }
  const thS = 'padding:9px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;border:1px solid ' + C.line + ';text-align:center;white-space:nowrap;';
  const tdS = 'padding:9px 12px;font-size:13px;border:1px solid ' + C.line + ';text-align:center;';
  let table = '<table style="min-width:820px;"><thead><tr>'
    + '<th rowspan="2" style="' + thS + 'text-align:left;background:' + C.thead + ';color:' + C.sub + ';">Month</th>'
    + STAT_GROUPS.map(gr => '<th colspan="4" style="' + thS + 'background:' + gr.head + ';color:' + gr.headInk + ';">' + gr.label + '</th>').join('')
    + '</tr><tr>'
    + STAT_GROUPS.map(gr => STAT_COLS.map(c => '<th style="' + thS + 'background:' + gr.head + ';color:' + gr.headInk + ';opacity:.9;">' + c[1] + '</th>').join('')).join('')
    + '</tr></thead><tbody>';
  const totals = {};
  s.periods.forEach(p => {
    table += '<tr><td style="' + tdS + 'text-align:left;font-weight:600;white-space:nowrap;">' + esc(monthLabel(p)) + '</td>'
      + STAT_GROUPS.map(gr => STAT_COLS.map(c => {
        const n = statList(p, gr.key, c[0]).length;
        totals[gr.key + c[0]] = (totals[gr.key + c[0]] || 0) + n;
        return n
          ? '<td class="csa-cell" data-a="stats-list" data-period="' + esc(p) + '" data-group="' + gr.key + '" data-col="' + c[0] + '" style="' + tdS + 'background:' + gr.cell + ';color:' + gr.ink + ';font-weight:700;">' + n + '</td>'
          : '<td style="' + tdS + MUTED + '">—</td>';
      }).join('')).join('')
      + '</tr>';
  });
  table += '<tr><td style="' + tdS + 'text-align:left;font-weight:700;background:' + C.thead + ';">Total</td>'
    + STAT_GROUPS.map(gr => STAT_COLS.map(c => '<td style="' + tdS + 'font-weight:700;background:' + C.thead + ';">' + (totals[gr.key + c[0]] || 0) + '</td>').join('')).join('')
    + '</tr></tbody></table>';

  const activeTotal = s.periods.reduce((n, p) => n + statList(p, 'active', 'all').length, 0);
  const kpis = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">'
    + kpi('Total records', fmtNum(s.rows.length), C.blue, s.periods.length + ' months')
    + kpi('Active students', fmtNum(activeTotal), '#10B981', 'subscription active that month')
    + kpi('Non-active', fmtNum(s.rows.length - activeTotal), '#EF4444', 'expired / not subscribed')
    + '</div>';

  const detail = s.rows.filter(r => !s.period || r.period === s.period)
    .sort((a, b) => monthSortDesc(a.period, b.period) || a.player_name.localeCompare(b.player_name));
  const periodOpts = '<option value="">All periods</option>' + s.periods.map(p => '<option value="' + esc(p) + '"' + (p === s.period ? ' selected' : '') + '>' + esc(monthLabel(p)) + '</option>').join('');
  const dCell = v => v ? v : '<span style="' + MUTED + '">—</span>';
  const detailRows = detail.length ? detail.map((r, i) => '<tr>'
    + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (i + 1) + '</td>'
    + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, rowMobile(r)) + '</td>'
    + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(rowMobile(r) || '—') + '</td>'
    + '<td style="' + TD + 'text-align:right;">' + dCell(r.std) + '</td>'
    + '<td style="' + TD + 'text-align:right;">' + dCell(r.rap) + '</td>'
    + '<td style="' + TD + 'text-align:right;">' + dCell(r.bli) + '</td>'
    + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(monthLabel(r.period)) + '</td>'
    + '</tr>').join('') : emptyRow(7, 'No records.');

  host.innerHTML = head + kpis
    + '<div style="' + CARD + 'margin-bottom:16px;">'
    + '<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid ' + C.line + ';flex-wrap:wrap;">'
    + '<div style="font-weight:700;font-size:14px;flex:1;">Monthly summary</div>'
    + '<button data-a="stats-refresh" style="' + GHOST + '">' + icon('refresh', 14) + 'Refresh</button></div>'
    + '<div style="overflow-x:auto;padding:14px 16px;">' + (s.periods.length ? table : '<div style="color:' + C.sub + ';text-align:center;padding:24px;">No Got Rating records yet.</div>') + '</div></div>'
    + '<div style="' + CARD + '">'
    + '<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid ' + C.line + ';flex-wrap:wrap;">'
    + '<div style="font-weight:700;font-size:14px;">Got Rating records</div>'
    + '<span style="' + PILL(C.blueLt, C.blueDk, '#DBEAFE') + '">' + detail.length + '</span>'
    + '<div style="flex:1;"></div>'
    + '<select data-c="stats-period" style="' + INP + 'min-width:170px;cursor:pointer;">' + periodOpts + '</select>'
    + '<button data-a="stats-csv" style="' + BTN(C.blue) + '">' + icon('download', 14) + 'Download CSV</button></div>'
    + '<div style="overflow:auto;max-height:560px;"><table style="min-width:760px;"><thead><tr>'
    + ['#', 'Player', 'Mobile', 'Classical', 'Rapid', 'Blitz', 'Period'].map((h, i) => '<th style="' + TH + 'position:sticky;top:0;' + (i >= 3 && i <= 5 ? 'text-align:right;' : '') + '">' + h + '</th>').join('')
    + '</tr></thead><tbody>' + detailRows + '</tbody></table></div></div>';
}

function downloadStatsCsv() {
  const s = state.stats;
  const rows = s.rows.filter(r => !s.period || r.period === s.period);
  const csv = 'Player Name,Mobile,Classical,Rapid,Blitz,Period\n' + rows.map(r =>
    [r.player_name, rowMobile(r), r.std, r.rap, r.bli, r.period].map(v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"').join(',')
  ).join('\n');
  downloadHref('data:text/csv;charset=utf-8,%EF%BB%BF' + encodeURIComponent(csv), 'got_rating' + (s.period ? '_' + s.period : '') + '.csv');
}

function openStatsList(period, group, col) {
  const list = statList(period, group, col);
  const gr = STAT_GROUPS.find(x => x.key === group);
  const colLabel = (STAT_COLS.find(c => c[0] === col) || [])[1];
  const rows = list.map((r, i) => {
    const p = r.player || {};
    return '<tr>'
      + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (i + 1) + '</td>'
      + '<td style="' + TD + 'font-weight:600;">' + esc(r.player_name || p.player_name || '—') + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(rowMobile(r) || '—') + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';">' + esc(r.fide_id || '—') + '</td>'
      + '<td style="' + TD + 'white-space:nowrap;">' + esc(fmtYMD(p.subscription_start_date) || '—') + '</td>'
      + '<td style="' + TD + 'white-space:nowrap;">' + esc(fmtYMD(p.subscription_end_date) || '—') + '</td>'
      + '<td style="' + TD + 'text-align:right;">' + (r.std || '—') + '</td>'
      + '<td style="' + TD + 'text-align:right;">' + (r.rap || '—') + '</td>'
      + '<td style="' + TD + 'text-align:right;">' + (r.bli || '—') + '</td></tr>';
  }).join('');
  openModal('list', 1000, modalShell('users', esc(monthLabel(period)) + ' — ' + gr.label + (col === 'all' ? '' : ' ' + colLabel), list.length + ' players',
    '<div style="overflow:auto;max-height:520px;border:1px solid ' + C.line + ';border-radius:10px;"><table style="min-width:860px;"><thead><tr>'
    + ['#', 'Name', 'Mobile', 'FIDE ID', 'Sub start', 'Sub end', 'Classical', 'Rapid', 'Blitz'].map((h, i) => '<th style="' + TH + 'position:sticky;top:0;' + (i >= 6 ? 'text-align:right;' : '') + '">' + h + '</th>').join('')
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'));
}

// ── Modal shell ─────────────────────────────────────────────────────────────
function modalShell(iconName, title, subtitle, body) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid ' + C.line + ';">'
    + '<div style="width:38px;height:38px;border-radius:10px;background:' + C.blueLt + ';color:' + C.blue + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + icon(iconName, 19) + '</div>'
    + '<div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:700;letter-spacing:-.01em;">' + title + '</div>'
    + (subtitle ? '<div style="color:' + C.sub + ';font-size:12.5px;margin-top:1px;">' + subtitle + '</div>' : '')
    + '</div><button data-a="close" title="Close" style="' + GHOST + 'padding:7px;">' + icon('x', 16) + '</button></div>'
    + '<div id="csaModalMsg" style="display:none;margin:14px 22px 0;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:500;border:1px solid transparent;"></div>'
    + '<div style="padding:18px 22px 22px;">' + body + '</div>';
}

function modalMessage(text, type) {
  const el = Q('csaModalMsg');
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  const isError = type === 'error';
  el.innerHTML = '<span style="display:flex;align-items:center;gap:8px;">' + icon(isError ? 'alert' : 'checkCircle', 16) + '<span>' + esc(text) + '</span></span>';
  el.style.background = isError ? '#FEF2F2' : '#ECFDF5';
  el.style.borderColor = isError ? '#FECACA' : '#A7F3D0';
  el.style.color = isError ? '#B91C1C' : '#047857';
  el.style.display = 'block';
  fitRootToModal();
}

// The backdrop covers the whole widget (position:absolute, not fixed -- see
// header), so a modal pinned to the widget's top is off-screen once the page
// is scrolled down. Place it at whatever part of the widget is currently at
// the top of the viewport, and grow #csa if needed so the backdrop still
// covers the whole modal.
function positionModal() {
  const rect = Q('csa').getBoundingClientRect();
  Q('csaModal').style.marginTop = (Math.max(0, -rect.top) + 16) + 'px';
}
function fitRootToModal() {
  const modal = Q('csaModal');
  if (!state.modal || !modal) return;
  Q('csa').style.minHeight = Math.max(520, modal.offsetTop + modal.offsetHeight + 24) + 'px';
}

function openModal(kind, width, html, extra) {
  state.modal = { kind, ...(extra || {}) };
  Q('csaBackdrop').style.display = 'block';
  Q('csaModal').style.maxWidth = width + 'px';
  Q('csaModal').innerHTML = html;
  positionModal();
  fitRootToModal();
}

function closeModal() {
  state.modal = null;
  state.poster.modal = null;
  Q('csaBackdrop').style.display = 'none';
  Q('csaModal').innerHTML = '';
  Q('csa').style.minHeight = '520px';
}

// In-block replacement for confirm() (not available in the sandbox).
function openConfirm(title, html, okLabel, onOk) {
  openModal('confirm', 480, modalShell('info', title, '',
    '<div style="font-size:13.5px;color:' + C.ink2 + ';line-height:1.55;">' + html + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
    + '<button data-a="close" style="' + GHOST + '">Cancel</button>'
    + '<button data-a="confirm-ok" style="' + BTN(C.blue) + '">' + esc(okLabel) + '</button></div>'), { onOk });
}

function openPlayerInfo(fid, name, mobile) {
  const p = playerById(fid) || {};
  const rows = [
    ['Player', p.player_name || name || '—'],
    ['Mobile', p.mobile_number || mobile || '—'],
    ['FIDE ID', fid || '—'],
    ['Status', statusLabel(p.status) || '—'],
    ['Subscription start', fmtYMD(p.subscription_start_date) || '—'],
    ['Subscription end', fmtYMD(p.subscription_end_date) || '—'],
  ];
  const fideLink = fid
    ? '<a href="https://ratings.fide.com/profile/' + esc(fid) + '" target="_blank" rel="noopener noreferrer" style="' + GHOST + 'text-decoration:none;color:' + C.blue + ';">' + icon('externalLink', 14) + 'FIDE profile</a>'
    : '';
  openModal('player', 440, modalShell('user', esc(p.player_name || name || 'Player'), fid ? 'FIDE ID ' + esc(fid) : '',
    '<div style="border:1px solid ' + C.line + ';border-radius:10px;overflow:hidden;">' + rows.map((r, i) =>
      '<div style="display:flex;gap:12px;padding:10px 14px;' + (i ? 'border-top:1px solid ' + C.grid + ';' : '') + '">'
      + '<div style="width:140px;color:' + C.sub + ';font-size:12.5px;">' + r[0] + '</div>'
      + '<div style="flex:1;font-weight:600;word-break:break-word;">' + esc(r[1]) + '</div></div>').join('') + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' + fideLink
    + '<button data-a="close" style="' + BTN(C.blue) + '">Done</button></div>'));
}

// ── 4. Posters (canvas) ─────────────────────────────────────────────────────
const POSTER_TYPES = {
  achiever: { label: 'Achiever', icon: 'trophy' },
  rating: { label: 'Rating gained', icon: 'trendingUp' },
  rating_achieved: { label: 'Rating achieved', icon: 'award' },
};
const POSTER_COLORS = ['#1565C0', '#d4a832', '#c0392b', '#1e7a3e', '#6b21a8', '#ff6b6b', '#f7a440', '#4dabf7', '#da77f2', '#38d9a9'];

function rankToOrdinal(n) {
  const names = ['', 'First', 'Runner-Up', 'Second Runner-Up', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
  return n >= 1 && n <= 9 ? names[n] : 'Position ' + n;
}

function buildAchText(r) {
  if (r.rank && r.rank < 10) {
    let pos = 'Secured ' + rankToOrdinal(r.rank);
    if (r.is_rated && r.rating_change >= 30) pos += '  ·  +' + r.rating_change + ' pts';
    return pos;
  }
  return r.rating_change !== null ? (r.rating_change > 0 ? '+' : '') + r.rating_change + ' Rating Points' : 'Tournament Result';
}

function darkenColor(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = v => Math.max(0, Math.round(v * (1 - amt))).toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 0xff) + ch((n >> 8) & 0xff) + ch(n & 0xff);
}
function lightenColor(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = v => Math.min(255, Math.round(v + (255 - v) * amt)).toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 0xff) + ch((n >> 8) & 0xff) + ch(n & 0xff);
}

// Images are created through innerHTML (no `new Image()` / document in the sandbox).
let imgSeq = 0;
function loadImg(src, cors) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return; }
    const id = 'csaImg' + (++imgSeq);
    Q('csaImgs').insertAdjacentHTML('beforeend', '<img id="' + id + '"' + (cors ? ' crossorigin="anonymous"' : '') + ' alt="">');
    const img = Q(id);
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => { img.remove(); resolve(null); });
    img.src = src;
  });
}

let assetsPromise = null;
function loadAssets() {
  if (!assetsPromise) {
    const keys = Object.keys(ASSET_URLS);
    assetsPromise = Promise.all(keys.map(k => loadImg(ASSET_URLS[k], true)))
      .then(imgs => keys.reduce((acc, k, i) => { acc[k] = imgs[i]; return acc; }, {}));
  }
  return assetsPromise;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// Word-wraps text at (x, y); returns the baseline of the last line.
function wrapText(g, text, x, y, maxW, lh) {
  let line = '';
  String(text).split(' ').forEach(word => {
    const test = line ? line + ' ' + word : word;
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = word; y += lh; } else line = test;
  });
  if (line) g.fillText(line, x, y);
  return y;
}

// object-fit: contain
function drawContain(g, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  if (!iw || !ih) return;
  const s = Math.min(w / iw, h / ih);
  g.drawImage(im, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}
// object-fit: cover, clipped to a circle
function drawCircle(g, im, cx, cy, r) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  if (!iw || !ih) return;
  const side = Math.min(iw, ih);
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.drawImage(im, (iw - side) / 2, (ih - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
  g.restore();
}

// 540x700 poster, same layout as the site's dlPNG(). p: { type, name, pos, tourn, points, info, color }
function drawPoster(cv, p, img, photo, preview) {
  const W = 540, H = 700;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#1565C0';
  const ST = darkenColor(color, 0.28), BG = lightenColor(color, 0.6);
  const achieved = p.type === 'rating_achieved', gained = p.type === 'rating';

  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(100,180,140,0.42)';
  for (let dy = 12; dy < H; dy += 24) for (let dx = 12; dx < W; dx += 24) { g.beginPath(); g.arc(dx, dy, 2.5, 0, Math.PI * 2); g.fill(); }
  if (img.medal) g.drawImage(img.medal, -40, -1, 140, 220);

  // Left strip, rounded on the left side only
  const sx = 50, sy = 55, sw = 190, sh = 590, sr = 65;
  g.beginPath();
  g.moveTo(sx + sr, sy); g.lineTo(sx + sw, sy); g.lineTo(sx + sw, sy + sh); g.lineTo(sx + sr, sy + sh);
  g.quadraticCurveTo(sx, sy + sh, sx, sy + sh - sr); g.lineTo(sx, sy + sr); g.quadraticCurveTo(sx, sy, sx + sr, sy);
  g.closePath(); g.fillStyle = ST; g.fill();

  // Outlined vertical strip text: CHAMP, or RATING GAINED / RATING ACHIEVED in two columns
  const vLetter = (ch, x, y) => { g.save(); g.translate(x, y); g.rotate(-Math.PI / 2); g.strokeText(ch, 0, 0); g.restore(); };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (achieved || gained) {
    const fz1 = 76, fz2 = achieved ? 68 : 78, step1 = 58, step2 = achieved ? 56 : 60;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4;
    g.font = '900 ' + fz1 + 'px Arial,sans-serif';
    'RATING'.split('').reverse().forEach((ch, i) => vLetter(ch, sx + 75, sy + 18 + fz1 / 2 + i * step1));
    g.font = '900 ' + fz2 + 'px Arial,sans-serif';
    (achieved ? 'ACHIEVED' : 'GAINED').split('').reverse().forEach((ch, i) => vLetter(ch, sx + 155, sy + 18 + fz2 / 2 + i * step2));
  } else {
    g.font = '900 105px Arial,sans-serif'; g.strokeStyle = '#fff'; g.lineWidth = 5;
    ['P', 'M', 'A', 'H', 'C'].forEach((ch, k) => vLetter(ch, sx + 150, sy + 52 + k * 88));
  }

  // White panel
  const px = 238, py = 55, pw = 302, ph = 590, tx = px + 14, tw = pw - 28;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.13)'; g.shadowBlur = 16; g.shadowOffsetX = -5; g.shadowOffsetY = 4;
  g.fillStyle = '#fff'; g.fillRect(px, py, pw, ph); g.restore();
  g.strokeStyle = '#c0c0c0'; g.lineWidth = 1; g.strokeRect(px, py, pw, ph);
  if (img.logo) drawContain(g, img.logo, px + (pw - 180) / 2, py + 10, 180, 80);

  // Name: first word, then the rest; shrunk to fit the panel, wrapped if still too wide
  const words = String(p.name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const lines = words.length ? [words[0], words.slice(1).join(' ')].filter(Boolean) : ['STUDENT NAME'];
  let fz = 30;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const setNameFont = () => { g.font = '900 ' + fz + 'px Georgia,serif'; };
  setNameFont();
  while (fz > 20 && lines.some(l => g.measureText(l).width > tw)) { fz--; setNameFont(); }
  g.fillStyle = '#2c3e50';
  let y = py + 154 - fz;
  lines.forEach((l, i) => { y = wrapText(g, l, tx, y + (i ? Math.round(fz * 1.2) : fz), tw, Math.round(fz * 1.2)); });
  y += 8; g.fillStyle = ST; g.fillRect(tx, y, tw, 2.5); y += 2.5;

  let badgeY = null;
  if (achieved) {
    y += 10; badgeY = y;
    g.fillStyle = '#1565C0'; g.font = '900 15px Arial,sans-serif';
    g.fillText('ACHIEVED INTERNATIONAL', px + 62, y + 16);
    const frW = g.measureText('FIDE RATING').width + 40, frX = px + 62, frY = y + 20, frH = 22;
    roundRect(g, frX, frY, frW, frH, 6); g.fill();
    g.fillStyle = '#fff'; g.fillText('FIDE RATING', frX + 20, frY + frH - 5);
    y += 60;
    if (p.info) { g.fillStyle = '#3a4a5c'; g.font = '700 18px Arial,sans-serif'; y = wrapText(g, p.info, tx, y + 18, tw, 24) + 10; }
    y += 20;
  } else if (gained) {
    y += 8;
    const rpW = 108, rpH = 48;
    g.fillStyle = '#2196F3'; roundRect(g, tx, y, rpW, rpH, 10); g.fill();
    g.fillStyle = '#fff'; g.font = '900 24px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(p.points || '+0', tx + rpW / 2, y + rpH / 2);
    g.fillStyle = '#1a2a3a'; g.font = '900 13px Arial,sans-serif'; g.textAlign = 'left';
    g.fillText('POINTS', tx + rpW + 14, y + rpH / 2 - 9); g.fillText('GAINED', tx + rpW + 14, y + rpH / 2 + 9);
    g.textBaseline = 'alphabetic';
    y += rpH + 10;
    if (p.tourn) { g.fillStyle = '#2c3e50'; g.font = '600 16px Arial,sans-serif'; y = wrapText(g, p.tourn, tx, y + 16, tw, 20) + 6; }
    y += 20;
  } else {
    y += 15;
    if (p.pos) { g.fillStyle = '#3a4a5c'; g.font = '700 18px Arial,sans-serif'; y = wrapText(g, p.pos, tx, y + 18, tw, 24) + 10; }
    if (p.tourn) { g.fillStyle = '#2c3e50'; g.font = '600 16px Arial,sans-serif'; y = wrapText(g, p.tourn, tx, y + 16, tw, 20) + 10; }
    y += 10;
  }
  g.fillStyle = ST; g.globalAlpha = 0.45; g.fillRect(tx, y, tw, 2); g.globalAlpha = 1; y += 2;

  // "Proud Caissa School of Chess student" pill
  const plX = px + 10, plY = y + 20, plW = pw - 20, plH = 36;
  g.strokeStyle = '#e53935'; g.lineWidth = 1.5; roundRect(g, plX, plY, plW, plH, 18); g.stroke();
  g.font = '800 8.5px Arial,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let x = plX + 36;
  [['PROUD ', '#0a1825'], ['CAISSA SCHOOL OF CHESS', '#b83030'], [' STUDENT', '#0a1825']].forEach(seg => {
    g.fillStyle = seg[1]; g.fillText(seg[0], x, plY + plH / 2); x += g.measureText(seg[0]).width;
  });
  if (img.csoc) drawCircle(g, img.csoc, plX + 18, plY + plH / 2, 13);

  if (img.chess) {
    const chessY = plY + plH + 8, chessH = H - chessY + 80, chessW = Math.round(chessH * (360 / 450));
    drawContain(g, img.chess, W - chessW + 120, chessY, chessW, chessH);
  }
  if (achieved && img.badge) drawContain(g, img.badge, px + 9, badgeY - 11, 60, 60);

  // Student photo circle (placeholder only in the on-screen preview)
  if (photo || preview) {
    if (photo) drawCircle(g, photo, 145, 595, 95);
    else {
      g.fillStyle = '#aaa'; g.beginPath(); g.arc(145, 595, 95, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 15px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Add photo', 145, 595);
    }
    g.beginPath(); g.arc(145, 595, 95, 0, Math.PI * 2); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
  }
}

// Poster editor state lives per scope: 'modal' (from a table row) or 'custom' (tab).
function posterState(scope) { return state.poster[scope]; }

function posterEditorHtml(scope) {
  const p = posterState(scope);
  const field = (key, label, placeholder, type) => '<div style="margin-bottom:12px;"><label style="' + LBL + '">' + label + '</label>'
    + '<input data-pf="' + key + '" data-scope="' + scope + '"' + (type ? ' type="' + type + '"' : '') + ' value="' + esc(p[key] || '') + '" placeholder="' + esc(placeholder) + '" style="' + INP + 'width:100%;"></div>';
  const typeSeg = p.types.length > 1
    ? '<div style="margin-bottom:14px;"><label style="' + LBL + '">Poster type</label><div style="' + SEG + '">' + p.types.map(t =>
      '<button data-a="ptype" data-scope="' + scope + '" data-type="' + t + '" style="' + tabStyle(p.type === t) + 'padding:6px 11px;">' + icon(POSTER_TYPES[t].icon, 14) + POSTER_TYPES[t].label + '</button>').join('') + '</div></div>'
    : '';
  let fields = field('name', 'Student name', 'e.g. Magnus Carlsen');
  if (p.type === 'achiever') fields += field('pos', 'Position', 'e.g. Secured First') + field('tourn', 'Tournament', 'e.g. State Championship 2026');
  else if (p.type === 'rating') fields += field('points', 'Points gained', 'e.g. +111') + field('tourn', 'Tournament', 'e.g. State Championship 2026');
  else fields += field('info', 'Rating line', 'e.g. Classical 1550 · Rapid 1500');
  const swatches = POSTER_COLORS.map(c => '<button data-a="pcolor" data-scope="' + scope + '" data-color="' + c + '" title="' + c + '" style="width:24px;height:24px;border-radius:999px;cursor:pointer;background:' + c + ';'
    + (p.color.toLowerCase() === c.toLowerCase() ? 'border:2px solid #fff;box-shadow:0 0 0 2px ' + C.ink + ';' : 'border:2px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.15);') + '"></button>').join('');
  const photo = '<label style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px dashed ' + C.line2 + ';border-radius:10px;background:' + C.card + ';cursor:pointer;">'
    + (p.photo
      ? '<img src="' + p.photo + '" alt="" style="width:44px;height:44px;border-radius:999px;object-fit:cover;border:2px solid ' + C.blue + ';flex-shrink:0;">'
      : '<span style="width:44px;height:44px;border-radius:999px;background:' + C.blueLt + ';color:' + C.blue + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + icon('upload', 18) + '</span>')
    + '<span style="flex:1;min-width:0;font-size:12.5px;color:' + C.sub + ';"><b style="color:' + C.blue + ';">' + (p.photo ? 'Change photo' : 'Upload a photo') + '</b>'
    + '<span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.photoName || 'Optional — shown in the circle') + '</span></span>'
    + '<input type="file" accept="image/*" data-pf="photo" data-scope="' + scope + '" style="display:none;"></label>'
    + (p.photo ? '<button data-a="pphoto-clear" data-scope="' + scope + '" style="' + GHOST + 'margin-top:6px;padding:4px 10px;font-size:12px;color:' + C.red + ';">' + icon('x', 13) + 'Remove photo</button>' : '');
  return '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;">'
    + '<div style="flex:1 1 280px;max-width:380px;min-width:260px;">' + typeSeg + fields
    + '<div style="margin-bottom:12px;"><label style="' + LBL + '">Colour</label><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' + swatches
    + '<input type="color" data-pf="color" data-scope="' + scope + '" value="' + esc(p.color) + '" title="Custom colour" style="width:36px;height:28px;border:1px solid ' + C.line2 + ';border-radius:6px;padding:2px;background:#fff;cursor:pointer;"></div></div>'
    + '<div style="margin-bottom:16px;"><label style="' + LBL + '">Player photo</label>' + photo + '</div>'
    + '<button data-a="pdownload" data-scope="' + scope + '" style="' + BTN(C.blue) + 'width:100%;justify-content:center;padding:10px 16px;">' + icon('download', 15) + 'Download PNG</button>'
    + '</div>'
    + '<div style="flex:1 1 320px;min-width:280px;display:flex;justify-content:center;padding:16px;border-radius:12px;background:' + C.bg + ';border:1px solid ' + C.line + ';">'
    + '<canvas id="csaCv_' + scope + '" width="540" height="700" style="width:100%;max-width:400px;height:auto;display:block;border-radius:4px;box-shadow:0 8px 24px rgba(15,23,42,.18);background:#fff;"></canvas>'
    + '</div></div>';
}

const previewTimers = {};
function schedulePreview(scope) {
  clearTimeout(previewTimers[scope]);
  previewTimers[scope] = setTimeout(() => drawPreview(scope), 40);
}

async function posterPhoto(p) {
  if (!p.photo) return null;
  if (p.photoImg && p.photoImgSrc === p.photo) return p.photoImg;
  p.photoImg = await loadImg(p.photo, false);
  p.photoImgSrc = p.photo;
  return p.photoImg;
}

async function drawPreview(scope) {
  const p = posterState(scope);
  const cv = Q('csaCv_' + scope);
  if (!p || !cv) return;
  const [img, photo] = await Promise.all([loadAssets(), posterPhoto(p)]);
  if (posterState(scope) !== p) return; // editor closed / replaced meanwhile
  drawPoster(cv, p, img, photo, true);
}

function renderPosterEditor(scope) {
  const host = scope === 'modal' ? Q('csaPosterHost') : Q('csaCustomHost');
  if (!host) return;
  host.innerHTML = posterEditorHtml(scope);
  drawPreview(scope);
  if (scope === 'modal') fitRootToModal();
}

function downloadHref(href, filename) {
  const a = Q('csaDl');
  a.setAttribute('href', href);
  a.setAttribute('download', filename);
  a.click();
}

async function downloadPoster(scope, btn) {
  const p = posterState(scope);
  if (!p) return;
  btn.disabled = true;
  try {
    const [img, photo] = await Promise.all([loadAssets(), posterPhoto(p)]);
    const cv = Q('csaCvOut');
    drawPoster(cv, p, img, photo, false);
    const fname = (String(p.name || '').trim() || 'poster').replace(/[^a-zA-Z0-9]/g, '_') + (p.type === 'rating_achieved' ? '_rating_achieved' : '_poster') + '.png';
    downloadHref(cv.toDataURL('image/png'), fname);
    if (scope === 'modal') modalMessage('Poster downloaded.', 'success');
  } catch (e) {
    console.error('[csa] poster export failed', e);
    const text = 'Could not export the poster: ' + errMsg(e, 'unknown error');
    if (scope === 'modal') modalMessage(text, 'error'); else setStatus('custom', text, 'err');
  }
  btn.disabled = false;
}

// Uploaded photo → data URL (FileReader when the sandbox exposes it, else manual base64).
function bytesToBase64(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=');
  }
  return out;
}
async function fileToDataUrl(file) {
  let Reader = null;
  try { Reader = typeof FileReader === 'function' ? FileReader : null; } catch (e) { Reader = null; }
  if (Reader) {
    return new Promise((resolve, reject) => {
      const r = new Reader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }
  const buf = await file.arrayBuffer();
  return 'data:' + (file.type || 'image/png') + ';base64,' + bytesToBase64(new Uint8Array(buf));
}

function openAchPoster(i) {
  const r = state.ach.rows[i];
  if (!r) return;
  const gainable = r.is_rated && r.rating_change > 0;
  state.poster.modal = {
    types: gainable ? ['achiever', 'rating'] : ['achiever'],
    type: 'achiever',
    name: r.player_name || '', pos: buildAchText(r), tourn: r.tournament_name || '',
    points: gainable ? '+' + r.rating_change : '', info: '',
    color: '#1565C0', photo: '', photoName: '',
  };
  openModal('poster', 980, modalShell('image', 'Generate poster', esc(r.player_name) + ' · ' + esc(r.tournament_name || ''), '<div id="csaPosterHost"></div>'));
  renderPosterEditor('modal');
}

function openGotPoster(i) {
  const r = state.got.rows[i];
  if (!r) return;
  const parts = [];
  if (r.std) parts.push('Classical ' + r.std);
  if (r.rap) parts.push('Rapid ' + r.rap);
  if (r.bli) parts.push('Blitz ' + r.bli);
  state.poster.modal = {
    types: ['rating_achieved'], type: 'rating_achieved',
    name: r.player_name || '', pos: '', tourn: '', points: '', info: parts.join(' · ') || 'FIDE Rating',
    color: '#1565C0', photo: '', photoName: '',
  };
  const primary = r.std ? 'Classical' : r.rap ? 'Rapid' : 'Blitz';
  openModal('poster', 980, modalShell('award', 'Rating achieved poster', esc(r.player_name) + ' · achieved international ' + primary + ' FIDE rating in ' + esc(monthLabel(r.period)), '<div id="csaPosterHost"></div>'));
  renderPosterEditor('modal');
}

function renderCustom() {
  if (!state.poster.custom) {
    state.poster.custom = {
      types: ['achiever', 'rating', 'rating_achieved'], type: 'achiever',
      name: '', pos: 'Secured First', tourn: '', points: '+50', info: 'Classical Rating — ' + monthLabel(currentMonthKey()),
      color: '#1565C0', photo: '', photoName: '',
    };
  }
  const host = Q('csaPanel_custom');
  if (!Q('csaCustomHost')) {
    host.innerHTML = panelHead('Custom Poster', 'Design a poster for any student — choose the type, fill in the details and download a PNG.')
      + '<div id="csaStatus_custom" style="min-height:0;margin:0 2px 8px;font-size:12.5px;"></div>'
      + '<div style="' + CARD + 'padding:18px 20px;"><div id="csaCustomHost"></div></div>';
  }
  renderPosterEditor('custom');
}

// ── Event wiring ────────────────────────────────────────────────────────────
const SORT_DEFAULT_DIR = { rc: -1, date: -1, std: -1, rap: -1, bli: -1 }; // numbers/dates: biggest/newest first

Q('csa').addEventListener('click', e => {
  if (e.target === Q('csaBackdrop')) { closeModal(); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const action = el.getAttribute('data-a');
  const scope = el.getAttribute('data-scope');
  if (action === 'tab') switchTab(el.getAttribute('data-tab'));
  else if (action === 'filter') { state.ach.filter = el.getAttribute('data-filter'); state.ach.page = 0; renderAch(); }
  else if (action === 'sort') {
    const st = state[scope].sort;
    const key = el.getAttribute('data-key');
    if (st.key === key) st.dir = -st.dir; else { st.key = key; st.dir = SORT_DEFAULT_DIR[key] || 1; }
    state[scope].page = 0;
    renderScope(scope);
  }
  else if (action === 'page') {
    state[scope].page = Number(el.getAttribute('data-page')) || 0;
    renderScope(scope);
  }
  else if (action === 'refresh') { if (scope === 'ach') loadAch(); else if (scope === 'got') loadGot(); else loadConsent(); }
  else if (action === 'consent-add') openConsentForm();
  else if (action === 'consent-save') saveConsentForm(el);
  else if (action === 'fetch') { if (scope === 'ach') confirmFetchAch(); else confirmFetchGot(); }
  else if (action === 'fetch-all') confirmFetchAllRatings();
  else if (action === 'fetch-log') openLog();
  else if (action === 'fetch-stop') { state.got.stop = true; renderLog(); }
  else if (action === 'log-filter') { if (state.got.log) { state.got.log.filter = el.getAttribute('data-filter'); renderLog(); } }
  else if (action === 'player') openPlayerInfo(el.getAttribute('data-fid'), el.getAttribute('data-name'), el.getAttribute('data-mobile'));
  else if (action === 'poster-ach') openAchPoster(Number(el.getAttribute('data-i')));
  else if (action === 'poster-got') openGotPoster(Number(el.getAttribute('data-i')));
  else if (action === 'stats-refresh') { state.stats.loaded = false; loadStats(); }
  else if (action === 'stats-csv') downloadStatsCsv();
  else if (action === 'stats-list') openStatsList(el.getAttribute('data-period'), el.getAttribute('data-group'), el.getAttribute('data-col'));
  else if (action === 'close') closeModal();
  else if (action === 'confirm-ok') { const fn = state.modal && state.modal.onOk; closeModal(); if (fn) fn(); }
  else if (action === 'ptype') { posterState(scope).type = el.getAttribute('data-type'); renderPosterEditor(scope); }
  else if (action === 'pcolor') { posterState(scope).color = el.getAttribute('data-color'); renderPosterEditor(scope); }
  else if (action === 'pphoto-clear') { const p = posterState(scope); p.photo = ''; p.photoName = ''; renderPosterEditor(scope); }
  else if (action === 'pdownload') downloadPoster(scope, el);
});

Q('csa').addEventListener('input', e => {
  const t = e.target;
  if (t.getAttribute('data-c') === 'search') {
    const scope = t.getAttribute('data-scope');
    state[scope].search = t.value;
    state[scope].page = 0;
    renderScope(scope);
    return;
  }
  if (t.id === 'csaCfFide') { consentFormLookup(); return; }
  const pf = t.getAttribute('data-pf');
  if (pf && pf !== 'photo') {
    const scope = t.getAttribute('data-scope');
    posterState(scope)[pf] = t.value;
    schedulePreview(scope);
  }
});

Q('csa').addEventListener('change', async e => {
  const t = e.target;
  const c = t.getAttribute('data-c');
  if (c === 'month') {
    const scope = t.getAttribute('data-scope');
    state[scope].month = t.value;
    state[scope].page = 0;
    if (scope === 'ach') loadAch(); else loadGot();
  } else if (c === 'stats-period') {
    state.stats.period = t.value;
    renderStats();
  } else if (t.getAttribute('data-pf') === 'photo') {
    const scope = t.getAttribute('data-scope');
    const file = t.files && t.files[0];
    if (!file) return;
    const p = posterState(scope);
    try {
      p.photo = await fileToDataUrl(file);
      p.photoName = file.name;
    } catch (err) {
      console.error('[csa] photo read failed', err);
    }
    if (posterState(scope) === p) renderPosterEditor(scope);
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
renderTabs();
renderAch();
renderGot();
loadPlayers();
loadConsent();
loadAch();
loadGot();
loadAssets(); // warm poster artwork

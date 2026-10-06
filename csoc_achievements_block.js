// csoc_achievements_block.js — CSOC Achievements (NocoBase JS-block) — LIGHT theme
//
// NocoBase port of index.html (csoc-achievements.vercel.app). Tabs:
//   1. Achievers     — tournament results per month (cc_csoc_achievements);
//                      "Fetch from API" adds finished chess-results tournaments
//   2. Got Rating    — first FIDE ratings per month (cc_csoc_got_rating);
//                      "Fetch from API" checks FIDE history of players active that month
//   3. Rating Stats  — Got Rating counts per month (active vs non-active) + CSV export
//   4. Student Progress — FIDE rating at first subscription start vs last end, per student
//   5. Consent       — cc_csoc_cx_consent records
//   6. Custom Poster — free-form poster editor
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
  regView: 'view_csoc_registration_new',          // player -> batch code (class)
  groupBatch: 'cc_csoc_batch_name_mapping',       // group batch -> coach
  personalBatch: 'cc_csoc_personal_batch_details', // 1:1 batch -> coach
  assignment: 'cc_assignment_relationship',       // student mobile_number -> resource_id
  adminUsers: 'cc_admin_users',                    // id (= resource_id) -> name
};
const TBL_SOURCE = {
  [TBL.users]: 'circlechess',
  [TBL.reg]: 'circlechess',
  [TBL.ach]: 'main',
  [TBL.got]: 'main',
  [TBL.consent]: 'main',
  [TBL.regView]: 'readreplica_circlechess',
  [TBL.groupBatch]: 'circlechess',
  [TBL.personalBatch]: 'circlechess',
  [TBL.assignment]: 'circlechess',
  [TBL.adminUsers]: 'circlechess',
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
const GOT_PARALLEL = 4;       // ratings.fide.com answers only a few requests at a time
const STATUS_LABEL = { 1: 'Active', 2: 'Expired', 3: 'Upcoming', 5: 'Pause' };
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// NocoBase errors come as { errors: [{ message }] }; the proxies send { error }.
function errMsg(error, fallback) {
  const d = error && error.response && error.response.data;
  const nb = d && Array.isArray(d.errors) && d.errors[0] && d.errors[0].message;
  return nb || (d && (d.error || d.message)) || (error && error.message) || fallback;
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
  // Page 1 tells us the page count; the remaining pages are fetched in parallel (4 at a time).
  const pageSize = 500;
  const get = async page => {
    const res = await ctx.api.request({ url: collection + ':list', method: 'get', headers: dbHeaders(collection, false), params: { ...params, page, pageSize } });
    return { rows: (res && res.data && res.data.data) || [], totalPage: res && res.data && res.data.meta && Number(res.data.meta.totalPage) };
  };
  const first = await get(1);
  const out = first.rows.slice();
  if (!first.totalPage || first.totalPage <= 1 || first.rows.length < pageSize) return out;
  const pages = [];
  for (let page = 2; page <= Math.min(first.totalPage, 100); page++) pages.push(page);
  const results = new Map();
  await runPool(pages, 4, async page => { results.set(page, (await get(page)).rows); });
  pages.forEach(page => out.push(...(results.get(page) || [])));
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

async function dbDestroy(collection, id) {
  await ctx.api.request({ url: collection + ':destroy', method: 'post', headers: dbHeaders(collection, true), params: { filterByTk: id } });
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
  + '#csaTable_prog .csa-link{white-space:normal;}' // Student Progress: long names wrap in the fixed-width Player column
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
  + '<div id="csaMine" title="You are an assigned person, so only the students assigned to you are shown" style="display:none;align-items:center;gap:8px;padding:7px 14px;border-radius:10px;background:#ECFDF5;color:#047857;font-size:12.5px;font-weight:600;"></div>'
  + '<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:10px;background:' + C.blueLt + ';color:' + C.blueDk + ';font-size:12.5px;font-weight:600;">' + icon('users', 15) + 'Players <span id="csaPlayers" style="font-weight:700;">—</span></div>'
  + '</div>'
  // Panels
  + '<div id="csaPanel_ach">' + dataPanelHtml('ach', {
    title: 'Achievers',
    sub: 'Results still to follow up (no status yet, or Pending) for the selected month. Once saved with another status a result leaves this list — Consent Received ones move to Create Poster. “Fetch from API” adds finished chess-results tournaments not saved yet.',
    months: monthOptions(2026, true),
    extra: '<div id="csaFilter_ach" style="' + SEG + '"></div>'
      + '<select id="csaSub_ach" data-c="ach-sub" title="Subscription active in the tournament month" style="' + INP + 'min-width:130px;cursor:pointer;"></select>'
      + '<select id="csaFu_ach" data-c="ach-fu" title="Follow-up status" style="' + INP + 'min-width:160px;cursor:pointer;"></select>',
    searchPh: 'Search player, FIDE ID, tournament',
    minWidth: 1000,
  }) + '</div>'
  + '<div id="csaPanel_got" style="display:none;">' + dataPanelHtml('got', {
    title: 'Got Rating',
    sub: 'Players who received their first FIDE rating in the selected month. “Fetch from API” checks players active that month with no rating saved yet; “Fetch all ratings” saves every player’s first rating.',
    months: monthOptions(2025, true),
    extra: '<select id="csaFilter_got" data-c="gstatus" title="Registration status" style="' + INP + 'min-width:150px;cursor:pointer;"></select>'
      + '<select id="csaFu_got" data-c="got-fu" title="Follow-up status" style="' + INP + 'min-width:160px;cursor:pointer;"></select>',
    searchPh: 'Search player, FIDE ID, mobile',
    buttons: '<button data-a="fetch-log" title="Status of the last fetch, player by player" style="' + GHOST + 'min-height:36px;">' + icon('info', 14) + 'Fetch log</button>'
      + '<button id="csaFetchAll_got" data-a="fetch-all" title="Save the first FIDE rating of every player not rated yet" style="' + GHOST + 'min-height:36px;color:' + C.blue + ';">' + icon('star', 14) + 'Fetch all ratings</button>',
    minWidth: 1000,
  }) + '</div>'
  + '<div id="csaPanel_fu" style="display:none;">'
  + panelHead('Create Poster', 'Followed-up results (all months) by status — opens on “Consent Received”. Who called and when, the comment and the consent pictures. Make the poster from here.')
  + '<div style="' + CARD + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:10px;">'
  + '<select data-c="fu-status" title="Follow-up status" style="' + INP + 'min-width:200px;cursor:pointer;font-weight:600;"></select>'
  + searchBox('fu', 'Search player, mobile, tournament, assigned to')
  + '<div style="flex:1;"></div>'
  + '<button data-a="refresh" data-scope="fu" title="Reload" style="' + GHOST + 'min-height:36px;">' + icon('refresh', 14) + 'Reload</button>'
  + '</div>'
  + '<div id="csaStatus_fu" style="min-height:18px;margin:0 2px 10px;font-size:12.5px;color:' + C.sub + ';"></div>'
  + '<div style="' + CARD + 'overflow-x:auto;"><table id="csaTable_fu" style="min-width:1180px;"></table></div>'
  + '<div id="csaPager_fu"></div>'
  + '</div>'
  + '<div id="csaPanel_stats" style="display:none;"></div>'
  + '<div id="csaPanel_prog" style="display:none;">'
  + panelHead('Student Progress', 'FIDE ratings at each student’s first subscription start vs. their last subscription end (this month’s rating if the subscription is still running). Registrations with status 4 or 6 are left out.')
  + '<div style="' + CARD + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:10px;">'
  + searchBox('prog', 'Filter by mobile number or name')
  + '<select data-c="prog-status" title="Status of the latest registration" style="' + INP + 'min-width:150px;cursor:pointer;"></select>'
  + '<select data-c="prog-duration" title="Time between first start and last end" style="' + INP + 'min-width:170px;cursor:pointer;"></select>'
  + '<div style="flex:1;"></div>'
  + '<button data-a="refresh" data-scope="prog" title="Reload" style="' + GHOST + 'min-height:36px;">' + icon('refresh', 14) + 'Reload</button>'
  + '</div>'
  + '<div id="csaProg_prog" style="display:none;height:4px;border-radius:999px;background:' + C.line + ';overflow:hidden;margin:0 2px 8px;"><div style="height:100%;width:0;background:' + C.blue + ';border-radius:999px;transition:width .25s;"></div></div>'
  + '<div id="csaStatus_prog" style="min-height:18px;margin:0 2px 10px;font-size:12.5px;color:' + C.sub + ';"></div>'
  + '<div id="csaKpis_prog" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>'
  + '<div style="' + CARD + 'overflow:hidden;"><table id="csaTable_prog" style="width:100%;table-layout:fixed;"></table></div>'
  + '<div id="csaPager_prog"></div>'
  + '</div>'
  + '<div id="csaPanel_consent" style="display:none;">'
  + panelHead('Consent', 'Players who gave consent for posters and publicity (' + TBL.consent + '). The Consent ticks in Achievers and Got Rating come from here.')
  + '<div style="' + CARD + 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;margin-bottom:10px;">'
  + searchBox('consent', 'Search player, FIDE ID, mobile')
  + '<div style="flex:1;"></div>'
  + '<button data-a="refresh" data-scope="consent" title="Reload" style="' + GHOST + 'min-height:36px;">' + icon('refresh', 14) + 'Reload</button>'
  + '<button data-a="consent-add" style="' + BTN(C.blue) + 'min-height:36px;">' + icon('checkCircle', 14) + 'Add consent</button>'
  + '</div>'
  + '<div id="csaStatus_consent" style="min-height:18px;margin:0 2px 10px;font-size:12.5px;color:' + C.sub + ';"></div>'
  + '<div style="' + CARD + 'overflow-x:auto;"><table id="csaTable_consent" style="min-width:900px;"></table></div>'
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
  { key: 'fu', label: 'Create Poster', icon: 'award', badge: true },
  { key: 'stats', label: 'Rating Stats', icon: 'barChart' },
  { key: 'prog', label: 'Student Progress', icon: 'trendingUp' },
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
  // rcTried: 'tournament_id|fide_id' already looked up for a missing rating change this visit
  // sub: subscription active in the tournament month; fuFilter: follow-up status
  ach: { month: currentMonthKey(), filter: 'all', sub: 'all', fuFilter: 'all', search: '', rows: [], loaded: false, page: 0, sort: { key: null, dir: 1 }, seq: 0, busy: false, cache: {}, rcTried: new Set(), statusLine: null },
  got: { month: currentMonthKey(), status: 'active', fuFilter: 'all', search: '', rows: [], loaded: false, page: 0, sort: { key: null, dir: 1 }, seq: 0, busy: false, cache: {} },
  // Create Poster page: followed-up achievements; status = the filter (an option's stored value or
  // 'all'), null until the field setup is known, then "Consent Received"
  fu: { loaded: false, loading: false, error: '', status: null, rows: [], search: '', page: 0, sort: { key: 'at', dir: -1 } },
  stats: { loaded: false, loading: false, rows: [], monthMap: {}, periods: [], period: '' },
  // Student Progress: rows from view_csoc_registration_new; hist = fide_id -> rating history
  prog: { loaded: false, loading: false, error: '', rows: [], search: '', status: 1, duration: 'all', page: 0, sort: { key: null, dir: 1 }, hist: new Map(), histVer: 0, running: false, blockedUntil: 0, statusCounts: null, visKey: '', visRows: [] },
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
  const periods = new Map(); // mobile -> every subscription [start, end], for "active in a month"
  regs.forEach(r => {
    const mobile = String(r.mobile_number || '').trim();
    if (!mobile) return;
    const end = normEndDate(r.subscription_end_date), start = normEndDate(r.subscription_start_date);
    if (start) periods.set(mobile, (periods.get(mobile) || []).concat({ start, end }));
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
      periods: periods.get(mobile) || [],
    });
  });
  return players.filter(p => p.fide_id && p.fide_id !== '0');
}

// state.players = active (status 1) students, used by the fetches and the header count;
// state.playerMap covers statuses 1, 2, 3 and 5 so every table can show / filter by status.
function loadPlayers(force) {
  if (state.playersPromise && !force) return state.playersPromise;
  Q('csaPlayers').textContent = '…';
  state.playersPromise = fetchPlayerList([1, 2, 3, 5]).then(players => {
    state.players = players.filter(p => p.status === 1);
    state.playerMap = new Map(players.map(p => [p.fide_id, p]));
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

// Active in month "2026-Aug" = any of the player's subscriptions overlaps that month:
// subscription_start_date <= last day of the month and subscription_end_date >= its first day.
// Used by Achievers, Got Rating and Rating Stats, so their counts agree.
function activeInMonth(fideId, monthKey) {
  const p = playerById(fideId);
  if (!p || MON_ABBR.indexOf(String(monthKey || '').split('-')[1]) < 0) return false;
  const [from, to] = monthRange(monthKey);
  return (p.periods || []).some(x => x.start <= to && (!x.end || x.end >= from));
}
// "2026-08-15" -> "2026-Aug"
function ymdToMonthKey(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + MON_ABBR[Number(m[2]) - 1] : '';
}
function activeChip(yes) {
  return yes
    ? '<span style="' + PILL('#ECFDF5', '#047857', '#A7F3D0') + '">' + dot('#10B981') + 'Active</span>'
    : '<span style="' + PILL('#F1F5F9', C.sub, C.line) + '">' + dot(C.mute) + 'Inactive</span>';
}

// Mobile match key: last 10 digits (country code ignored); shorter numbers as they are
function assigneeKey(v) { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }

// Assigned person per student: cc_assignment_relationship (mobile_number -> resource_id)
// -> cc_admin_users (id = resource_id) -> name. Keyed by the last 10 digits of the mobile.
async function loadAssignees() {
  try {
    const rels = await fetchAll(TBL.assignment, {});
    const byMobile = new Map();
    // Several rows for one mobile: the newest (highest id) wins
    rels.slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).forEach(r => {
      const m = assigneeKey(r.mobile_number);
      if (m && r.resource_id !== null && r.resource_id !== undefined && r.resource_id !== '') byMobile.set(m, String(r.resource_id));
    });
    const ids = [...new Set(byMobile.values())];
    const admins = ids.length ? await fetchAll(TBL.adminUsers, { filter: JSON.stringify({ id: { $in: ids.map(id => (/^\d+$/.test(id) ? Number(id) : id)) } }) }) : [];
    const adminName = u => String(u.name || u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.nickname || u.email || '').trim();
    const nameOf = new Map(admins.map(u => [String(u.id), adminName(u)]));
    state.assignee = new Map();
    byMobile.forEach((rid, m) => { const n = nameOf.get(rid); if (n) state.assignee.set(m, n); });

    // Signed-in user who is one of the assigned people (same name / username / email):
    // every tab then shows only their students. Everyone else sees all students.
    const me = await currentUser();
    const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const myKeys = new Set([me.nickname, me.username, me.email, me.name].map(norm).filter(Boolean));
    const mine = admins.filter(u => [adminName(u), u.username, u.nickname, u.email].map(norm).some(k => k && myKeys.has(k)));
    if (mine.length) {
      const ids = new Set(mine.map(u => String(u.id)));
      state.mine = new Set();
      byMobile.forEach((rid, m) => { if (ids.has(rid)) state.mine.add(m); });
      state.mineName = adminName(mine[0]);
      applyMine();
    }
  } catch (e) {
    console.error('[csa] assignee lookup failed (' + TBL.assignment + ' / ' + TBL.adminUsers + ')', e);
    state.assigneeError = errMsg(e, 'unknown error');
  }
  renderAch();
  renderGot();
  renderFollowups();
  if (state.tab === 'prog') renderProg();
}

// Only this user's students (state.mine = their mobile keys), or everyone when state.mine is unset
function mineOk(mobile) { return !state.mine || state.mine.has(assigneeKey(mobile)); }

// Called once the "my students" set is known: header note + every tab re-filtered.
function applyMine() {
  const el = Q('csaMine');
  el.style.display = 'flex';
  el.innerHTML = icon('user', 14) + 'My students only · ' + esc(state.mineName) + ' <span style="font-weight:700;">' + fmtNum(state.mine.size) + '</span>';
  const p = state.prog;
  if (p.loaded) { progStatusCounts(); p.visKey = ''; }
  if (state.stats.loaded) { state.stats.loaded = false; if (state.tab === 'stats') loadStats(); }
  renderConsent();
  renderFollowups();
  renderTabs();
  if (state.tab === 'prog') renderProg();
}
function assigneeOf(mobile) { return (state.assignee && state.assignee.get(assigneeKey(mobile))) || ''; }
function assigneeCell(mobile) {
  const n = assigneeOf(mobile);
  if (n) return esc(n);
  return '<span style="' + MUTED + '"' + (state.assigneeError ? ' title="' + esc('Could not load: ' + state.assigneeError) + '"' : '') + '>'
    + (state.assignee || state.assigneeError ? '—' : '…') + '</span>';
}

function mobileKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

// Names compared as word sets, so "B, Bob" (chess-results / FIDE) matches "Bob B".
function nameWords(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

function hasConsent(fid, mobile) {
  const f = String(fid || '').trim();
  const m = mobileKey(mobile);
  return !!((f && f !== '0' && state.consentFide.has(f)) || (m && state.consentMobile.has(m)));
}

// No `fields` param: only fide_id / mobile_number are needed, and asking for a column the
// table doesn't have would fail the whole request.
const isTrue = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

// ── Field setup read from NocoBase (collections/<name>/fields:list) ──
// achStatus: options of cc_csoc_achievements.status (single select) — value as stored + label.
// consentImages: how cc_csoc_cx_consent.images is defined —
//   'assoc' (Attachment field: send attachment ids, list with appends=images), 'json', 'text',
//   'none' (no such field), null (couldn't tell).
const ACH_STATUS_DEFAULT = ['Follow up', 'Consent Received', 'RNR', 'Not Eligible', 'Pending', 'Consent Declined'];
// gotStatus / gotFields: the same for cc_csoc_got_rating.status (Got Rating follow-up).
const GOT_STATUS_DEFAULT = ['Pending', 'Consent Received', 'Consent Declined', 'RNR'];
const meta = {
  achStatus: ACH_STATUS_DEFAULT.map(l => ({ value: l, label: l })), achFields: null,
  gotStatus: GOT_STATUS_DEFAULT.map(l => ({ value: l, label: l })), gotFields: null, consentImages: null,
};
async function collectionFields(name) {
  const res = await ctx.api.request({ url: 'collections/' + name + '/fields:list', method: 'get', params: { paginate: false } });
  return (res && res.data && res.data.data) || [];
}
// Options of a single-select field ({ value, label }), or null
function selectOptions(fields, name) {
  const st = fields.find(x => x.name === name);
  const en = st && st.uiSchema && st.uiSchema.enum;
  return Array.isArray(en) && en.length ? en.map(o => ({ value: String(o.value), label: String(o.label || o.value) })) : null;
}
const metaPromise = (async () => {
  try {
    const f = await collectionFields(TBL.ach);
    meta.achFields = new Set(f.map(x => x.name));
    meta.achStatus = selectOptions(f, 'status') || meta.achStatus;
  } catch (e) { console.warn('[csa] could not read ' + TBL.ach + ' fields', e); }
  try {
    const f = await collectionFields(TBL.got);
    meta.gotFields = new Set(f.map(x => x.name));
    meta.gotStatus = selectOptions(f, 'status') || meta.gotStatus;
  } catch (e) { console.warn('[csa] could not read ' + TBL.got + ' fields', e); }
  try {
    const f = await collectionFields(TBL.consent);
    const im = f.find(x => x.name === 'images');
    meta.consentImages = !im ? 'none'
      : ['belongsToMany', 'hasMany', 'belongsTo'].includes(im.type) || im.interface === 'attachment' ? 'assoc'
      : /^jsonb?$/.test(im.type) ? 'json' : 'text';
  } catch (e) { console.warn('[csa] could not read ' + TBL.consent + ' fields', e); }
})();

// Value for cc_csoc_cx_consent.images in the shape its field type expects
function consentImagesValue(images) {
  if (meta.consentImages === 'assoc') return images.map(im => im.id).filter(id => id !== undefined && id !== null);
  if (meta.consentImages === 'json') return images.map(im => ({ id: im.id, url: im.url, name: im.name }));
  return JSON.stringify(images.map(im => ({ id: im.id, url: im.url, name: im.name })));
}

// Creates / updates a consent record. If `images` is an Attachment field we didn't know about
// (Postgres "bigint" error on a text value), switches to attachment ids and retries once.
// Returns a warning when the images could not be stored, else ''.
async function saveConsentRecord(id, values, images) {
  const write = () => (id ? dbUpdate(TBL.consent, id, values) : dbCreate(TBL.consent, values));
  let saved;
  try {
    saved = await write();
  } catch (e) {
    if (!images || meta.consentImages === 'assoc' || !/bigint|integer/i.test(errMsg(e, ''))) throw e;
    meta.consentImages = 'assoc';
    values.images = consentImagesValue(images);
    saved = await write();
  }
  const rec = Array.isArray(saved) ? saved[0] : saved;
  // NocoBase drops fields the collection doesn't have (association fields aren't echoed back)
  if (values.images !== undefined && meta.consentImages !== 'assoc' && rec && !('images' in rec)) {
    return 'Consent saved, but the images were not: ' + TBL.consent + ' needs an "images" field (Attachment or Long text).';
  }
  return '';
}

// The signed-in NocoBase user ({ id, nickname, username, email, … }); {} if unknown
let userPromise = null;
function currentUser() {
  if (!userPromise) {
    userPromise = (async () => {
      try {
        const u = ctx.user || (ctx.currentUser && ctx.currentUser.data) || (ctx.auth && ctx.auth.user);
        if (u && (u.nickname || u.username || u.email)) return u;
      } catch (e) { /* not exposed */ }
      const res = await ctx.api.request({ url: 'auth:check', method: 'get' });
      return (res && res.data && res.data.data) || {};
    })().catch(e => { console.warn('[csa] current user lookup failed', e); userPromise = null; return {}; });
  }
  return userPromise;
}
// Name for connected_by
async function currentUserName() {
  const u = await currentUser();
  return String(u.nickname || u.username || u.email || u.phone || (u.id ? 'user ' + u.id : '') || 'unknown').trim();
}

// Consent images: the files are NocoBase attachments (attachments:create); the record keeps either
// the attachments themselves (Attachment field) or JSON [{ id, url, name }] (text / JSON field).
function parseImages(v) {
  let list = v;
  if (!Array.isArray(list)) {
    if (!list) return [];
    try { list = JSON.parse(list); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
  }
  return list.filter(x => x && x.url).map(x => ({ id: x.id, url: x.url, name: x.name || x.filename || ((x.title || 'image') + (x.extname || '')) }));
}

// cc_csoc_cx_consent record -> row. A missing is_consent column counts as consent given.
function consentRowFromDb(rec) {
  return {
    id: rec.id,
    player_name: String(rec.player_name || ''),
    fide_id: String(rec.fide_id || '').trim(),
    mobile_number: rec.mobile_number ? String(rec.mobile_number) : '',
    yes: rec.is_consent === undefined ? true : isTrue(rec.is_consent),
    added: normEndDate(rec.createdAt || rec.created_at || ''),
    images: parseImages(rec.images),
    hasImagesField: 'images' in rec,
  };
}

// Text -> UTF-8 bytes without TextEncoder (may be missing in the sandbox)
function strBytes(s) {
  const bin = unescape(encodeURIComponent(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Uploads one file to NocoBase storage -> { id, url, name }. Uses FormData when the sandbox has
// it, else builds the multipart body by hand.
async function uploadImage(file) {
  let FD = null;
  try { FD = typeof FormData === 'function' ? FormData : null; } catch (e) { FD = null; }
  let data, headers = {};
  if (FD) {
    data = new FD();
    data.append('file', file, file.name);
  } else {
    const boundary = '----csa' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const head = strBytes('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + String(file.name || 'image').replace(/["\r\n]/g, '')
      + '"\r\nContent-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n');
    const body = new Uint8Array(await file.arrayBuffer());
    const tail = strBytes('\r\n--' + boundary + '--\r\n');
    data = new Uint8Array(head.length + body.length + tail.length);
    data.set(head, 0); data.set(body, head.length); data.set(tail, head.length + body.length);
    headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
  }
  const res = await ctx.api.request({ url: 'attachments:create', method: 'post', data, headers });
  const a = res && res.data && res.data.data;
  if (!a || !a.url) throw new Error('upload returned no file');
  return { id: a.id, url: a.url, name: a.filename || ((a.title || 'image') + (a.extname || '')) };
}

function imageThumb(im, attrs, size) {
  const s = size || 64;
  return '<img src="' + esc(im.url || im.preview) + '" alt="" ' + (attrs || '') + ' style="width:' + s + 'px;height:' + s + 'px;object-fit:cover;border-radius:8px;border:1px solid ' + C.line + ';background:' + C.card + ';display:block;">';
}

function loadConsent(note) {
  setStatus('consent', 'Loading…');
  // An Attachment `images` field is only returned when asked for (appends)
  return metaPromise.then(() => fetchAll(TBL.consent, meta.consentImages === 'assoc' ? { appends: ['images'] } : {})).then(recs => {
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
    // false = records exist but none has an `images` column (field not added yet); null = can't tell
    state.consentImagesField = meta.consentImages === 'none' ? false : meta.consentImages ? true
      : recs.length ? recs.some(r => 'images' in r) : null;
    setStatus('consent', (note ? note + ' · ' : '') + rows.length + ' records, ' + rows.filter(r => r.yes).length + ' with consent', note ? 'ok' : '');
    renderAch();
    renderGot();
    renderConsent();
    renderFollowups();
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
  if (!col.sort) return '<th style="' + TH + align + (col.w ? 'width:' + col.w + ';' : '') + (col.pad ? 'padding:' + col.pad + ';' : '') + '">' + col.label + '</th>';
  const on = st.key === col.sort;
  const arrow = on ? (st.dir > 0 ? '▲' : '▼') : '↕';
  return '<th data-a="sort" data-scope="' + scope + '" data-key="' + col.sort + '" style="' + TH + align + (col.w ? 'width:' + col.w + ';' : '') + (col.pad ? 'padding:' + col.pad + ';' : '') + (on ? 'color:' + C.blue + ';' : '') + '">'
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

// achId: an Achievers row — the pop-up then gets an Achievement (follow-up) tab and a Poster button;
// gotI: a Got Rating row index — the pop-up gets a Poster button.
function playerCell(fid, name, mobile, action, achId, gotI) {
  return '<span class="csa-link" data-a="' + (action || 'player') + '" data-fid="' + esc(fid) + '" data-name="' + esc(name) + '" data-mobile="' + esc(mobile) + '"'
    + (achId !== undefined && achId !== null ? ' data-ach="' + esc(achId) + '"' : '')
    + (gotI !== undefined && gotI !== null ? ' data-got="' + esc(gotI) + '"' : '') + '>' + esc(name || '—') + '</span>';
}


function renderTabs() {
  const counts = {
    ach: state.ach.loaded ? achBase().length : null,
    fu: state.fu.loaded ? fuVisibleRows().length : null,
    got: state.got.loaded ? gotBase().length : null,
    consent: state.consent.loaded ? state.consent.rows.filter(r => r.yes && mineOk(r.mobile_number)).length : null,
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
  if (tab === 'fu') { if (!state.fu.loaded && !state.fu.loading) loadFollowups(); else renderFollowups(); }
  if (tab === 'stats' && !state.stats.loaded && !state.stats.loading) loadStats();
  if (tab === 'stats') renderStats();
  if (tab === 'prog') { if (!state.prog.loaded && !state.prog.loading) loadProgress(); else renderProg(); }
  if (tab === 'consent') renderConsent();
  if (tab === 'custom') renderCustom();
}

function renderScope(scope) {
  if (scope === 'ach') renderAch();
  else if (scope === 'got') renderGot();
  else if (scope === 'consent') renderConsent();
  else if (scope === 'prog') renderProg();
  else if (scope === 'fu') renderFollowups();
}

// ── Consent tab (cc_csoc_cx_consent) ───────────────────────────────────────
const CONSENT_SORT_GET = {
  name: r => r.player_name || '',
  fide: r => Number(r.fide_id) || null,
  yes: r => (r.yes ? 1 : 0),
  imgs: r => r.images.length || null,
  added: r => r.added || '',
};

function renderConsent() {
  const c = state.consent;
  const s = c.search.trim().toLowerCase();
  let rows = c.rows.filter(r => mineOk(r.mobile_number)
    && (!s || [r.player_name, r.fide_id, r.mobile_number].some(v => String(v || '').toLowerCase().includes(s))));
  if (c.sort.key) rows = sortRows(rows, CONSENT_SORT_GET[c.sort.key], c.sort.dir);
  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'FIDE ID', sort: 'fide' }, { label: 'Mobile' },
    { label: 'Consent', sort: 'yes', center: true }, { label: 'Images', sort: 'imgs' }, { label: 'Added', sort: 'added' }, { label: '', w: '1%' },
  ];
  const thead = '<thead><tr>' + cols.map(col => thCell('consent', col)).join('') + '</tr></thead>';
  // Up to 3 thumbnails + count; click opens the viewer
  const imgsCell = r => !r.images.length ? '<span style="' + MUTED + '">—</span>'
    : '<button data-a="consent-imgs" data-id="' + esc(r.id) + '" title="View / download images" style="display:inline-flex;align-items:center;gap:6px;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:#fff;cursor:pointer;">'
      + r.images.slice(0, 3).map(im => imageThumb(im, '', 30)).join('')
      + '<span style="font-size:12px;font-weight:700;color:' + C.blue + ';padding:0 6px 0 2px;">' + r.images.length + '</span></button>';
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
      + '<td style="' + TD + '">' + imgsCell(r) + '</td>'
      + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(fmtYMD(r.added) || '—') + '</td>'
      + '<td style="' + TD + '"><button data-a="consent-edit" data-id="' + esc(r.id) + '" style="' + GHOST + 'padding:5px 11px;font-size:12px;color:' + C.blue + ';">Edit</button></td>'
      + '</tr>').join('');
  }
  Q('csaTable_consent').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_consent').innerHTML = c.loaded ? pagerHtml('consent', c.page, rows.length) : '';
}

// Consent record for a FIDE ID (else mobile number), if any.
function findConsent(fid, mobile) {
  const f = String(fid || '').trim(), m = mobileKey(mobile);
  return state.consent.rows.find(r => (f && r.fide_id === f) || (!f && m && mobileKey(r.mobile_number) === m)) || null;
}

// p: { id } to edit a record, or { fid, name, mobile } from a table row; empty = new record.
function openConsentForm(p) {
  p = p || {};
  const rec = p.id !== undefined ? state.consent.rows.find(r => String(r.id) === String(p.id)) : findConsent(p.fid, p.mobile);
  const fid = rec ? rec.fide_id : String(p.fid || '');
  const name = (rec && rec.player_name) || p.name || '';
  const mobile = (rec && rec.mobile_number) || p.mobile || '';
  const player = playerById(fid);
  const field = (id, label, placeholder, value, extra) => '<div style="margin-bottom:12px;"><label style="' + LBL + '">' + label + '</label>'
    + '<input id="' + id + '" placeholder="' + placeholder + '" value="' + esc(value) + '" ' + (extra || '') + ' style="' + INP + 'width:100%;"></div>';
  const sub = rec ? 'Editing the saved record' : (fid || name) ? 'No consent saved yet for this player' : 'Saved to ' + esc(TBL.consent);
  openModal('consent', 480, modalShell('checkCircle', rec ? 'Edit consent' : 'Add consent', sub,
    field('csaCfFide', 'FIDE ID', 'e.g. 25092340', fid, 'inputmode="numeric"')
    + '<div id="csaCfHint" style="margin:-6px 0 12px;font-size:12px;color:' + C.sub + ';">'
    + (player ? esc(statusLabel(player.status)) + ' · subscription ' + esc(fmtYMD(player.subscription_start_date) || '?') + ' – ' + esc(fmtYMD(player.subscription_end_date) || '?')
      : 'Enter a FIDE ID to fill in a known player’s name and mobile.') + '</div>'
    + field('csaCfName', 'Player name', 'e.g. Magnus Carlsen', name)
    + field('csaCfMobile', 'Mobile number', 'e.g. 919876543210', mobile, 'inputmode="tel"')
    + '<label style="' + LBL + '">Consent</label><div id="csaCfChoice" style="display:flex;gap:8px;"></div>'
    + '<label style="' + LBL + 'margin-top:14px;">Images</label><div id="csaCfImgs"></div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">'
    + '<button data-a="close" style="' + GHOST + '">Cancel</button>'
    + '<button data-a="consent-save" style="' + BTN(C.blue) + '">Save</button></div>'),
  { consentId: rec ? rec.id : null, yes: rec ? rec.yes : (p.yes !== undefined ? p.yes : true), images: rec ? rec.images.slice() : [], pending: [] });
  renderConsentChoice();
  renderCfImages();
}

// Saved images (× removes on Save) + images picked but not uploaded yet (uploaded on Save)
function renderCfImages() {
  const el = Q('csaCfImgs');
  if (!el || !state.modal) return;
  const m = state.modal;
  const tile = (im, act, i) => '<div style="position:relative;">' + imageThumb(im, '', 72)
    + '<button data-a="' + act + '" data-i="' + i + '" title="Remove" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:999px;border:1px solid ' + C.line2 + ';background:#fff;color:' + C.red + ';cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">' + icon('x', 11) + '</button>'
    + (act === 'cf-pend-del' ? '<div style="position:absolute;left:4px;bottom:4px;font-size:9.5px;font-weight:700;background:' + C.blue + ';color:#fff;border-radius:4px;padding:0 4px;">NEW</div>' : '') + '</div>';
  el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">'
    + m.images.map((im, i) => tile(im, 'cf-img-del', i)).join('')
    + m.pending.map((pd, i) => tile({ url: pd.preview }, 'cf-pend-del', i)).join('')
    + '<label style="width:72px;height:72px;border:1.5px dashed ' + C.line2 + ';border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;color:' + C.blue + ';font-size:11px;font-weight:600;background:' + C.card + ';">'
    + icon('upload', 16) + 'Add<input type="file" accept="image/*" multiple data-c="cf-files" style="display:none;"></label></div>'
    + (state.consentImagesField === false ? '<div style="margin-top:6px;font-size:12px;color:#B45309;">' + icon('alert', 12) + ' ' + esc(TBL.consent) + ' has no <b>images</b> field yet — add a Long text field named <b>images</b> so images can be saved.</div>' : '');
  fitRootToModal();
}

// Picked files -> previews (uploaded only when the form is saved)
async function addPendingImages(files) {
  const m = state.modal;
  for (const file of files) {
    try {
      const preview = await fileToDataUrl(file);
      if (state.modal !== m) return;
      m.pending.push({ file, preview });
    } catch (e) {
      console.error('[csa] image read failed', e);
    }
  }
  renderCfImages();
}

// Big Yes / No choice in the consent form (state.modal.yes)
function renderConsentChoice() {
  const el = Q('csaCfChoice');
  if (!el || !state.modal) return;
  const opt = (v, label, ink, bg, ic) => {
    const on = state.modal.yes === v;
    return '<button data-a="cf-yes" data-v="' + (v ? 1 : 0) + '" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;'
      + (on ? 'background:' + bg + ';color:' + ink + ';border:2px solid ' + ink + ';' : 'background:#fff;color:' + C.sub + ';border:2px solid ' + C.line + ';') + '">'
      + icon(ic, 15) + label + '</button>';
  };
  el.innerHTML = opt(true, 'Consent given', C.green, '#ECFDF5', 'checkCircle') + opt(false, 'Not given', C.red, '#FEF2F2', 'x');
}

// Typing a FIDE ID (new record) fills in a known player's name / mobile (only empty fields).
function consentFormLookup() {
  const fid = String(Q('csaCfFide').value).trim();
  const p = playerById(fid);
  const existing = !state.modal.consentId && findConsent(fid, '');
  if (p) {
    if (!Q('csaCfName').value.trim()) Q('csaCfName').value = p.player_name;
    if (!Q('csaCfMobile').value.trim()) Q('csaCfMobile').value = p.mobile_number;
  }
  Q('csaCfHint').textContent = existing
    ? 'This FIDE ID already has a consent record — saving will update it.'
    : p ? 'Found: ' + p.player_name + ' · ' + statusLabel(p.status) + '.' : 'Enter a FIDE ID to fill in a known player’s name and mobile.';
}

// Updates the record being edited (or the existing one for this FIDE ID / mobile), else adds one.
async function saveConsentForm(btn) {
  const fid = Q('csaCfFide').value.trim();
  const name = Q('csaCfName').value.trim();
  const mobile = Q('csaCfMobile').value.trim();
  const yes = !!state.modal.yes;
  if (!name) { modalMessage('Enter the player name.', 'error'); return; }
  if (!fid && !mobile) { modalMessage('Enter a FIDE ID or a mobile number.', 'error'); return; }
  if (fid && !/^\d+$/.test(fid)) { modalMessage('FIDE ID must be a number.', 'error'); return; }
  const values = { player_name: name, fide_id: fid ? Number(fid) : null, mobile_number: mobile || null, is_consent: yes };
  const id = state.modal.consentId || (findConsent(fid, mobile) || {}).id;
  const m = state.modal;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    // Upload new images first; each one leaves the "pending" list once it is stored.
    while (m.pending.length) {
      btn.textContent = 'Uploading image ' + (m.images.length + 1) + '…';
      m.images.push(await uploadImage(m.pending[0].file));
      m.pending.shift();
      renderCfImages();
    }
    const imagesChanged = m.images.length || (id && (state.consent.rows.find(r => String(r.id) === String(id)) || { images: [] }).images.length);
    if (imagesChanged) values.images = consentImagesValue(m.images);
    btn.textContent = 'Saving…';
    const warn = await saveConsentRecord(id, values, imagesChanged ? m.images : null);
    if (warn) {
      await loadConsent();
      modalMessage(warn, 'error');
      btn.disabled = false;
      btn.textContent = 'Save';
      return;
    }
    closeModal();
    await loadConsent((id ? 'Updated ' : 'Added ') + name + ' — consent ' + (yes ? 'given' : 'not given'));
  } catch (e) {
    console.error('[csa] consent save failed', e);
    modalMessage('Could not save: ' + errMsg(e, 'unknown error'), 'error');
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// Image viewer for one consent record: big preview, thumbnails, download one / all.
function openConsentGallery(id) {
  const rec = state.consent.rows.find(r => String(r.id) === String(id));
  if (!rec || !rec.images.length) return;
  openModal('gallery', 820, modalShell('image', 'Images — ' + esc(rec.player_name || 'player'),
    rec.images.length + (rec.images.length === 1 ? ' image' : ' images') + ' · consent ' + (rec.yes ? 'given' : 'not given'),
    '<div id="csaGal"></div>'), { images: rec.images, cur: 0, name: rec.player_name });
  renderGallery();
}

function renderGallery() {
  const m = state.modal;
  if (!m || m.kind !== 'gallery' || !Q('csaGal')) return;
  const im = m.images[m.cur];
  Q('csaGal').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;background:' + C.bg + ';border:1px solid ' + C.line + ';border-radius:12px;padding:10px;min-height:240px;">'
    + '<img src="' + esc(im.url) + '" alt="" style="max-width:100%;max-height:460px;object-fit:contain;border-radius:8px;"></div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap;">'
    + '<span style="font-size:12.5px;color:' + C.sub + ';flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (m.cur + 1) + ' / ' + m.images.length + ' · ' + esc(im.name || '') + '</span>'
    + '<button data-a="gal-dl" style="' + GHOST + '">' + icon('download', 14) + 'Download</button>'
    + (m.images.length > 1 ? '<button data-a="gal-dl-all" style="' + BTN(C.blue) + '">' + icon('download', 14) + 'Download all (' + m.images.length + ')</button>' : '')
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:8px;">'
    + m.images.map((x, i) => '<div data-a="gal-pick" data-i="' + i + '" style="cursor:pointer;border-radius:10px;padding:2px;border:2px solid ' + (i === m.cur ? C.blue : 'transparent') + ';">' + imageThumb(x, '', 60) + '</div>').join('')
    + '</div>';
  fitRootToModal();
}

function imageFileName(im, base, i) {
  const ext = (String(im.name || im.url).match(/\.[a-z0-9]{2,5}(?=$|\?)/i) || ['.jpg'])[0];
  return (String(base || 'consent').trim().replace(/[^a-zA-Z0-9]+/g, '_') || 'consent') + '_' + (i + 1) + ext;
}
function downloadImage(im, base, i) { downloadHref(im.url, imageFileName(im, base, i), true); }

// ── 1. Achievers ────────────────────────────────────────────────────────────
// cc_csoc_achievements record -> table row
function achRowFromDb(rec, i) {
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  return {
    _i: i,
    id: rec.id,
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
    // Follow-up (Achievement tab of the player pop-up)
    fu: rec.status === null || rec.status === undefined ? '' : String(rec.status),
    comment: rec.comment ? String(rec.comment) : '',
    connected_by: rec.connected_by ? String(rec.connected_by) : '',
    connected_at: rec.connected_date_time || '',
  };
}

// Follow-up status (cc_csoc_achievements.status) — label + colour
// list: the status options (default Achievements; meta.gotStatus for Got Rating)
function fuLabel(v, list) { const o = (list || meta.achStatus).find(x => x.value === String(v)); return o ? o.label : String(v || ''); }
const FU_TONE = {
  'consent received': ['#ECFDF5', '#047857', '#A7F3D0'], 'consent declined': ['#FEF2F2', '#B91C1C', '#FECACA'],
  'follow up': [C.blueLt, C.blueDk, '#DBEAFE'], pending: ['#FFFBEB', '#B45309', '#FDE68A'],
  rnr: ['#F5F3FF', '#6D28D9', '#DDD6FE'], 'not eligible': ['#F1F5F9', C.sub, C.line],
};
function fuChip(v, list) {
  if (!v) return '<span style="' + MUTED + '">—</span>';
  const tone = FU_TONE[fuLabel(v, list).toLowerCase()] || ['#F1F5F9', C.ink2, C.line];
  return '<span style="' + PILL(tone[0], tone[1], tone[2]) + '">' + esc(fuLabel(v, list)) + '</span>';
}
// An achievement row by id, from Achievers or the Follow-ups page
function findAchRow(id) {
  const same = r => String(r.id) === String(id);
  return state.ach.rows.find(same) || state.fu.rows.find(same) || null;
}
// "2026-10-05T09:12:00Z" -> "5 Oct 2026, 14:42" (local time)
function fmtDateTime(v) {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d)) return String(v || '');
  return d.getDate() + ' ' + MON_ABBR[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function rowMobile(r) { const p = playerById(r.fide_id); return r.mobile || (p && p.mobile_number) || ''; }
function achStatus(r) { const p = playerById(r.fide_id); return p ? p.status : ''; }
// Active in the month the tournament ended
function achActive(r) { return activeInMonth(r.fide_id, ymdToMonthKey(r.date)); }

const ACH_SORT_GET = {
  name: r => r.player_name || '',
  assignee: r => assigneeOf(rowMobile(r)),
  status: r => (achActive(r) ? 1 : 0),
  fu: r => fuLabel(r.fu),
  tournament: r => r.tournament_name || '',
  date: r => r.date || '',
  rank: r => r.rank || null,
  rc: r => r.rating_change,
};

// Consent explicitly declined (a consent record saying "No"); no record yet is not declined.
function consentDeclined(fid, mobile) { const c = findConsent(fid, mobile); return !!(c && !c.yes); }

// An assigned person sees only the results worth a follow-up: a FIDE-rated gain of +40 or more,
// or a top-5 finish — all in one list.
const MINE_MIN_GAIN = 40;
const MINE_MAX_RANK = 5;
function achWorthFollowup(r) {
  return (r.is_rated && r.rating_change !== null && r.rating_change >= MINE_MIN_GAIN) || (r.rank && r.rank <= MINE_MAX_RANK);
}

// Achievers is the to-do list: only results not followed up yet (no status) or marked Pending.
// Any other status takes the result off this list (Consent Received ones go to Create Poster).
function fuPendingValue() { const o = meta.achStatus.find(x => x.label.trim().toLowerCase() === 'pending'); return o ? o.value : 'Pending'; }
// Pending by stored value or by label (the select may store a key, or the label itself)
function achIsPending(r) {
  return !!r.fu && (r.fu === fuPendingValue() || String(r.fu).trim().toLowerCase() === 'pending' || fuLabel(r.fu).trim().toLowerCase() === 'pending');
}
function achToDo(r) { return !r.fu || achIsPending(r); }

// Rows shown: to-do, not consent-declined (a Pending result stays — it is still being worked on),
// and for an assigned person only their students' notable results
function achBase() {
  return state.ach.rows.filter(r => achToDo(r) && mineOk(rowMobile(r))
    && (achIsPending(r) || !consentDeclined(r.fide_id, rowMobile(r)))
    && (!state.mine || achWorthFollowup(r)));
}
// Got Rating: consent-declined players are hidden unless they already have a follow-up status
function gotBase() { return state.got.rows.filter(r => mineOk(rowMobile(r)) && (r.fu || !consentDeclined(r.fide_id, rowMobile(r)))); }

function achVisibleRows() {
  const a = state.ach;
  const s = a.search.trim().toLowerCase();
  let rows = achBase().filter(r => {
    if (a.filter === 'rated' && !r.is_rated) return false;
    if (a.filter === 'podium' && !(r.rank && r.rank <= 3)) return false;
    if (a.sub !== 'all' && achActive(r) !== (a.sub === 'active')) return false;
    if (a.fuFilter !== 'all' && (a.fuFilter === 'none' ? !!r.fu : !achIsPending(r))) return false;
    if (s && ![r.player_name, r.fide_id, r.tournament_name, rowMobile(r), assigneeOf(rowMobile(r))].some(v => String(v || '').toLowerCase().includes(s))) return false;
    return true;
  });
  if (a.sort.key) rows = sortRows(rows, ACH_SORT_GET[a.sort.key], a.sort.dir);
  return rows;
}

function renderAch() {
  const a = state.ach;
  // Assigned people get one combined list (rated +40 or top 5), so no FIDE rated / Podium buttons
  if (state.mine) a.filter = 'all';
  Q('csaFilter_ach').style.display = state.mine ? 'none' : '';
  Q('csaFilter_ach').innerHTML = state.mine ? '' : [['all', 'All results'], ['rated', 'FIDE rated'], ['podium', 'Podium']].map(f =>
    '<button data-a="filter" data-filter="' + f[0] + '" style="' + tabStyle(a.filter === f[0]) + 'padding:6px 12px;">' + f[1] + '</button>').join('');
  // Subscription status + follow-up status dropdowns (labels updated in place so an open dropdown stays open)
  const subOpts = [['all', 'Any status'], ['active', 'Active'], ['inactive', 'Inactive']];
  const fuOpts = [['all', 'Any follow-up'], ['none', 'No follow-up yet'], [fuPendingValue(), 'Pending']];
  const fill = (sel, opts, count, val) => {
    if (sel.options.length !== opts.length) sel.innerHTML = opts.map(o => '<option value="' + esc(o[0]) + '"></option>').join('');
    opts.forEach((o, i) => { sel.options[i].value = o[0]; sel.options[i].textContent = o[1] + (a.loaded && o[0] !== 'all' ? ' (' + count(o[0]) + ')' : ''); });
    sel.value = val;
  };
  const base = achBase();
  fill(Q('csaSub_ach'), subOpts, v => base.filter(r => achActive(r) === (v === 'active')).length, a.sub);
  fill(Q('csaFu_ach'), fuOpts, v => base.filter(r => (v === 'none' ? !r.fu : achIsPending(r))).length, a.fuFilter);
  const rows = achVisibleRows();

  const players = new Set(rows.map(r => r.fide_id)).size;
  const podium = rows.filter(r => r.rank && r.rank <= 3).length;
  const gained = rows.reduce((s, r) => s + (r.is_rated && r.rating_change > 0 ? r.rating_change : 0), 0);
  Q('csaKpis_ach').innerHTML = !a.loaded ? '' :
    kpi('Results', fmtNum(rows.length), C.blue, (state.mine ? 'rated +' + MINE_MIN_GAIN + ' or top ' + MINE_MAX_RANK + ' · ' : '') + monthLabel(a.month === 'All' ? 'All months' : a.month))
    + kpi('Players', fmtNum(players), '#0D9488', 'with a result')
    + kpi('Podium finishes', fmtNum(podium), '#F59E0B', 'rank 1–3')
    + kpi('Rating gained', '+' + fmtNum(gained), '#10B981', 'FIDE-rated events');

  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'Mobile' }, { label: 'Assigned to', sort: 'assignee' },
    { label: 'Status', sort: 'status' }, { label: 'Tournament', sort: 'tournament' }, { label: 'End date', sort: 'date' },
    { label: 'Rank', sort: 'rank' }, { label: 'Rating ±', sort: 'rc', num: true },
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
        + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, mobile, 'consent-player', r.id) + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(mobile || '—') + '</td>'
        + '<td style="' + TD + 'white-space:nowrap;">' + assigneeCell(mobile) + '</td>'
        + '<td style="' + TD + '" title="Subscription active in ' + esc(monthLabel(ymdToMonthKey(r.date))) + '?">' + activeChip(achActive(r)) + '</td>'
        + '<td style="' + TD + '">' + tourn
        + (r.is_rated ? ' <span style="background:' + C.blueLt + ';color:' + C.blueDk + ';border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;letter-spacing:.04em;margin-left:4px;">FIDE</span>' : '') + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(fmtYMD(r.date) || '—') + '</td>'
        + '<td style="' + TD + '">' + rankChip(r.rank) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + ratingDelta(r.rating_change) + '</td>'
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
    a.statusLine = [prefix + a.rows.length + ' results for ' + label, note ? 'ok' : ''];
    setStatus('ach', a.statusLine[0], a.statusLine[1]);
    achFillRatingChanges();
  } catch (e) {
    if (seq !== a.seq) return;
    console.error('[csa] achievements load failed', e);
    a.loaded = true;
    setStatus('ach', cached ? 'Showing the earlier copy — could not refresh.' : 'Could not load achievements: ' + errMsg(e, 'unknown error'), 'err');
  }
  renderAch();
  renderTabs();
}

// Results saved without a rating change (the search only looks up a player's first few
// tournaments, and chess-results can be slow to show older ones): look each one up on
// chess-results (/api/chess-results?tnr=&fide_id=) and save it. Rows that stay empty had no
// rated games; they are tried once per visit. A tournament that was never played (only its
// starting list is on chess-results, so the "rank" is the starting rank) is removed, unless
// someone already followed it up.
let achFillRunning = false;
let achRenderTimer = null;
async function achFillRatingChanges() {
  const a = state.ach;
  if (achFillRunning || a.busy) return;
  const todo = a.rows.filter(r => r.rating_change === null && r.tournament_id && r.fide_id && r.id !== undefined
    && !a.rcTried.has(r.tournament_id + '|' + r.fide_id));
  if (!todo.length) return;
  achFillRunning = true;
  let done = 0, filled = 0, removed = 0;
  try {
    await runPool(todo, 3, async r => {
      a.rcTried.add(r.tournament_id + '|' + r.fide_id);
      try {
        const d = await proxyGet('/api/chess-results', { tnr: r.tournament_id, fide_id: r.fide_id });
        if (d && d.ok && d.played === false) {
          if (!r.fu && !r.comment) {
            await dbDestroy(TBL.ach, r.id);
            a.rows = a.rows.filter(x => x.id !== r.id);
            Object.keys(a.cache).forEach(k => { a.cache[k] = a.cache[k].filter(rec => rec.id !== r.id); });
            removed++;
          }
        } else {
          const rc = d && d.ok && d.rating_change !== undefined && d.rating_change !== null ? Number(d.rating_change) : null;
          if (rc !== null && !isNaN(rc)) {
            await dbUpdate(TBL.ach, r.id, { rating_change: rc });
            filled++;
            // Every loaded copy: the table rows and the per-month caches
            a.rows.forEach(x => { if (x.id === r.id) x.rating_change = rc; });
            Object.keys(a.cache).forEach(k => a.cache[k].forEach(rec => { if (rec.id === r.id) rec.rating_change = rc; }));
          }
        }
      } catch (e) {
        console.warn('[csa] rating ± lookup failed', r.tournament_id, r.fide_id, e);
      }
      done++;
      setStatus('ach', 'Filling in rating ± from chess-results… ' + done + ' / ' + todo.length + (filled ? ' · ' + filled + ' found' : ''));
      if (!achRenderTimer) achRenderTimer = setTimeout(() => { achRenderTimer = null; renderAch(); }, 300);
    });
  } finally {
    achFillRunning = false;
  }
  const base = a.statusLine ? a.statusLine[0] + ' · ' : '';
  setStatus('ach', base + 'rating ± filled in for ' + filled + ' of ' + todo.length
    + (filled + removed < todo.length ? ' (the rest have no rated games on chess-results)' : '')
    + (removed ? ' · ' + removed + ' not played yet, removed' : ''), 'ok');
  renderAch();
  achFillRatingChanges(); // a month selected meanwhile
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
        if (t.played === false) { skipped++; continue; } // date passed but no round played (only a starting list)
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

// ── Create Poster page ─────────────────────────────────────────────────────
// Every followed-up achievement (any month), newest call first, filtered by status — opens on
// "Consent Received": who called and when, the comment, consent, the pictures and a Poster button.
async function loadFollowups() {
  const f = state.fu;
  f.loading = true;
  f.error = '';
  renderFollowups();
  try {
    await metaPromise;
    if (f.status === null) {
      const cr = meta.achStatus.find(o => o.label.trim().toLowerCase() === 'consent received');
      f.status = cr ? cr.value : 'all';
    }
    const recs = await fetchAll(TBL.ach, { filter: JSON.stringify({ status: { $in: meta.achStatus.map(o => o.value) } }) });
    f.rows = recs.map(achRowFromDb);
    f.loaded = true;
  } catch (e) {
    console.error('[csa] follow-ups load failed', e);
    f.error = 'Could not load follow-ups: ' + errMsg(e, 'unknown error');
  }
  f.loading = false;
  renderFollowups();
  renderTabs();
}

const FU_SORT_GET = {
  name: r => r.player_name || '',
  assignee: r => assigneeOf(rowMobile(r)),
  date: r => r.date || '',
  at: r => (r.connected_at ? new Date(r.connected_at).getTime() || null : null),
  rc: r => r.rating_change,
};

function fuVisibleRows() {
  const f = state.fu;
  const s = f.search.trim().toLowerCase();
  // A status changed in the pop-up moves the row to that status straight away
  let rows = f.rows.filter(r => r.fu && f.status !== null && (f.status === 'all' || r.fu === f.status) && mineOk(rowMobile(r))
    && (!s || [r.player_name, r.fide_id, r.tournament_name, rowMobile(r), assigneeOf(rowMobile(r)), r.connected_by, r.comment]
      .some(v => String(v || '').toLowerCase().includes(s))));
  if (f.sort.key) rows = sortRows(rows, FU_SORT_GET[f.sort.key], f.sort.dir);
  return rows;
}

function renderFollowups() {
  const f = state.fu;
  const sel = ctx.element.querySelector('select[data-c="fu-status"]');
  if (!sel) return;
  // Status options with counts (this user's rows), updated in place so an open dropdown stays open
  const opts = meta.achStatus.map(o => [o.value, o.label]).concat([['all', 'All statuses']]);
  if (sel.options.length !== opts.length) sel.innerHTML = opts.map(() => '<option></option>').join('');
  const mine = f.rows.filter(r => r.fu && mineOk(rowMobile(r)));
  opts.forEach((o, i) => {
    sel.options[i].value = o[0];
    sel.options[i].textContent = o[1] + (f.loaded ? ' (' + (o[0] === 'all' ? mine.length : mine.filter(r => r.fu === o[0]).length) + ')' : '');
  });
  if (f.status !== null) sel.value = f.status;

  const rows = fuVisibleRows();
  if (f.loading) setStatus('fu', 'Loading…');
  else if (f.error) setStatus('fu', f.error, 'err');
  else if (f.loaded) setStatus('fu', fmtNum(rows.length) + ' results · ' + (f.status === 'all' ? 'all statuses' : fuLabel(f.status)));

  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'Assigned to', sort: 'assignee' },
    { label: 'Result', sort: 'date' }, { label: 'Rating ±', sort: 'rc', num: true }, { label: 'Status', sort: 'at' },
    { label: 'Consent', center: true }, { label: 'Pictures' }, { label: 'Comment' }, { label: '', w: '1%' },
  ];
  const thead = '<thead><tr>' + cols.map(c => thCell('fu', c)).join('') + '</tr></thead>';
  let body;
  if (!f.loaded) body = emptyRow(cols.length, f.error ? esc(f.error) : 'Loading…');
  else if (!rows.length) body = emptyRow(cols.length, 'No results with this status yet — statuses are set in the Achievement tab of the player pop-up in Achievers.');
  else {
    f.page = Math.min(f.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = f.page * PAGE_SIZE;
    const small = 'font-size:11px;color:' + C.mute + ';';
    body = rows.slice(offset, offset + PAGE_SIZE).map((r, i) => {
      const mobile = rowMobile(r);
      const crec = findConsent(r.fide_id, mobile);
      const tourn = r.tournament_link
        ? '<a class="csa-t" href="' + esc(r.tournament_link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.tournament_name) + '</a>'
        : esc(r.tournament_name || '—');
      const consent = !crec ? '<span style="' + MUTED + '">—</span>' : crec.yes
        ? '<span style="' + PILL('#ECFDF5', '#047857', '#A7F3D0') + '">' + icon('checkCircle', 12) + 'Yes</span>'
        : '<span style="' + PILL('#FEF2F2', '#B91C1C', '#FECACA') + '">' + icon('x', 12) + 'No</span>';
      const pics = crec && crec.images.length
        ? '<button data-a="consent-imgs" data-id="' + esc(crec.id) + '" title="View / download pictures" style="display:inline-flex;align-items:center;gap:6px;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:#fff;cursor:pointer;">'
          + crec.images.slice(0, 4).map(im => imageThumb(im, '', 40)).join('')
          + '<span style="font-size:12px;font-weight:700;color:' + C.blue + ';padding:0 6px 0 2px;">' + crec.images.length + '</span></button>'
        : '<span style="' + MUTED + '">—</span>';
      return '<tr>'
        + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (offset + i + 1) + '</td>'
        + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, mobile, 'consent-player', r.id)
        + '<div style="' + small + '">' + esc(mobile || '—') + (r.fide_id ? ' · FIDE ' + esc(r.fide_id) : '') + '</div></td>'
        + '<td style="' + TD + 'white-space:nowrap;">' + assigneeCell(mobile) + '</td>'
        + '<td style="' + TD + 'max-width:280px;">' + tourn
        + '<div style="' + small + '">' + esc(fmtYMD(r.date) || '—') + (r.rank ? ' · rank #' + r.rank : '') + (r.is_rated ? ' · FIDE rated' : '') + '</div></td>'
        + '<td style="' + TD + 'text-align:right;">' + ratingDelta(r.rating_change) + '</td>'
        + '<td style="' + TD + 'white-space:nowrap;">' + fuChip(r.fu)
        + (r.connected_by || r.connected_at ? '<div style="' + small + '">' + esc(r.connected_by || '?') + (r.connected_at ? ' · ' + esc(fmtDateTime(r.connected_at)) : '') + '</div>' : '') + '</td>'
        + '<td style="' + TD + 'text-align:center;">' + consent + '</td>'
        + '<td style="' + TD + '">' + pics + '</td>'
        + '<td style="' + TD + 'max-width:260px;color:' + C.ink2 + ';white-space:normal;">' + (r.comment ? esc(r.comment) : '<span style="' + MUTED + '">—</span>') + '</td>'
        + '<td style="' + TD + '"><button data-a="poster-ach" data-i="' + esc(r.id) + '" style="' + BTN(C.blue) + 'padding:6px 12px;font-size:12px;">' + icon('image', 13) + 'Poster</button></td>'
        + '</tr>';
    }).join('');
  }
  Q('csaTable_fu').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_fu').innerHTML = f.loaded ? pagerHtml('fu', f.page, rows.length) : '';
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
  const r = { id: rec.id, player_name: String(rec.player_name || ''), fide_id: String(rec.fide_id || '').trim(), mobile: rec.mobile_number ? String(rec.mobile_number) : '' };
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
  const row = {
    _i: i, id: r.id, player_name: r.player_name, fide_id: r.fide_id, mobile: r.mobile,
    // follow-up (cc_csoc_got_rating.status / comment / connected_by / connected_date_time)
    fu: rec.status === null || rec.status === undefined ? '' : String(rec.status),
    comment: rec.comment ? String(rec.comment) : '',
    connected_by: rec.connected_by ? String(rec.connected_by) : '',
    connected_at: rec.connected_date_time || '',
  };
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
  assignee: r => assigneeOf(rowMobile(r)),
  status: r => statusLabel(achStatus(r)),
  fu: r => fuLabel(r.fu, meta.gotStatus),
  std: r => r.std || null,
  rap: r => r.rap || null,
  bli: r => r.bli || null,
};

// Got Rating filter: subscription active in the month of the new rating (row.period) —
// the same rule Rating Stats counts by, so the numbers match.
const GOT_STATUS_FILTERS = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']];
const gotStatusOk = (r, st) => st === 'all' || activeInMonth(r.fide_id, r.period) === (st === 'active');
// Student Progress: registration status of the latest registration
const PROG_STATUS_FILTERS = [[1, 'Active'], [2, 'Expired'], [3, 'Upcoming'], [5, 'Pause'], ['all', 'All']];

// Got Rating follow-up filter: 'all', 'none' (no status yet) or a status value
const gotFuOk = (r, v) => v === 'all' || (v === 'none' ? !r.fu : r.fu === v);

function gotVisibleRows() {
  const g = state.got;
  const s = g.search.trim().toLowerCase();
  let rows = gotBase().filter(r => gotStatusOk(r, g.status) && gotFuOk(r, g.fuFilter)
    && (!s || [r.player_name, r.fide_id, rowMobile(r), assigneeOf(rowMobile(r))].some(v => String(v || '').toLowerCase().includes(s))));
  if (g.sort.key) rows = sortRows(rows, GOT_SORT_GET[g.sort.key], g.sort.dir);
  return rows;
}

function renderGot() {
  const g = state.got;
  // Option labels are updated in place, so an open dropdown stays open while rows arrive.
  const sel = Q('csaFilter_got');
  if (!sel.options.length) sel.innerHTML = GOT_STATUS_FILTERS.map(f => '<option value="' + f[0] + '">' + f[1] + '</option>').join('');
  GOT_STATUS_FILTERS.forEach((f, i) => {
    sel.options[i].textContent = f[1] + (g.loaded ? ' (' + gotBase().filter(r => gotStatusOk(r, f[0])).length + ')' : '');
  });
  sel.value = String(g.status);
  // Follow-up status dropdown (counts within the registration-status filter)
  const fuSel = Q('csaFu_got');
  const fuOpts = [['all', 'Any follow-up'], ['none', 'No follow-up yet']].concat(meta.gotStatus.map(o => [o.value, o.label]));
  if (fuSel.options.length !== fuOpts.length) fuSel.innerHTML = fuOpts.map(o => '<option value="' + esc(o[0]) + '"></option>').join('');
  const fuBase = g.loaded ? gotBase().filter(r => gotStatusOk(r, g.status)) : [];
  fuOpts.forEach((o, i) => {
    fuSel.options[i].value = o[0];
    fuSel.options[i].textContent = o[1] + (g.loaded && o[0] !== 'all' ? ' (' + fuBase.filter(r => gotFuOk(r, o[0])).length + ')' : '');
  });
  fuSel.value = g.fuFilter;
  const rows = gotVisibleRows();
  Q('csaKpis_got').innerHTML = !g.loaded ? '' :
    kpi('New FIDE ratings', fmtNum(rows.length), C.blue, g.month === 'All' ? 'All months' : monthLabel(g.month))
    + kpi('Classical', fmtNum(rows.filter(r => r.std).length), '#2563EB', 'first standard rating')
    + kpi('Rapid', fmtNum(rows.filter(r => r.rap).length), '#0D9488', 'first rapid rating')
    + kpi('Blitz', fmtNum(rows.filter(r => r.bli).length), '#7C3AED', 'first blitz rating');

  const cols = [
    { label: '#', w: '1%' }, { label: 'Player', sort: 'name' }, { label: 'Mobile' }, { label: 'Assigned to', sort: 'assignee' },
    { label: 'Classical', sort: 'std', num: true }, { label: 'Rapid', sort: 'rap', num: true },
    { label: 'Blitz', sort: 'bli', num: true }, { label: 'Follow-up', sort: 'fu' },
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
    body = emptyRow(cols.length, g.rows.length ? 'No players match this status / search.'
      : 'No players saved for ' + esc(gotMonthLabel(g.month)) + '. Use “Fetch from API” to check a month, or “Fetch all ratings”.');
  } else {
    g.page = Math.min(g.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = g.page * PAGE_SIZE;
    body = rows.slice(offset, offset + PAGE_SIZE).map((r, i) => {
      const mobile = rowMobile(r);
      return '<tr>'
        + '<td style="' + TD + 'color:' + C.mute + ';font-size:12px;">' + (offset + i + 1) + '</td>'
        + '<td style="' + TD + '">' + playerCell(r.fide_id, r.player_name, mobile, 'consent-player', null, r._i) + '</td>'
        + '<td style="' + TD + 'color:' + C.sub + ';white-space:nowrap;">' + esc(mobile || '—') + '</td>'
        + '<td style="' + TD + 'white-space:nowrap;">' + assigneeCell(mobile) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.std, r.stdP) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.rap, r.rapP) + '</td>'
        + '<td style="' + TD + 'text-align:right;">' + cell(r.bli, r.bliP) + '</td>'
        + '<td style="' + TD + 'white-space:nowrap;">' + fuChip(r.fu, meta.gotStatus)
        + (r.comment ? '<div style="font-size:11px;color:' + C.sub + ';max-width:180px;white-space:normal;">' + esc(r.comment) + '</div>' : '') + '</td>'
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

// ── FIDE rating-history sources ─────────────────────────────────────────────
// Each fetch first checks which sources work right now and uses only those, in this order:
//   paris  — Vercel /api/fide-history (cdg1): ratings.fide.com, else Lichess's copy of the FIDE lists
//   us     — Vercel /api/fide-history-us (iad1)
//   lichess — Lichess's copy of the FIDE rating lists, called from this browser
//             (ratings.fide.com blocks cloud servers, Lichess rate-limits them; neither blocks a normal connection)
//   chesstools — api.chesstools.org directly
// → { ok:true, data:[{ period:'YYYY-MM', classical_rating, rapid_rating, blitz_rating }], source, name } | { ok:false, error }
const FIDE_PROBE_ID = '1503014'; // any valid FIDE ID
const FIDE_SOURCES = [
  { key: 'paris', label: 'Vercel · Paris', url: () => PROXY_BASE + '/api/fide-history', timeout: 30000 },
  { key: 'us', label: 'Vercel · US', url: () => PROXY_BASE + '/api/fide-history-us', timeout: 30000 },
  { key: 'lichess', label: 'Lichess', lookup: fid => lichessHistory(fid) },
  { key: 'chesstools', label: 'chesstools', url: () => 'https://api.chesstools.org/fide/player_history/', timeout: 10000, raw: true },
];
const fideSrc = { up: {}, checkedAt: 0, fails: {} };

// Lichess asks clients to wait a minute after a 429; every lookup waits out the pause.
let lichessPausedUntil = 0;
async function lichessGet(path) {
  for (let attempt = 0; ; attempt++) {
    const wait = lichessPausedUntil - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    try {
      return await extRequest('get', 'https://lichess.org/api/fide/player/' + path, undefined, undefined, 15000);
    } catch (e) {
      const status = e && e.response && e.response.status;
      if (status === 404) return null; // not on any FIDE list
      if (status === 429 && attempt < 2) { lichessPausedUntil = Math.max(lichessPausedUntil, Date.now() + 60000); continue; }
      throw e;
    }
  }
}

// /ratings → { standard:[YYYYMMRRRR…], rapid:[…], blitz:[…] }, one entry per month the rating changed.
async function lichessHistory(fid) {
  const [hist, info] = await Promise.all([lichessGet(encodeURIComponent(fid) + '/ratings'), lichessGet(encodeURIComponent(fid)).catch(() => null)]);
  if (hist && typeof hist !== 'object') return { ok: false, error: 'unexpected response' };
  const byPeriod = new Map();
  [['standard', 'classical_rating'], ['rapid', 'rapid_rating'], ['blitz', 'blitz_rating']].forEach(([key, field]) => {
    ((hist && hist[key]) || []).forEach(v => {
      const n = Number(v);
      if (!(n > 0)) return;
      const period = Math.floor(n / 1e6) + '-' + pad2(Math.floor(n / 1e4) % 100);
      const row = byPeriod.get(period) || { period, classical_rating: 0, rapid_rating: 0, blitz_rating: 0 };
      row[field] = n % 1e4;
      byPeriod.set(period, row);
    });
  });
  return { ok: true, data: [...byPeriod.values()], source: 'lichess', name: (info && info.name) || '' };
}

async function probeSource(src) {
  try {
    if (src.lookup) {
      const d = await src.lookup(FIDE_PROBE_ID);
      return !!(d && d.ok && d.data.length);
    }
    const d = await extRequest('get', src.url(), { fide_id: FIDE_PROBE_ID }, undefined, src.raw ? 6000 : 25000);
    return src.raw ? Array.isArray(d) && d.length > 0 : !!(d && d.ok);
  } catch (e) {
    return false;
  }
}

// Checks every source in parallel; returns the keys that work.
// Resolves as soon as the first source answers (or all have failed); slower probes keep
// running and switch their source on when they finish, so no lookup waits on a 25 s timeout.
async function checkFideSources() {
  FIDE_SOURCES.forEach(src => { fideSrc.fails[src.key] = 0; });
  await new Promise(resolve => {
    let left = FIDE_SOURCES.length;
    FIDE_SOURCES.forEach(src => {
      probeSource(src).then(ok => {
        fideSrc.up[src.key] = ok;
        if (ok) resolve();
        if (--left === 0) resolve();
      });
    });
  });
  fideSrc.checkedAt = Date.now();
  return FIDE_SOURCES.filter(src => fideSrc.up[src.key]).map(src => src.key);
}

async function fideHistory(fid) {
  const errors = [];
  for (const src of FIDE_SOURCES) {
    if (!fideSrc.up[src.key]) continue;
    try {
      if (src.lookup) {
        const d = await src.lookup(fid);
        if (d.ok) { fideSrc.fails[src.key] = 0; return d; }
        errors.push(src.key + ': ' + d.error);
      } else {
        const d = await extRequest('get', src.url(), { fide_id: fid }, undefined, src.timeout);
        if (src.raw && Array.isArray(d)) { fideSrc.fails[src.key] = 0; return { ok: true, data: d, source: src.key, name: '' }; }
        if (!src.raw && d && d.ok) { fideSrc.fails[src.key] = 0; return { ok: true, data: d.data || [], source: d.source || src.key, name: d.name || '' }; }
        errors.push(src.key + ': ' + ((d && d.error) || 'bad response'));
      }
    } catch (e) {
      errors.push(src.key + ': ' + errMsg(e, 'failed'));
    }
    // Failed 3 times in a row (e.g. FIDE blocked the server's IP mid-run): drop it for the rest of the run.
    if (++fideSrc.fails[src.key] >= 3) fideSrc.up[src.key] = false;
  }
  return { ok: false, error: errors.join('; ') || 'no working FIDE source' };
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
  state.got.log = { title, rows, byFid: new Map(rows.map(r => [r.fid, r])), filter: 'all', running: true, result: '', sources: Object.assign({}, fideSrc.up) };
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
    + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:12px;"><span style="color:' + C.sub + ';font-weight:600;">FIDE sources:</span>'
    + FIDE_SOURCES.map(src => {
      const ok = log.sources && log.sources[src.key];
      return '<span style="' + (ok ? PILL('#ECFDF5', '#047857', '#A7F3D0') : PILL('#F1F5F9', C.mute, C.line)) + '">' + (ok ? '✓ ' : '✗ ') + esc(src.label) + '</span>';
    }).join('') + '</div>'
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
    setStatus('got', 'Checking players who already have a rating, and which FIDE sources work…');
    const [rated, working] = await Promise.all([ratedFideIds(), checkFideSources()]);
    const todo = srcPlayers.filter(p => !rated.has(String(p.fide_id).trim()));
    const alreadyRated = srcPlayers.length - todo.length;
    if (todo.length && !working.length) {
      setStatus('got', 'No FIDE source is reachable right now. Try again in a few minutes.', 'err');
      startLog(month ? 'Fetch ratings — ' + monthLabel(month) : 'Fetch all ratings', [], []);
      state.got.log.running = false;
      state.got.log.result = 'Not started: no FIDE source is reachable.';
      renderLog();
      return;
    }
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
    const checkPlayer = async player => {
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
        if (!resp.name && fideSrc.up.chesstools) {
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
    };
    await runPool(todo, GOT_PARALLEL, checkPlayer);

    // One more try, slower, for players whose lookup failed (FIDE is often just busy).
    const retry = todo.filter(p => { const r = g.log.byFid.get(String(p.fide_id)); return r && r.status === 'error' && r.fetched === 'no'; });
    if (retry.length && !g.stop) {
      retry.forEach(p => logUpdate(p.fide_id, { status: 'queued', fetched: '', detail: 'Retrying…' }));
      setStatus('got', 'Retrying ' + retry.length + ' players whose lookup failed…');
      apiErrors = 0;
      await runPool(retry, 2, checkPlayer);
    }
    apiErrors = g.log.rows.filter(r => r.status === 'error' && r.fetched === 'no').length;

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
// 'all' counts each student once, even with two or three first ratings in the same month,
// so it can be smaller than Classical + Rapid + Blitz.
const STAT_COLS = [['all', 'Unique players'], ['std', 'Classical'], ['rap', 'Rapid'], ['bli', 'Blitz']];

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
    s.rows = s.rows.filter(r => mineOk(rowMobile(r))); // an assigned person: only their students
    // Group by period; active = a subscription overlaps that month (activeInMonth, as in Got Rating).
    const monthMap = {};
    s.rows.forEach(r => {
      const player = playerById(r.fide_id);
      const isActive = activeInMonth(r.fide_id, r.period);
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

// ── 4. Student Progress ─────────────────────────────────────────────────────
// One row per student (mobile number + name) from view_csoc_registration_new, status not 4 / 6:
// first subscription_start_date, last subscription_end_date (its class = batch code).
// Ratings: the FIDE rating in the start month vs. the end month (this month if the end is
// in the future), for Classical / Rapid / Blitz — loaded from the FIDE sources as rows are shown.
const PROG_DURATIONS = [
  ['all', 'Any duration'], ['0-3', 'Under 3 months', 0, 3], ['3-6', '3–6 months', 3, 6],
  ['6-12', '6–12 months', 6, 12], ['12-24', '1–2 years', 12, 24], ['24+', '2+ years', 24, Infinity],
];

// Whole months from 'YYYY-MM-DD' a to b
function monthsBetween(a, b) {
  const x = parseYMD(a), y = parseYMD(b);
  if (!x || !y) return null;
  return Math.max(0, (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth() - (y.getDate() < x.getDate() ? 1 : 0));
}
function fmtDuration(m) {
  if (m === null || m === undefined) return '—';
  if (m < 1) return '< 1 month';
  if (m < 12) return m + (m === 1 ? ' month' : ' months');
  return Math.floor(m / 12) + (m < 24 ? ' year' : ' years') + (m % 12 ? ' ' + (m % 12) + ' mo' : '');
}

async function loadProgress() {
  const p = state.prog;
  p.loading = true;
  p.error = '';
  renderProg();
  try {
    // No `fields`: the view's other columns aren't needed, but listing one it lacks would fail the request.
    // cc_csoc_registration fills in the subscription dates when the view doesn't return them.
    const [regs, users, subs] = await Promise.all([
      fetchAll(TBL.regView, {}),
      fetchAll(TBL.users, { filter: JSON.stringify({ fide_id: { $gt: 0 } }), fields: 'id,mobile_number,first_name,last_name,fide_id' }),
      fetchAll(TBL.reg, { fields: 'id,mobile_number,subscription_start_date,subscription_end_date,status' }).catch(e => {
        console.warn('[csa] ' + TBL.reg + ' dates not available for Student Progress', e);
        return [];
      }),
    ]);
    // Mobile (last 10 digits) -> first start / last end across its registrations (status 4 / 6 left out)
    const subDates = new Map();
    subs.forEach(s => {
      const st = Number(s.status);
      if (st === 4 || st === 6) return;
      const k = assigneeKey(s.mobile_number);
      const start = normEndDate(s.subscription_start_date), end = normEndDate(s.subscription_end_date);
      if (!k || (!start && !end)) return;
      const d = subDates.get(k) || { start: '', end: '' };
      if (start && (!d.start || start < d.start)) d.start = start;
      if (end && (!d.end || end > d.end)) d.end = end;
      subDates.set(k, d);
    });
    const startOf = r => normEndDate(r.subscription_start_date || r.start_date || r.subscription_start || r.sub_start_date);
    const endOf = r => normEndDate(r.subscription_end_date || r.end_date || r.subscription_end || r.sub_end_date);
    const usersByMobile = new Map();
    users.forEach(u => {
      const m = String(u.mobile_number || '').trim();
      if (m) usersByMobile.set(m, (usersByMobile.get(m) || []).concat(u));
    });
    const today = ymdOf(new Date());
    const groups = new Map();
    regs.forEach(r => {
      const st = Number(r.status);
      if (st === 4 || st === 6) return;
      const mobile = String(r.mobile_number || '').trim();
      const name = String(r.player_name || '').trim();
      if (!mobile && !name) return;
      const key = mobile + '|' + nameWords(name);
      let g = groups.get(key);
      if (!g) groups.set(key, g = { player_name: name, mobile_number: mobile, start: '', end: '', batch: '', status: 0, fide_id: '' });
      const start = startOf(r), end = endOf(r);
      if (start && (!g.start || start < g.start)) g.start = start;
      // Status + batch from the latest registration: latest end date, else (no dates in the view)
      // the most current status — active, then upcoming, pause, expired.
      const rank = ({ 1: 4, 3: 3, 5: 2, 2: 1 })[st] || 0;
      if (!g.pick || (end || '') > g.pick.end || ((end || '') === g.pick.end && rank > g.pick.rank)) {
        g.pick = { end: end || '', rank };
        if (end) g.end = end;
        g.batch = String(r.class || '').trim() || g.batch;
        g.status = st;
      }
      if (!g.batch && r.class) g.batch = String(r.class).trim();
      if (!g.fide_id && Number(r.fide_id) > 0) g.fide_id = String(r.fide_id).trim();
    });
    const studentsOnMobile = new Map();
    groups.forEach(g => studentsOnMobile.set(g.mobile_number, (studentsOnMobile.get(g.mobile_number) || 0) + 1));
    p.rows = [...groups.values()].map(g => {
      if (!g.fide_id) {
        // FIDE ID from cc_users: the user on this mobile with this name. When siblings share the
        // number only a name match counts; a lone student takes the mobile's only user.
        const cands = usersByMobile.get(g.mobile_number) || [];
        const n = nameWords(g.player_name);
        const u = cands.find(c => nameWords([c.first_name, c.last_name].join(' ')) === n)
          || (studentsOnMobile.get(g.mobile_number) === 1 && cands.length === 1 ? cands[0] : null);
        if (u) g.fide_id = String(u.fide_id).trim();
      }
      // Dates missing in the view: take them from cc_csoc_registration (same mobile number)
      const d = subDates.get(assigneeKey(g.mobile_number));
      if (d) {
        if (!g.start) g.start = d.start;
        if (!g.end) g.end = d.end;
      }
      const effEnd = g.end && g.end < today ? g.end : today;
      g.startYm = g.start.slice(0, 7);
      g.endYm = effEnd.slice(0, 7);
      g.endIsNow = !g.end || g.end >= today;
      g.months = g.start ? monthsBetween(g.start, effEnd) : null;
      return g;
    });
    progStatusCounts();
    p.visKey = '';
    p.loaded = true;
  } catch (e) {
    console.error('[csa] student progress load failed', e);
    p.error = 'Could not load students: ' + errMsg(e, 'unknown error');
  }
  p.loading = false;
  renderProg();
}

// Status dropdown counts over the students this user may see
function progStatusCounts() {
  const p = state.prog;
  p.statusCounts = new Map();
  p.visible = 0;
  p.rows.forEach(r => {
    if (!mineOk(r.mobile_number)) return;
    p.visible++;
    const n = statusNum(r.status);
    p.statusCounts.set(n, (p.statusCounts.get(n) || 0) + 1);
  });
}

// Last rating of `field` on a list up to month ym ('YYYY-MM'); hist sorted by period. 0 = unrated.
function ratingAt(hist, ym, field) {
  let v = 0;
  for (const h of hist) {
    if (h.period > ym) break;
    if (Number(h[field]) > 0) v = Number(h[field]);
  }
  return v;
}

// { state: 'ok'|'loading'|'err'|'nofide', std/rap/bli: { a: start rating, b: end rating, d: b - a | null } }
// Cached per row until its history entry changes — sorting and KPIs call this thousands of times.
const progMemo = new WeakMap();
function progRatings(r) {
  if (!r.fide_id) return { state: 'nofide' };
  const h = state.prog.hist.get(r.fide_id);
  if (!h || h.status === 'loading') return { state: 'loading' };
  if (h.status === 'err') return { state: 'err', error: h.error };
  const m = progMemo.get(r);
  if (m && m.h === h) return m.out;
  const out = { state: 'ok', source: h.source };
  GOT_TYPES.forEach(t => {
    const a = r.startYm ? ratingAt(h.data, r.startYm, t.rating) : 0;
    const b = ratingAt(h.data, r.endYm, t.rating);
    out[t.key] = { a, b, d: a && b ? b - a : null };
  });
  progMemo.set(r, { h, out });
  return out;
}

const PROG_SORT_GET = {
  name: r => r.player_name || '',
  dur: r => r.months,
  std: r => { const x = progRatings(r); return x.state === 'ok' ? x.std.d : null; },
  rap: r => { const x = progRatings(r); return x.state === 'ok' ? x.rap.d : null; },
  bli: r => { const x = progRatings(r); return x.state === 'ok' ? x.bli.d : null; },
};

// Students matching the filters (ratings loaded or not) — what the rating loader works through.
// Re-filtered/sorted only when a filter, the sort or (for rating sorts) the loaded ratings changed.
function progBaseRows() {
  const p = state.prog;
  const ratingSort = ['std', 'rap', 'bli'].includes(p.sort.key);
  const key = [p.rows.length, state.mine ? state.mine.size : '', p.search, p.status, p.duration, p.sort.key, p.sort.dir, ratingSort ? p.histVer : ''].join('|');
  if (key === p.visKey) return p.visRows;
  p.visKey = key;
  p.visRows = progFilterRows();
  return p.visRows;
}

// A rating moved between the two dates (gain, loss, or newly rated) in any of the three types
function progHasChange(r) {
  const x = progRatings(r);
  return x.state === 'ok' && GOT_TYPES.some(t => { const v = x[t.key]; return (v.d !== null && v.d !== 0) || (v.b > 0 && !v.a); });
}

// Rows shown: only students whose rating changed (rows with no change / no rating are left out)
let progShown = { key: '', rows: [] };
function progVisibleRows() {
  const base = progBaseRows();
  const key = state.prog.visKey + '|' + state.prog.histVer;
  if (progShown.key !== key || progShown.base !== base) progShown = { key, base, rows: base.filter(progHasChange) };
  return progShown.rows;
}
function progFilterRows() {
  const p = state.prog;
  const s = p.search.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  const dur = PROG_DURATIONS.find(d => d[0] === p.duration);
  let rows = p.rows.filter(r => {
    if (!mineOk(r.mobile_number)) return false;
    if (p.status !== 'all' && statusNum(r.status) !== p.status) return false;
    if (s && !(digits.length >= 3 && String(r.mobile_number).replace(/\D/g, '').includes(digits))
      && !r.player_name.toLowerCase().includes(s) && !String(r.mobile_number).includes(s)
      && !assigneeOf(r.mobile_number).toLowerCase().includes(s)) return false;
    if (dur && dur.length > 2 && !(r.months !== null && r.months >= dur[2] && r.months < dur[3])) return false;
    return true;
  });
  if (p.sort.key) rows = sortRows(rows, PROG_SORT_GET[p.sort.key], p.sort.dir);
  return rows;
}

let progTimer = null;
function scheduleProgRender() {
  if (progTimer) return;
  progTimer = setTimeout(() => { progTimer = null; if (state.tab === 'prog') renderProg(); }, 300);
}

// Loads rating histories for the rows on screen first, then the rest of the filtered rows.
// Re-reads the filter after every few players, so a new filter is served quickly.
async function progRatingsRun() {
  const p = state.prog;
  if (p.running || !p.loaded || Date.now() < p.blockedUntil) return;
  // Students matching the filters first, then everyone else this user may see — the status
  // dropdown counts "students with a change" for every status, so all ratings are needed.
  const pending = () => {
    const vis = progBaseRows();
    const ids = [], seen = new Set();
    vis.concat(p.rows.filter(r => mineOk(r.mobile_number))).forEach(r => {
      if (r.fide_id && !p.hist.has(r.fide_id) && !seen.has(r.fide_id)) { seen.add(r.fide_id); ids.push(r.fide_id); }
    });
    return ids;
  };
  if (!pending().length) return;
  p.running = true;
  const anyUp = () => FIDE_SOURCES.some(src => fideSrc.up[src.key]);
  try {
    if (!anyUp() || Date.now() - fideSrc.checkedAt > 10 * 60000) {
      setStatus('prog', 'Checking which FIDE sources work…');
      await checkFideSources();
    }
    // Each lane takes the next pending ID (current page first) as soon as it is free.
    const lane = async () => {
      while (anyUp()) {
        const fid = pending()[0];
        if (!fid) return;
        p.hist.set(fid, { status: 'loading' });
        const r = await fideHistory(fid);
        p.hist.set(fid, r.ok
          ? { status: 'ok', source: r.source, data: (r.data || []).map(x => ({ ...x, period: String(x.period || '').slice(0, 7) })).sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0)) }
          : { status: 'err', error: r.error });
        p.histVer++;
        scheduleProgRender();
      }
    };
    await Promise.all(Array.from({ length: GOT_PARALLEL }, lane));
    if (!anyUp()) p.blockedUntil = Date.now() + 60000; // no source: wait before probing again
  } finally {
    p.running = false;
    scheduleProgRender();
  }
}

function progCell(rs, x) {
  if (rs.state === 'loading') return '<span style="' + MUTED + '">…</span>';
  if (rs.state === 'nofide') return '<span style="' + MUTED + '" title="No FIDE ID for this student">—</span>';
  if (rs.state === 'err') return '<span style="color:' + C.red + ';font-weight:600;" title="' + esc(rs.error) + '">Not loaded</span>';
  if (!x.a && !x.b) return '<span style="' + MUTED + '">—</span>';
  const top = '<span><span style="color:' + C.sub + ';">' + (x.a || 'unrated') + '</span> → <b>' + (x.b || '—') + '</b></span>';
  let diff = '';
  if (x.d !== null) {
    const color = x.d > 0 ? C.green : x.d < 0 ? C.red : C.sub;
    diff = '<div style="font-weight:700;color:' + color + ';">' + (x.d > 0 ? '+' : '') + x.d + '</div>';
  } else if (x.b && !x.a) diff = '<div><span style="' + PILL('#ECFDF5', '#047857', '#A7F3D0') + 'padding:1px 7px;font-size:10.5px;">Newly rated</span></div>';
  return top + diff;
}

function renderProg() {
  const p = state.prog;
  const sel = ctx.element.querySelector('select[data-c="prog-duration"]');
  if (!sel.options.length) sel.innerHTML = PROG_DURATIONS.map(d => '<option value="' + d[0] + '">' + d[1] + '</option>').join('');
  sel.value = p.duration;
  // Status options (same as Got Rating) with counts, updated in place so an open dropdown stays open
  const stSel = ctx.element.querySelector('select[data-c="prog-status"]');
  if (!stSel.options.length) stSel.innerHTML = PROG_STATUS_FILTERS.map(f => '<option value="' + f[0] + '">' + f[1] + '</option>').join('');
  // Counts: students with a rating change, per latest-registration status
  const changed = new Map();
  let changedAll = 0;
  if (p.loaded) p.rows.forEach(r => {
    if (!mineOk(r.mobile_number) || !progHasChange(r)) return;
    changedAll++;
    const n = statusNum(r.status);
    changed.set(n, (changed.get(n) || 0) + 1);
  });
  PROG_STATUS_FILTERS.forEach((f, i) => {
    const n = !p.loaded ? null : f[0] === 'all' ? changedAll : (changed.get(f[0]) || 0);
    stSel.options[i].textContent = f[1] + (n === null ? '' : ' (' + n + ')');
  });
  stSel.value = String(p.status);
  const base = progBaseRows();
  const rows = progVisibleRows();

  // Status line + progress over every student matching the filters (ratings still loading included)
  const withFide = base.filter(r => r.fide_id);
  const done = withFide.filter(r => { const h = p.hist.get(r.fide_id); return h && h.status !== 'loading'; }).length;
  const failed = withFide.filter(r => { const h = p.hist.get(r.fide_id); return h && h.status === 'err'; }).length;
  const loadingMore = done < withFide.length;
  if (p.loading) setStatus('prog', 'Loading students…');
  else if (p.error) setStatus('prog', p.error, 'err');
  else if (p.loaded) {
    const noSource = Date.now() < p.blockedUntil && loadingMore;
    setStatus('prog', noSource ? 'No FIDE source is reachable right now — ratings can’t be loaded. Press Reload in a minute.'
      : fmtNum(rows.length) + ' students with a rating change'
        + (loadingMore ? ' · checking ratings ' + fmtNum(done) + ' / ' + fmtNum(withFide.length) + '…' : ' (of ' + fmtNum(base.length) + ' checked)')
        + (failed ? ' · ' + failed + ' could not be loaded (Reload retries them)' : ''), noSource ? 'err' : '');
  }
  setProgress('prog', p.loaded && p.running && loadingMore ? done / withFide.length * 100 : null);

  const rated = rows.map(r => progRatings(r)).filter(x => x.state === 'ok');
  const stdDiffs = rated.map(x => x.std.d).filter(d => d !== null);
  const avg = stdDiffs.length ? Math.round(stdDiffs.reduce((a, b) => a + b, 0) / stdDiffs.length) : null;
  const newly = rated.filter(x => GOT_TYPES.some(t => x[t.key].b && !x[t.key].a)).length;
  Q('csaKpis_prog').innerHTML = !p.loaded ? '' :
    kpi('Students', fmtNum(rows.length), C.blue, 'rating changed')
    + kpi('Avg classical change', avg === null ? '—' : (avg > 0 ? '+' : '') + avg, '#10B981', stdDiffs.length + ' rated at both dates')
    + kpi('Improved (classical)', fmtNum(stdDiffs.filter(d => d > 0).length), '#0D9488', 'rating went up')
    + kpi('Newly rated', fmtNum(newly), '#7C3AED', 'unrated at start, rated now');

  // Fixed widths for the text columns (long names wrap); the three rating columns share the rest.
  const PAD = '10px 8px';
  const cols = [
    { label: 'Player', sort: 'name', w: '210px', pad: PAD }, { label: 'Assigned to', w: '110px', pad: PAD },
    { label: 'Batch', w: '110px', pad: PAD }, { label: 'Status', w: '92px', pad: PAD },
    { label: 'Duration', sort: 'dur', w: '118px', pad: PAD },
    { label: 'Classical', sort: 'std', num: true, pad: PAD }, { label: 'Rapid', sort: 'rap', num: true, pad: PAD },
    { label: 'Blitz', sort: 'bli', num: true, pad: PAD },
  ];
  const thead = '<thead><tr>' + cols.map(c => thCell('prog', c)).join('') + '</tr></thead>';
  let body;
  if (!p.loaded) body = emptyRow(cols.length, p.error ? esc(p.error) : 'Loading students…');
  else if (!rows.length) body = emptyRow(cols.length, loadingMore ? 'Checking ratings… students whose rating changed appear here as they load.'
    : p.rows.length ? 'No students with a rating change match these filters.' : 'No students found.');
  else {
    p.page = Math.min(p.page, Math.ceil(rows.length / PAGE_SIZE) - 1);
    const offset = p.page * PAGE_SIZE;
    const small = 'font-size:11px;color:' + C.mute + ';overflow-wrap:anywhere;';
    const td = TD + 'padding:' + PAD + ';';
    body = rows.slice(offset, offset + PAGE_SIZE).map(r => {
      const rs = progRatings(r);
      return '<tr>'
        // Player, with mobile + FIDE ID underneath
        + '<td style="' + td + 'overflow-wrap:anywhere;">' + playerCell(r.fide_id, r.player_name, r.mobile_number)
        + '<div style="' + small + '">' + esc(r.mobile_number || '—') + (r.fide_id ? ' · FIDE ' + esc(r.fide_id) : '') + '</div></td>'
        + '<td style="' + td + 'font-size:12px;overflow-wrap:anywhere;">' + assigneeCell(r.mobile_number) + '</td>'
        // Batch fixed at 100px; long codes wrap
        + '<td style="' + td + 'color:' + C.sub + ';font-size:12px;white-space:normal;overflow-wrap:anywhere;">' + esc(r.batch || '—') + '</td>'
        + '<td style="' + td + '">' + statusChip(r.status) + '</td>'
        + '<td style="' + td + '"><div style="font-weight:600;">' + fmtDuration(r.months) + '</div>'
        + (r.endIsNow ? '<div style="' + small + '">rating as of ' + esc(monthLabel(normalizePeriod(r.endYm))) + '</div>' : '') + '</td>'
        + GOT_TYPES.map(t => '<td style="' + td + 'text-align:right;">' + progCell(rs, rs[t.key]) + '</td>').join('')
        + '</tr>';
    }).join('');
  }
  Q('csaTable_prog').innerHTML = thead + '<tbody>' + body + '</tbody>';
  Q('csaPager_prog').innerHTML = p.loaded ? pagerHtml('prog', p.page, rows.length) : '';
  progRatingsRun();
}

// ── Modal shell ─────────────────────────────────────────────────────────────
// headerExtra: buttons shown in the header, left of the close button
function modalShell(iconName, title, subtitle, body, headerExtra) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid ' + C.line + ';">'
    + '<div style="width:38px;height:38px;border-radius:10px;background:' + C.blueLt + ';color:' + C.blue + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + icon(iconName, 19) + '</div>'
    + '<div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:700;letter-spacing:-.01em;">' + title + '</div>'
    + (subtitle ? '<div style="color:' + C.sub + ';font-size:12.5px;margin-top:1px;">' + subtitle + '</div>' : '')
    + '</div>' + (headerExtra || '') + '<button data-a="close" title="Close" style="' + GHOST + 'padding:7px;">' + icon('x', 16) + '</button></div>'
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

// ── Player details page (click a player's name) ────────────────────────────
// Batch = view_csoc_registration_new.class for the player's mobile number; coach from
// cc_csoc_batch_name_mapping (group) or cc_csoc_personal_batch_details (1:1) — same
// lookups as circlechess-dashboard/student_activity.js.
const batchInfoCache = new Map();

async function loadBatchInfo(mobile, name) {
  const m = String(mobile || '').trim();
  if (!m) return null;
  if (batchInfoCache.has(m + '|' + name)) return batchInfoCache.get(m + '|' + name);
  const fields = 'player_name,mobile_number,status,class';
  let regs = await fetchAll(TBL.regView, { fields, filter: JSON.stringify({ mobile_number: { $eq: m } }) });
  // Same number stored with / without the country code
  if (!regs.length && mobileKey(m)) regs = await fetchAll(TBL.regView, { fields, filter: JSON.stringify({ mobile_number: { $includes: mobileKey(m) } }) });
  regs = regs.filter(r => String(r.class || '').trim());
  // Siblings can share a mobile number: prefer this player's own row, then active (1), then upcoming (3).
  const n = nameWords(name);
  const score = r => (n && nameWords(r.player_name) === n ? 10 : 0)
    + (Number(r.status) === 1 ? 2 : Number(r.status) === 3 ? 1 : 0);
  regs.sort((a, b) => score(b) - score(a));
  const reg = regs[0];
  let info = { batch: '', batchName: '', type: '', coach: '' };
  if (reg) {
    const code = String(reg.class).trim();
    const [group, personal] = await Promise.all([
      fetchAll(TBL.groupBatch, { fields: 'id,batch_name,batch_display_name,coach_name', filter: JSON.stringify({ batch_name: { $eq: code } }) }),
      fetchAll(TBL.personalBatch, { fields: 'id,batch_code,coach_name', filter: JSON.stringify({ batch_code: { $eq: code } }) }),
    ]);
    const row = group[0] || personal[0] || null;
    info = {
      batch: code,
      batchName: (group[0] && group[0].batch_display_name) || '',
      type: group[0] ? 'Group' : personal[0] ? 'Personal (1:1)' : '',
      coach: (row && row.coach_name) || '',
    };
  }
  batchInfoCache.set(m + '|' + name, info);
  return info;
}

function detailRow(label, valueHtml) {
  return '<div style="display:flex;gap:12px;padding:11px 14px;border-top:1px solid ' + C.grid + ';">'
    + '<div style="width:130px;flex-shrink:0;color:' + C.sub + ';font-size:12.5px;">' + label + '</div>'
    + '<div style="flex:1;font-weight:600;word-break:break-word;">' + valueHtml + '</div></div>';
}

function consentToggleHtml(yes) {
  return '<span style="font-weight:700;color:' + (yes ? C.green : C.red) + ';">' + (yes ? 'Consent given' : 'Consent not given') + '</span>';
}

// Achievement tab: the result, then consent + images (cc_csoc_cx_consent) and the
// follow-up status (required) + comment (cc_csoc_achievements), saved together by "Save".
function achPaneHtml(r) {
  const fact = (label, value) => '<div style="flex:1 1 120px;min-width:110px;"><div style="font-size:11px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;">' + label + '</div>'
    + '<div style="font-weight:600;margin-top:2px;">' + value + '</div></div>';
  const tourn = r.tournament_link
    ? '<a class="csa-t" href="' + esc(r.tournament_link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.tournament_name) + ' ' + icon('externalLink', 12) + '</a>'
    : esc(r.tournament_name || '—');
  return '<div style="border:1px solid ' + C.line + ';border-radius:12px;padding:14px 16px;margin-bottom:16px;background:' + C.card + ';">'
    + '<div style="font-weight:700;font-size:14px;margin-bottom:10px;">' + tourn
    + (r.is_rated ? ' <span style="background:' + C.blueLt + ';color:' + C.blueDk + ';border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;letter-spacing:.04em;margin-left:4px;">FIDE</span>' : '') + '</div>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;">'
    + fact('End date', esc(fmtYMD(r.date) || '—')) + fact('Rank', rankChip(r.rank)) + fact('Rating ±', ratingDelta(r.rating_change))
    + fact('Subscription', activeChip(achActive(r))) + fact('FIDE ID', esc(r.fide_id || '—'))
    + '</div></div>'
    + followupFormHtml(r, meta.achStatus);
}

// New rating tab (Got Rating): the first ratings, then the same consent / status / comment form,
// saved to cc_csoc_cx_consent and cc_csoc_got_rating.
function gotPaneHtml(r) {
  const fact = (label, value) => '<div style="flex:1 1 120px;min-width:110px;"><div style="font-size:11px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;">' + label + '</div>'
    + '<div style="font-weight:600;margin-top:2px;">' + value + '</div></div>';
  const rating = t => r[t.key]
    ? '<span style="color:' + C.blue + ';font-weight:700;">' + r[t.key] + '</span>' + (r[t.key + 'P'] ? ' <span style="font-size:11px;color:' + C.sub + ';">' + esc(monthLabel(r[t.key + 'P'])) + '</span>' : '')
    : '<span style="' + MUTED + '">—</span>';
  return '<div style="border:1px solid ' + C.line + ';border-radius:12px;padding:14px 16px;margin-bottom:16px;background:' + C.card + ';">'
    + '<div style="font-weight:700;font-size:14px;margin-bottom:10px;">First FIDE rating</div>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;">'
    + GOT_TYPES.map(t => fact(t.label, rating(t))).join('') + fact('FIDE ID', esc(r.fide_id || '—'))
    + '</div></div>'
    + followupFormHtml(r, meta.gotStatus);
}

// Consent + images, status (required) + comment (optional), Save
function followupFormHtml(r, statusList) {
  const opts = '<option value="">Select status…</option>' + statusList.map(o => '<option value="' + esc(o.value) + '"' + (o.value === r.fu ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
  return '<label style="' + LBL + '">Consent</label><div id="csaCfChoice" style="display:flex;gap:8px;"></div>'
    + '<label style="' + LBL + 'margin-top:14px;">Images</label><div id="csaCfImgs"></div>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;">'
    + '<div style="flex:1 1 220px;"><label style="' + LBL + '">Status <span style="color:' + C.red + ';">*</span></label>'
    + '<select id="csaFuStatus" style="' + INP + 'width:100%;cursor:pointer;">' + opts + '</select></div>'
    + '<div style="flex:2 1 300px;"><label style="' + LBL + '">Comment <span style="text-transform:none;font-weight:500;">(optional)</span></label>'
    + '<textarea id="csaFuComment" rows="2" placeholder="Notes from the call…" style="' + INP + 'width:100%;resize:vertical;font-family:inherit;">' + esc(r.comment) + '</textarea></div></div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap;">'
    + '<div id="csaFuLast" style="flex:1;font-size:12px;color:' + C.sub + ';">' + fuLastHtml(r) + '</div>'
    + '<button data-a="close" style="' + GHOST + '">Close</button>'
    + '<button data-a="fu-save" style="' + BTN(C.blue) + '">' + icon('checkCircle', 14) + 'Save</button></div>';
}
function fuLastHtml(r) {
  return r.connected_by || r.connected_at
    ? 'Last saved by <b>' + esc(r.connected_by || '?') + '</b>' + (r.connected_at ? ' · ' + esc(fmtDateTime(r.connected_at)) : '')
    : 'Not followed up yet';
}

function switchDetTab(tab) {
  ['profile', 'ach'].forEach(k => { const pane = Q('csaDetPane_' + k); if (pane) pane.style.display = k === tab ? 'block' : 'none'; });
  ctx.element.querySelectorAll('#csaDetTabs [data-a="det-tab"]').forEach(b => { b.setAttribute('style', tabStyle(b.getAttribute('data-tab') === tab)); });
  fitRootToModal();
}

// Saves the follow-up of an Achievers result (m.achId -> cc_csoc_achievements)
// or a Got Rating player (m.gotId -> cc_csoc_got_rating).
async function saveAchFollowup(btn) {
  const m = state.modal;
  const isGot = m.gotId !== undefined;
  const a = isGot ? state.got : state.ach;
  const tbl = isGot ? TBL.got : TBL.ach;
  const fields = isGot ? meta.gotFields : meta.achFields;
  const list = isGot ? meta.gotStatus : meta.achStatus;
  const r = isGot ? state.got.rows.find(x => String(x.id) === String(m.gotId)) : findAchRow(m.achId);
  if (!r) { modalMessage('This ' + (isGot ? 'player' : 'result') + ' is no longer loaded — reload the page.', 'error'); return; }
  const status = Q('csaFuStatus').value;
  const comment = Q('csaFuComment').value.trim();
  if (!status) { modalMessage('Select a status — it is required.', 'error'); Q('csaFuStatus').focus(); return; }
  btn.disabled = true;
  try {
    // 1. New images to storage
    while (m.pending.length) {
      btn.textContent = 'Uploading image ' + (m.images.length + 1) + '…';
      m.images.push(await uploadImage(m.pending[0].file));
      m.pending.shift();
      renderCfImages();
    }
    btn.textContent = 'Saving…';
    // 2. Consent + images -> cc_csoc_cx_consent — only when there is something to save: a consent
    //    record already exists, the Consent choice was clicked, or images were added. Otherwise the
    //    untouched default ("Not given") would be saved as a real "No".
    const crec = findConsent(m.fid, m.mobile);
    let warn = '';
    if (crec || m.yesTouched || m.images.length) {
      const cvals = { player_name: crec ? crec.player_name || m.name : m.name, fide_id: m.fid ? Number(m.fid) : null, mobile_number: m.mobile || null, is_consent: !!m.yes };
      const imgs = m.images.length || (crec && crec.images.length) ? m.images : null;
      if (imgs) cvals.images = consentImagesValue(imgs);
      warn = await saveConsentRecord(crec && crec.id, cvals, imgs);
    }
    // 3. Follow-up -> cc_csoc_achievements / cc_csoc_got_rating, stamped with who / when
    const user = await currentUserName();
    const now = new Date().toISOString();
    const avals = { status, connected_by: user, connected_date_time: now };
    if (!fields || fields.has('comment')) avals.comment = comment || null;
    await dbUpdate(tbl, r.id, avals);
    // Every loaded copy: the page's rows (+ Create Poster rows), the per-month caches
    const patch = { fu: status, comment, connected_by: user, connected_at: now };
    [a.rows].concat(isGot ? [] : [state.fu.rows]).forEach(rows => rows.forEach(x => { if (x.id === r.id) Object.assign(x, patch); }));
    Object.keys(a.cache).forEach(k => a.cache[k].forEach(rec => { if (rec.id === r.id) Object.assign(rec, avals); }));
    await loadConsent();
    if (isGot) renderGot(); else { renderAch(); renderFollowups(); }
    renderTabs();
    if (state.modal !== m) return;
    Q('csaFuLast').innerHTML = fuLastHtml(r);
    renderDetImages();
    const noComment = comment && fields && !fields.has('comment');
    const consentNote = crec || m.yesTouched || m.images.length ? ' · consent ' + (m.yes ? 'given' : 'not given') : '';
    modalMessage(warn || (noComment ? 'Saved — but the comment was not: ' + tbl + ' has no "comment" field.'
      : 'Saved: ' + fuLabel(status, list) + consentNote), warn || noComment ? 'error' : 'success');
  } catch (e) {
    console.error('[csa] follow-up save failed', e);
    modalMessage('Could not save: ' + errMsg(e, 'unknown error'), 'error');
  }
  btn.disabled = false;
  btn.innerHTML = icon('checkCircle', 14) + 'Save';
}

// achId (from an Achievers row): adds the Achievement tab — result details, consent + images
// (saved to cc_csoc_cx_consent) and the follow-up status / comment (saved to cc_csoc_achievements).
function openPlayerDetails(fid, name, mobile, achId, gotI) {
  const ach = achId ? findAchRow(achId) : null;
  // Got Rating row: gets a "New rating" follow-up tab (needs the record id)
  const got = !ach && gotI !== undefined && gotI !== null && gotI !== '' ? state.got.rows[Number(gotI)] || null : null;
  const fuRow = ach || (got && got.id !== undefined && got.id !== null ? got : null);
  // Poster for this result (Achievers / Follow-ups) or this new rating (Got Rating)
  const posterBtn = (act, i) => '<button data-a="' + act + '" data-i="' + esc(i) + '" style="' + GHOST + 'color:' + C.blue + ';">' + icon('image', 14) + 'Poster</button>';
  const headerExtra = ach ? posterBtn('poster-ach', ach.id) : got ? posterBtn('poster-got', Number(gotI)) : '';
  const p = playerById(fid) || {};
  const playerName = name || p.player_name || '';
  const mob = mobile || p.mobile_number || '';
  const yes = hasConsent(fid, mob);
  const fideLink = fid
    ? '<a href="https://ratings.fide.com/profile/' + esc(fid) + '" target="_blank" rel="noopener noreferrer" style="color:' + C.blue + ';text-decoration:none;">' + esc(fid) + ' ' + icon('externalLink', 12) + '</a>'
    : '<span style="' + MUTED + '">—</span>';
  const sub = p.subscription_start_date || p.subscription_end_date
    ? esc(fmtYMD(p.subscription_start_date) || '?') + ' – ' + esc(fmtYMD(p.subscription_end_date) || '?') : '<span style="' + MUTED + '">—</span>';
  const loading = '<span style="' + MUTED + 'font-weight:500;">Loading…</span>';
  const tabs = fuRow
    ? '<div id="csaDetTabs" style="' + SEG + 'margin-bottom:16px;">'
      + '<button data-a="det-tab" data-tab="profile" style="' + tabStyle(false) + '">' + icon('user', 14) + 'Player profile</button>'
      + '<button data-a="det-tab" data-tab="ach" style="' + tabStyle(true) + '">' + icon('trophy', 14) + (ach ? 'Achievement' : 'New rating') + '</button></div>'
    : '';
  const crec = findConsent(fid, mob);
  openModal('details', 760, modalShell('user', esc(playerName || 'Player'), ach ? esc(ach.tournament_name || 'Achievement') : fuRow ? 'New FIDE rating' : 'Player details',
    tabs
    + (fuRow ? '<div id="csaDetPane_ach">' + (ach ? achPaneHtml(ach) : gotPaneHtml(fuRow)) + '</div>' : '')
    + '<div id="csaDetPane_profile"' + (fuRow ? ' style="display:none;"' : '') + '>'
    // Consent: saved as soon as the box is ticked / unticked
    + '<label style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1.5px solid ' + (yes ? '#A7F3D0' : '#FECACA') + ';border-radius:12px;background:' + (yes ? '#ECFDF5' : '#FEF2F2') + ';cursor:pointer;margin-bottom:14px;" id="csaDetConsentBox">'
    + '<input type="checkbox" id="csaDetConsent" data-fid="' + esc(fid) + '" data-name="' + esc(playerName) + '" data-mobile="' + esc(mob) + '"' + (yes ? ' checked' : '')
    + ' style="width:20px;height:20px;cursor:pointer;accent-color:' + C.green + ';">'
    + '<span style="flex:1;"><span id="csaDetConsentLabel">' + consentToggleHtml(yes) + '</span>'
    + '<span style="display:block;font-size:12px;color:' + C.sub + ';">For posters and publicity · saved automatically</span></span>'
    + '<span id="csaDetConsentMsg" style="font-size:12px;font-weight:600;"></span></label>'
    + '<div id="csaDetImgs" data-fid="' + esc(fid) + '" data-name="' + esc(playerName) + '" data-mobile="' + esc(mob) + '" style="margin:-4px 0 14px;"></div>'
    + '<div style="border:1px solid ' + C.line + ';border-radius:12px;overflow:hidden;">'
    + '<div style="display:flex;gap:12px;padding:11px 14px;"><div style="width:130px;flex-shrink:0;color:' + C.sub + ';font-size:12.5px;">Player name</div><div style="flex:1;font-weight:700;">' + esc(playerName || '—') + '</div></div>'
    + detailRow('Mobile number', esc(mob || '—'))
    + detailRow('FIDE ID', fideLink)
    + detailRow('Status', statusChip(p.status))
    + detailRow('Subscription', sub)
    + detailRow('Batch', '<span id="csaDetBatch">' + loading + '</span>')
    + detailRow('Coach name', '<span id="csaDetCoach">' + loading + '</span>')
    + detailRow('Assigned to', assigneeCell(mob))
    + '</div>'
    + '<div style="display:flex;justify-content:flex-end;margin-top:16px;"><button data-a="close" style="' + BTN(C.blue) + '">Done</button></div>'
    + '</div>', headerExtra),
  fuRow ? Object.assign(ach ? { achId: ach.id } : { gotId: fuRow.id },
    { fuForm: true, fid: String(fid || ''), name: playerName, mobile: mob, yes: yes, images: crec ? crec.images.slice() : [], pending: [] }) : null);
  const modal = state.modal;
  renderDetImages();
  if (fuRow) { renderConsentChoice(); renderCfImages(); }
  loadBatchInfo(mob, p.player_name || playerName).then(info => {
    if (state.modal !== modal) return; // closed / replaced meanwhile
    Q('csaDetBatch').innerHTML = info && info.batch
      ? esc(info.batch) + (info.batchName ? ' <span style="color:' + C.sub + ';font-weight:500;">· ' + esc(info.batchName) + '</span>' : '')
        + (info.type ? ' <span style="' + PILL(C.blueLt, C.blueDk, '#DBEAFE') + 'margin-left:4px;">' + esc(info.type) + '</span>' : '')
      : '<span style="' + MUTED + '">' + (mob ? 'No batch found' : 'No mobile number') + '</span>';
    Q('csaDetCoach').innerHTML = info && info.coach ? esc(info.coach) : '<span style="' + MUTED + '">—</span>';
  }).catch(e => {
    console.error('[csa] batch lookup failed', e);
    if (state.modal !== modal) return;
    Q('csaDetBatch').innerHTML = '<span style="color:' + C.red + ';font-weight:500;">Could not load: ' + esc(errMsg(e, 'error')) + '</span>';
    Q('csaDetCoach').innerHTML = '<span style="' + MUTED + '">—</span>';
  });
}

// Consent images on the details page: thumbnails (click = viewer) + "Add images" (uploads and saves right away)
function renderDetImages(note, tone) {
  const el = Q('csaDetImgs');
  if (!el) return;
  const rec = findConsent(el.getAttribute('data-fid'), el.getAttribute('data-mobile'));
  const imgs = rec ? rec.images : [];
  el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
    + '<span style="font-size:12px;font-weight:600;color:' + C.sub + ';text-transform:uppercase;letter-spacing:.06em;margin-right:4px;">Images</span>'
    + (imgs.length
      ? '<button data-a="consent-imgs" data-id="' + esc(rec.id) + '" title="View / download" style="display:inline-flex;gap:6px;align-items:center;padding:3px;border:1px solid ' + C.line + ';border-radius:10px;background:#fff;cursor:pointer;">'
        + imgs.slice(0, 5).map(im => imageThumb(im, '', 40)).join('')
        + '<span style="font-size:12px;font-weight:700;color:' + C.blue + ';padding:0 6px;">' + (imgs.length > 5 ? '+' + (imgs.length - 5) + ' · ' : '') + 'View</span></button>'
      : '<span style="font-size:12.5px;' + MUTED + '">None yet</span>')
    + '<label style="' + GHOST + 'padding:5px 10px;font-size:12px;color:' + C.blue + ';">' + icon('upload', 13) + 'Add images'
    + '<input type="file" accept="image/*" multiple data-c="det-files" style="display:none;"></label>'
    + (note ? '<span style="font-size:12px;font-weight:600;color:' + (tone === 'err' ? C.red : tone === 'ok' ? C.green : C.sub) + ';">' + esc(note) + '</span>' : '')
    + '</div>';
  fitRootToModal();
}

async function uploadDetImages(files) {
  const el = Q('csaDetImgs');
  if (!el || !files.length) return;
  const fid = el.getAttribute('data-fid'), name = el.getAttribute('data-name'), mobile = el.getAttribute('data-mobile');
  const modal = state.modal;
  const rec = findConsent(fid, mobile);
  const images = rec ? rec.images.slice() : [];
  try {
    for (let i = 0; i < files.length; i++) {
      renderDetImages('Uploading ' + (i + 1) + ' / ' + files.length + '…');
      images.push(await uploadImage(files[i]));
    }
    // No consent record yet: create one with the current tick
    const box = Q('csaDetConsent');
    const values = rec ? { images: consentImagesValue(images) }
      : { player_name: name, fide_id: fid ? Number(fid) : null, mobile_number: mobile || null, is_consent: !!(box && box.checked), images: consentImagesValue(images) };
    const warn = await saveConsentRecord(rec && rec.id, values, images);
    await loadConsent();
    if (state.modal !== modal) return;
    // The Achievement tab's image list (if open) must not overwrite these on its own Save
    if (!warn && state.modal.images) { state.modal.images = images.slice(); renderCfImages(); }
    if (warn) renderDetImages(warn, 'err');
    else renderDetImages(files.length + (files.length === 1 ? ' image' : ' images') + ' saved ✓', 'ok');
  } catch (e) {
    console.error('[csa] image upload failed', e);
    if (state.modal === modal) renderDetImages('Upload failed: ' + errMsg(e, 'error'), 'err');
  }
}

// Ticking / unticking the consent box saves it straight away (update the player's record, or create one).
async function saveConsentToggle(el) {
  const fid = el.getAttribute('data-fid'), name = el.getAttribute('data-name'), mobile = el.getAttribute('data-mobile');
  const yes = el.checked;
  const msg = Q('csaDetConsentMsg');
  el.disabled = true;
  msg.style.color = C.sub;
  msg.textContent = 'Saving…';
  try {
    const values = { player_name: name, fide_id: fid ? Number(fid) : null, mobile_number: mobile || null, is_consent: yes };
    const rec = findConsent(fid, mobile);
    if (rec) await dbUpdate(TBL.consent, rec.id, values);
    else await dbCreate(TBL.consent, values);
    await loadConsent();
    // Keep the Achievement tab's consent choice in step with this box
    if (state.modal && state.modal.fuForm) { state.modal.yes = yes; renderConsentChoice(); }
    if (Q('csaDetConsentMsg')) {
      Q('csaDetConsentLabel').innerHTML = consentToggleHtml(yes);
      Q('csaDetConsentBox').style.borderColor = yes ? '#A7F3D0' : '#FECACA';
      Q('csaDetConsentBox').style.background = yes ? '#ECFDF5' : '#FEF2F2';
      Q('csaDetConsentMsg').style.color = C.green;
      Q('csaDetConsentMsg').textContent = 'Saved ✓';
    }
  } catch (e) {
    console.error('[csa] consent toggle save failed', e);
    el.checked = !yes;
    if (Q('csaDetConsentMsg')) { Q('csaDetConsentMsg').style.color = C.red; Q('csaDetConsentMsg').textContent = 'Not saved: ' + errMsg(e, 'error'); }
  }
  el.disabled = false;
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

// newTab: for files on another host (download= is ignored cross-origin, so open them in a tab
// instead of leaving NocoBase)
function downloadHref(href, filename, newTab) {
  const a = Q('csaDl');
  a.setAttribute('href', href);
  a.setAttribute('download', filename);
  if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else a.removeAttribute('target');
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

function openAchPoster(id) {
  const r = findAchRow(id);
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
const SORT_DEFAULT_DIR = { rc: -1, date: -1, std: -1, rap: -1, bli: -1, dur: -1, end: -1, at: -1 }; // numbers/dates: biggest/newest first

Q('csa').addEventListener('click', e => {
  if (e.target === Q('csaBackdrop')) { closeModal(); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const action = el.getAttribute('data-a');
  const scope = el.getAttribute('data-scope');
  if (action === 'tab') switchTab(el.getAttribute('data-tab'));
  else if (action === 'filter') {
    // FIDE rated: biggest rating gain first · Podium: rank 1, 2, 3
    const f = el.getAttribute('data-filter');
    state.ach.filter = f;
    state.ach.sort = f === 'rated' ? { key: 'rc', dir: -1 } : f === 'podium' ? { key: 'rank', dir: 1 } : { key: null, dir: 1 };
    state.ach.page = 0;
    renderAch();
  }
  else if (action === 'det-tab') switchDetTab(el.getAttribute('data-tab'));
  else if (action === 'fu-save') saveAchFollowup(el);
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
  else if (action === 'refresh') {
    if (scope === 'ach') loadAch();
    else if (scope === 'got') loadGot();
    else if (scope === 'fu') { loadFollowups(); loadConsent(); }
    else if (scope === 'prog') {
      // Keep loaded ratings; retry the ones that failed.
      state.prog.hist.forEach((h, fid) => { if (h.status === 'err') state.prog.hist.delete(fid); });
      state.prog.histVer++;
      state.prog.blockedUntil = 0;
      loadProgress();
    } else loadConsent();
  }
  else if (action === 'consent-add') openConsentForm();
  else if (action === 'consent-edit') openConsentForm({ id: el.getAttribute('data-id') });
  else if (action === 'consent-player') openPlayerDetails(el.getAttribute('data-fid'), el.getAttribute('data-name'), el.getAttribute('data-mobile'), el.getAttribute('data-ach'), el.getAttribute('data-got'));
  else if (action === 'cf-yes') { state.modal.yes = el.getAttribute('data-v') === '1'; state.modal.yesTouched = true; renderConsentChoice(); }
  else if (action === 'cf-img-del') { state.modal.images.splice(Number(el.getAttribute('data-i')), 1); renderCfImages(); }
  else if (action === 'cf-pend-del') { state.modal.pending.splice(Number(el.getAttribute('data-i')), 1); renderCfImages(); }
  else if (action === 'consent-imgs') openConsentGallery(el.getAttribute('data-id'));
  else if (action === 'gal-pick') { state.modal.cur = Number(el.getAttribute('data-i')) || 0; renderGallery(); }
  else if (action === 'gal-dl') { const m = state.modal; downloadImage(m.images[m.cur], m.name, m.cur); }
  else if (action === 'gal-dl-all') {
    // One at a time: browsers drop downloads fired in the same instant
    const m = state.modal;
    m.images.forEach((im, i) => setTimeout(() => downloadImage(im, m.name, i), i * 600));
  }
  else if (action === 'consent-save') saveConsentForm(el);
  else if (action === 'fetch') { if (scope === 'ach') confirmFetchAch(); else confirmFetchGot(); }
  else if (action === 'fetch-all') confirmFetchAllRatings();
  else if (action === 'fetch-log') openLog();
  else if (action === 'fetch-stop') { state.got.stop = true; renderLog(); }
  else if (action === 'log-filter') { if (state.got.log) { state.got.log.filter = el.getAttribute('data-filter'); renderLog(); } }
  else if (action === 'player') openPlayerDetails(el.getAttribute('data-fid'), el.getAttribute('data-name'), el.getAttribute('data-mobile'));
  else if (action === 'poster-ach') openAchPoster(el.getAttribute('data-i'));
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
  } else if (c === 'prog-status') {
    state.prog.status = t.value === 'all' ? 'all' : Number(t.value);
    state.prog.page = 0;
    renderProg();
  } else if (c === 'prog-duration') {
    state.prog.duration = t.value;
    state.prog.page = 0;
    renderProg();
  } else if (c === 'fu-status') {
    state.fu.status = t.value;
    state.fu.page = 0;
    renderFollowups();
    renderTabs();
  } else if (c === 'ach-sub' || c === 'ach-fu') {
    state.ach[c === 'ach-sub' ? 'sub' : 'fuFilter'] = t.value;
    state.ach.page = 0;
    renderAch();
  } else if (c === 'gstatus' || c === 'got-fu') {
    state.got[c === 'gstatus' ? 'status' : 'fuFilter'] = t.value;
    state.got.page = 0;
    renderGot();
  } else if (c === 'cf-files' || c === 'det-files') {
    const files = Array.from(t.files || []);
    t.value = ''; // the same file can be picked again
    if (c === 'cf-files') addPendingImages(files); else uploadDetImages(files);
  } else if (t.id === 'csaDetConsent') {
    saveConsentToggle(t);
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
loadAssignees();
metaPromise.then(() => renderAch()); // follow-up status labels from the field setup
loadAch();
loadGot();
loadAssets(); // warm poster artwork
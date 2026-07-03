// Vercel serverless function — proxies chess-results.com player search
// Query: ?fide_id=XXXXX&from_date=01.07.2026&to_date=31.07.2026

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { fide_id, from_date, to_date } = req.query;
  if (!fide_id) return res.status(200).json({ ok: false, error: 'Missing fide_id' });

  const CR_BASE = 'https://s1.chess-results.com';

  async function rawReq(url, opts = {}, cookies = []) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
      ...(opts.headers || {}),
    };
    const r = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
    const text = await r.text();
    const setCookie = r.headers.get('set-cookie');
    const resCookies = setCookie ? setCookie.split(',').map(c => c.split(';')[0].trim()).filter(Boolean) : [];
    return { status: r.status, text, cookies: resCookies };
  }

  function mergeCookies(a, b) {
    const m = {};
    [...a, ...b].forEach(c => { const [k] = c.split('='); if (k) m[k] = c; });
    return Object.values(m);
  }

  async function getViewState() {
    const r = await rawReq(`${CR_BASE}/SpielerSuche.aspx?lan=1&SNode=S0`);
    const vs  = (r.text.match(/id="__VIEWSTATE"\s+value="([^"]+)"/)          || [])[1] || '';
    const vsg = (r.text.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/) || [])[1] || '';
    const ev  = (r.text.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/)    || [])[1] || '';
    return { vs, vsg, ev, cookies: r.cookies };
  }

  function parseSearchHtml(html, targetFideId) {
    const rows = [];
    for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cellsRaw = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (cellsRaw.length < 9) continue;
      const cells = cellsRaw.map(m => ({
        raw: m[1],
        text: m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&[a-z]+;/g,'').replace(/\s+/g,' ').trim(),
      }));
      if (cells[2] && cells[2].text !== String(targetFideId)) continue;
      const tnrMatch = cells[5] && cells[5].raw.match(/href="(tnr\d+\.aspx[^"]+)"/i);
      const link = tnrMatch ? tnrMatch[1] : null;
      const tnrNum = link ? (link.match(/tnr(\d+)/) || [])[1] : null;
      const rankTxt = cells[7] ? cells[7].text : '';
      const rank = rankTxt === '-' || rankTxt === '' ? null : (parseInt(rankTxt) || null);
      rows.push({
        player_name_cr: cells[0] ? cells[0].text : '',
        tournament_name: cells[5] ? cells[5].text : '',
        tournament_link: link ? `${CR_BASE}/${link}` : (tnrNum ? `${CR_BASE}/tnr${tnrNum}.aspx?lan=1` : null),
        tournament_link_raw: link || null,
        tournament_id: tnrNum || null,
        date: cells[6] ? cells[6].text : '',
        rank,
      });
    }
    return rows;
  }

  async function getRatingFromTournament(tournId, fideId, playerLink) {
    if (!tournId) return { rating_change: null, is_rated: false };
    const fideStr = String(fideId);

    function parseRatingRow(html) {
      let is_rated = false, rating_change = null;
      for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        if (!trm[1].includes(fideStr)) continue;
        const cells = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(m => m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
        // Signed number = rating change (e.g. +8, -3, +0.8)
        const changeCell = cells.find(c => /^[+\-]\d+(\.\d+)?$/.test(c));
        // 4-digit numbers in chess rating range = rated event
        const ratingCells = cells.filter(c => /^\d{4}$/.test(c) && parseInt(c) > 999 && parseInt(c) < 3500);
        if (ratingCells.length > 0) is_rated = true;
        if (changeCell) rating_change = parseFloat(changeCell);
        if (is_rated || rating_change !== null) break;
      }
      return { rating_change, is_rated };
    }

    try {
      // Try the player-specific page first (has snr, art=9 — shows player's tournament results)
      if (playerLink) {
        // Swap art=9 for art=4 (cross-table with ratings) to get rating info
        const crossUrl = `${CR_BASE}/${playerLink.replace(/\bart=\d+/, 'art=4')}`;
        const cr = await rawReq(crossUrl);
        if (cr.status === 200) {
          const res = parseRatingRow(cr.text);
          if (res.is_rated || res.rating_change !== null) return res;
        }
        // Also try art=1 (result list with initial/final rating)
        const listUrl = `${CR_BASE}/${playerLink.replace(/\bart=\d+/, 'art=1')}`;
        const lr = await rawReq(listUrl);
        if (lr.status === 200) {
          const res = parseRatingRow(lr.text);
          if (res.is_rated || res.rating_change !== null) return res;
        }
      }
      // Fallback: tournament detail page
      const r = await rawReq(`${CR_BASE}/tnr${tournId}.aspx?lan=1&art=0&turdet=YES`);
      if (r.status !== 200) return { rating_change: null, is_rated: false };
      return parseRatingRow(r.text);
    } catch (_) { return { rating_change: null, is_rated: false }; }
  }

  try {
    const { vs, vsg, ev, cookies } = await getViewState();
    if (!vs) return res.status(200).json({ ok: false, error: 'Could not get ViewState from chess-results' });

    const enc = s => encodeURIComponent(s);
    const fd = from_date || '01.01.2026';
    const td = to_date   || '31.12.2026';
    const body = [
      '__LASTFOCUS=','__EVENTTARGET=','__EVENTARGUMENT=',
      '__VIEWSTATE=' + enc(vs),
      '__VIEWSTATEGENERATOR=' + enc(vsg),
      '__EVENTVALIDATION=' + enc(ev),
      'ctl00%24P1%24txt_nachname=','ctl00%24P1%24txt_vorname=',
      'ctl00%24P1%24txt_verein=','ctl00%24P1%24txt_ident=',
      'ctl00%24P1%24txt_fideID=' + fide_id,
      'ctl00%24P1%24txt_von_tag=' + enc(fd),
      'ctl00%24P1%24txt_bis_tag=' + enc(td),
      'ctl00%24P1%24txt_GJahr=','ctl00%24P1%24txt_min_elo=',
      'ctl00%24P1%24txt_FED=','ctl00%24P1%24txt_Fed_tur=',
      'ctl00%24P1%24combo_Sort=0',
      'ctl00%24P1%24combo_anzahl_zeilen=1',
      'ctl00%24P1%24cb_suchen=Search',
    ].join('&');

    const url = `${CR_BASE}/SpielerSuche.aspx?lan=1&SNode=S0`;
    const sr = await rawReq(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url },
      body,
    }, cookies);

    if (sr.status !== 200) return res.status(200).json({ ok: false, error: 'chess-results search HTTP ' + sr.status });

    const tournaments = parseSearchHtml(sr.text, fide_id);

    // Enrich each tournament with rating info (up to 5 tournaments to avoid timeout)
    for (const t of tournaments.slice(0, 5)) {
      const info = await getRatingFromTournament(t.tournament_id, fide_id, t.tournament_link_raw);
      t.rating_change = info.rating_change;
      t.is_rated = info.is_rated;
    }

    res.status(200).json({ ok: true, tournaments });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
}

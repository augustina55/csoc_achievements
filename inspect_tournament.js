const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    }).on('error', reject);
  });
}

(async () => {
  // Check art=1 (overall ranking)
  const html = await get('https://s1.chess-results.com/tnr1433960.aspx?lan=1&art=1');

  // Find header row
  const headers = [];
  for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...trm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length > 5 && (cells.includes('Rk.') || cells.includes('Name'))) {
      console.log('HEADER:', cells.join(' | '));
      break;
    }
  }

  // Find player row by FIDE ID
  const fideId = '547022051';
  let found = false;
  for (const trm of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!trm[1].includes(fideId)) continue;
    const cells = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim());
    console.log('PLAYER ROW (art=1):', cells.join(' | '));
    found = true;
    break;
  }
  if (!found) console.log('Player not found in art=1');

  // Also check art=0 (starting list)
  const html0 = await get('https://s1.chess-results.com/tnr1433960.aspx?lan=1&art=0');
  for (const trm of html0.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...trm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    if (cells.length > 5 && (cells.includes('SNo') || cells.includes('Name'))) {
      console.log('HEADER art=0:', cells.join(' | '));
      break;
    }
  }
  for (const trm of html0.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!trm[1].includes(fideId)) continue;
    const cells = [...trm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim());
    console.log('PLAYER ROW (art=0):', cells.join(' | '));
    // Also get the snr from link href
    const snrMatch = trm[1].match(/snr=(\d+)/);
    if (snrMatch) console.log('SNR:', snrMatch[1]);
    break;
  }
})().catch(console.error);

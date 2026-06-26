const https = require('https');
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
    }).on('error', reject);
  });
}

(async () => {
  // art=9 individual player result page (snr=79 from starting list)
  const r = await get('https://s1.chess-results.com/tnr1433960.aspx?lan=1&art=9&snr=79');
  const html = r.text;

  console.log('Status:', r.status);

  // Strip HTML and show relevant content
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

  // Show first 2000 chars of cleaned text
  console.log(text.substring(0, 3000));
})().catch(console.error);

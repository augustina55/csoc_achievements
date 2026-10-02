// TEMPORARY: can this Vercel region reach ratings.fide.com? (removed after testing)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const t = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let ip = null;
  try { ip = (await (await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) })).json()).ip; } catch (e) {}
  try {
    const r = await fetch('https://ratings.fide.com/a_chart_data.phtml?event=5046831&period=0', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' },
    });
    const body = await r.text();
    res.status(200).json({ region: process.env.VERCEL_REGION, ip, status: r.status, ms: Date.now() - t, body: body.slice(0, 60) });
  } catch (e) {
    res.status(200).json({ region: process.env.VERCEL_REGION, ip, error: ctrl.signal.aborted ? 'timeout' : e.message, code: e.cause && (e.cause.code || e.cause.name), ms: Date.now() - t });
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  const fide_id = req.query.fide_id;
  if (!fide_id) return res.status(400).json({ ok: false, error: 'Missing fide_id' });

  try {
    const r = await fetch(
      'https://api.chesstools.org/fide/player_history/?fide_id=' + encodeURIComponent(fide_id)
    );
    if (!r.ok) return res.status(200).json({ ok: false, error: 'chesstools API ' + r.status });
    const data = await r.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ ok: true, data });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
}

export default function handler(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}
// deployed Fri Dec  5 23:34:22 CST 2025

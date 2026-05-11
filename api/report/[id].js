import { list } from '@vercel/blob';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const { blobs } = await list({ prefix: id, limit: 1 });
  const blob = blobs[0];
  if (!blob) return res.status(404).json({ error: 'Report not found' });

  const upstream = await fetch(blob.url);
  if (!upstream.ok) return res.status(502).json({ error: 'Failed to fetch report' });

  const content = await upstream.text();
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(content);
}

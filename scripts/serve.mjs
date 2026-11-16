// Tiny static server for local previews: node scripts/serve.mjs → http://localhost:8080/site/?data=/data-preview/real/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const root = path.resolve('.');
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end('not found'); }
}).listen(process.env.PORT || 8080, () => console.log('serving on', process.env.PORT || 8080));

// Local dev server. The game is a static site (GitHub Pages serves it the same
// way); online play is peer-to-peer, so no game server is needed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const ALLOWED = /^\/(index\.html|style\.css|(?!server\.js)[a-z-]+\.js|shared\/[a-z-]+\.js)$/;

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const rel = url === '/' ? '/index.html' : url;
  if (!ALLOWED.test(rel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Quantum Checkers dev server: http://localhost:${PORT}`));

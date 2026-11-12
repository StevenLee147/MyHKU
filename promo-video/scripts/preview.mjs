import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routes = new Map([
  ['/', { path: '../public/watch.html', type: 'text/html; charset=utf-8' }],
  ['/logo.svg', { path: '../public/brand/logo.svg', type: 'image/svg+xml' }],
  ['/poster.png', { path: '../out/myhku-poster.png', type: 'image/png' }],
  ['/film.mp4', { path: '../out/myhku-launch-1080p.mp4', type: 'video/mp4' }],
]);
const port = Number(process.env.MYHKU_PREVIEW_PORT || 8188);
const server = createServer(async (req, res) => {
  const route = routes.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!route || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
  try {
    const path = fileURLToPath(new URL(route.path, import.meta.url));
    const { size } = await stat(path);
    const headers = { 'Content-Type': route.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      const start = match ? Number(match[1]) : -1;
      const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start < 0 || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      if (req.method === 'HEAD') res.end(); else createReadStream(path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
      if (req.method === 'HEAD') res.end(); else createReadStream(path).pipe(res);
    }
  } catch { res.writeHead(404).end('Render the film and poster first: npm run render; npm run poster'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`MyHKU film preview: http://127.0.0.1:${port}`));

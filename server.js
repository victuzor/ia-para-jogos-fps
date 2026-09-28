import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname);
const publicPaths = new Set(['/index.html', '/src/style.css', '/src/game.js', '/src/ai.js', '/src/world.js', '/src/config.js']);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!publicPaths.has(pathname)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const extension = target.slice(target.lastIndexOf('.'));
    if (!mime[extension]) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[extension], 'Cache-Control': 'no-store' }).end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(3000, '127.0.0.1', () => {
  process.stdout.write('FPS disponível em http://127.0.0.1:3000\n');
});

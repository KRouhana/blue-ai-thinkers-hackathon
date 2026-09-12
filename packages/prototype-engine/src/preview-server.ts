import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assetsRoot } from './runtime.js';

const args = JSON.parse(process.argv[2]) as { source: string; meta: string; port: number; dependencyRoot: string; collectorPath?: string; publicHosts?: string[] };
const bridge = await readFile(path.join(assetsRoot, 'bridge.js'), 'utf8');
const collector = args.collectorPath ? await readFile(args.collectorPath, 'utf8') : undefined;
const metadata = JSON.parse(await readFile(args.meta, 'utf8')) as { hostOrigin: string };
const vite = await createServer({
  root: args.source,
  configFile: false,
  envFile: false,
  clearScreen: false,
  cacheDir: path.join(args.source, '.fork-cache/vite'),
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1', port: args.port, strictPort: true, cors: false,
    allowedHosts: ['127.0.0.1', 'localhost', ...(args.publicHosts ?? [])],
    fs: { strict: true, allow: [args.source, args.dependencyRoot], deny: ['**/.env*', '**/*.{pem,key,p12,pfx}', '**/.git/**', '**/.npmrc'] },
  },
  plugins: [{
    name: 'fork-preview-bridge',
    transformIndexHtml: () => [
      { tag: 'script', attrs: { type: 'module', src: '/__fork/bridge.js' }, injectTo: 'head' as const },
      ...(collector ? [{ tag: 'script', attrs: { type: 'module', src: '/__fork/collector.js' }, injectTo: 'head' as const }] : []),
    ],
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:${args.port}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${metadata.hostOrigin}`);
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end(); return; }
        const pathname = request.url?.split('?')[0];
        if (pathname !== '/__fork/meta' && pathname !== '/__fork/bridge.js' && pathname !== '/__fork/collector.js') { next(); return; }
        response.setHeader('Cache-Control', 'no-store');
        try {
          response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'application/json');
          if (pathname === '/__fork/collector.js' && !collector) { response.statusCode = 404; response.end(); return; }
          response.end(pathname === '/__fork/bridge.js' ? bridge : pathname === '/__fork/collector.js' ? collector : await readFile(args.meta, 'utf8'));
        } catch { response.statusCode = 503; response.end(); }
      });
    },
  }],
});
await vite.listen();
process.send?.({ kind: 'listening', url: `http://127.0.0.1:${args.port}` });
process.on('message', message => {
  const request = message as { kind?: string; operationId?: string };
  if (request.kind !== 'invalidate' || typeof request.operationId !== 'string') return;
  // File watcher delivery is asynchronous; explicitly invalidate before C opens the verification page.
  vite.moduleGraph.invalidateAll();
  vite.ws.send({ type: 'full-reload' });
  process.send?.({ kind: 'invalidated', operationId: request.operationId });
});
let closing = false;
async function close() { if (closing) return; closing = true; await vite.close(); process.exit(0); }
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
process.on('disconnect', () => { void close(); });

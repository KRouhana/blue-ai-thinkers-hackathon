import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

export default defineConfig(() => {
  const root = path.resolve(import.meta.dirname, '../..');
  const env = { ...loadEnv('', root, ''), ...process.env };
  if (env.FORK_MODE && !['fixture', 'live'].includes(env.FORK_MODE)) throw new Error('FORK_MODE must be fixture or live.');
  const projectMode = env.FORK_PROJECT_MODE || 'existing_repo';
  if (!['existing_repo', 'blank_template'].includes(projectMode)) throw new Error('FORK_PROJECT_MODE must be existing_repo or blank_template.');
  const fixture = (env.FORK_MODE || 'fixture') === 'fixture';
  const api = new URL(env.FORK_API_BASE || 'http://127.0.0.1:8787');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || !['http:', 'https:'].includes(api.protocol) || api.username || api.password) throw new Error('FORK_API_BASE must be a credential-free loopback API URL.');
  const previewOrigin = new URL(env.FORK_PREVIEW_ORIGIN || 'http://127.0.0.1:4173').origin;
  const frameOrigin = fixture ? 'http://127.0.0.1:4173' : previewOrigin;
  return {
    cacheDir: path.resolve(root, 'node_modules/.vite-meeting'),
    resolve: { alias: { 'fork-perception': env.FORK_PERCEPTION_MODULE || path.resolve(import.meta.dirname, 'src/integration/capture-unavailable.ts') } },
    define: {
      'import.meta.env.FORK_MODE': JSON.stringify(fixture ? 'fixture' : 'live'),
      'import.meta.env.FORK_PREVIEW_ORIGIN': JSON.stringify(frameOrigin),
      'import.meta.env.FORK_PROJECT_CONFIG_ID': JSON.stringify(env.FORK_PROJECT_CONFIG_ID || 'demo-product'),
      'import.meta.env.FORK_PROJECT_MODE': JSON.stringify(projectMode),
    },
    server: {
      host: '127.0.0.1', port: 3000, strictPort: true, cors: false,
      headers: { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `frame-src ${frameOrigin}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'` },
      proxy: fixture ? undefined : { '/api': {
        target: api.origin, changeOrigin: false,
        configure(proxy) {
          proxy.on('proxyReq', request => {
            request.removeHeader('authorization');
            request.removeHeader('cookie');
            if (env.FORK_API_TOKEN) request.setHeader('Authorization', `Bearer ${env.FORK_API_TOKEN}`);
          });
        },
      } },
    },
    plugins: [{
      name: 'fork-local-api-boundary',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const host = req.headers.host;
          const allowed = host === '127.0.0.1:3000' || host === 'localhost:3000';
          if (!allowed) { res.statusCode = 403; res.end('Unrecognized local host'); return; }
          if (!req.url?.startsWith('/api')) { next(); return; }
          // No browser-controlled arbitrary proxy paths or methods.
          const route = req.url.split('?')[0];
          const permitted = /^\/api\/sessions(?:\/[A-Za-z0-9_-]+(?:\/(?:events|controls|capture|observations|transcription-connection))?)?$/.test(route) || /^\/api\/jobs\/[A-Za-z0-9_-]+$/.test(route);
          const origin = req.headers.origin;
          if (!permitted || !['GET','POST'].includes(req.method || '') || (origin && origin !== `http://${host}`) || (req.method === 'POST' && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
            res.statusCode = 403; res.end('Request rejected by the local workspace boundary'); return;
          }
          if (fixture) { res.statusCode = 503; res.end('Fixture mode has no live API'); return; }
          if (!env.FORK_API_TOKEN) { res.statusCode = 503; res.end('FORK_API_TOKEN is required for live mode'); return; }
          next();
        });
      },
    }],
  };
});

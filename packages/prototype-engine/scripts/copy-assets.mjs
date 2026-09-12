import { cp, mkdir } from 'node:fs/promises';
const destination = new URL('../dist/assets/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../../../fixtures/empty-product/', import.meta.url), new URL('template/', destination), { recursive: true, filter: path => !path.includes('node_modules') });
await cp(new URL('../../../apps/preview/src/bridge.js', import.meta.url), new URL('bridge.js', destination));

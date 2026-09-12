import { chromium, type Browser } from 'playwright';
import { error, safeText, type BrowserEvidence, type PreviewMetadata } from './types.js';

export class PreviewVerifier {
  private browser?: Browser;
  constructor(private executablePath?: string, private timeoutMs = 20_000) {}
  async check(url: string, expected: PreviewMetadata, signal?: AbortSignal): Promise<BrowserEvidence> {
    const diagnostics: string[] = [];
    let compile: BrowserEvidence['compile'] = 'passed';
    if (signal?.aborted) throw error('CANCELLED', 'Verification cancelled.');
    this.browser ??= await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: this.executablePath });
    const context = await this.browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const abort = () => { void context.close(); };
    signal?.addEventListener('abort', abort, { once: true });
    const origin = new URL(url).origin;
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) { diagnostics.push('External network request blocked during local verification.'); return route.abort(); }
        return route.continue();
      });
      await page.routeWebSocket(/.*/, socket => {
        const destination = new URL(socket.url());
        if (destination.hostname === new URL(url).hostname && destination.port === new URL(url).port) socket.connectToServer();
        else socket.close();
      });
      page.on('pageerror', e => diagnostics.push(safeText(e.message)));
      page.on('response', response => {
        if (response.status() >= 400 && ['script', 'document'].includes(response.request().resourceType())) {
          compile = 'failed'; diagnostics.push(`HTTP ${response.status()} loading ${new URL(response.url()).pathname}`);
        }
      });
      page.on('console', message => { if (message.type() === 'error') diagnostics.push(safeText(message.text())); });
      await page.goto(url, { waitUntil: 'load', timeout: this.timeoutMs });
      await page.waitForFunction(expected => {
        const rendered = (window as unknown as { __forkRendered?: PreviewMetadata }).__forkRendered;
        return rendered?.instanceId === expected.instanceId && rendered.operationId === expected.operationId && rendered.revision.source === expected.revision.source && rendered.revision.config === expected.revision.config;
      }, expected, { timeout: this.timeoutMs });
      await page.waitForTimeout(300);
      if (await page.locator('vite-error-overlay').count()) { compile = 'failed'; diagnostics.push('Vite compile error overlay is present.'); }
      const visibleContent = await page.locator('body').innerText();
      if (visibleContent.trim().length === 0) diagnostics.push('Page has no visible text content; canvas-only targets need a custom verifier.');
      return { compile, page: diagnostics.length === 0 ? 'rendered' : 'failed', diagnostics: diagnostics.slice(0, 12) };
    } catch (e) {
      if (signal?.aborted) throw error('CANCELLED', 'Verification cancelled.');
      return { compile, page: 'failed', diagnostics: [...diagnostics, safeText(String(e))].slice(0, 12) };
    } finally { signal?.removeEventListener('abort', abort); await context.close(); }
  }
  async close(): Promise<void> { await this.browser?.close(); this.browser = undefined; }
}

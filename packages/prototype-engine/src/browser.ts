import { chromium, type Browser } from 'playwright';
import { error, safeText, type BrowserEvidence, type PreviewMetadata } from './types.js';
import type { PreviewPatch } from './types.js';

export class PreviewVerifier {
  private browser?: Browser;
  constructor(private executablePath?: string, private timeoutMs = 20_000) {}
  async check(url: string, expected: PreviewMetadata, signal?: AbortSignal, patch?: PreviewPatch): Promise<BrowserEvidence> {
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
      if (patch) {
        const target = page.locator(`[data-fork-id="${patch.elementId}"]`);
        if (await target.count() !== 1) diagnostics.push('Patch target is missing or duplicated.');
        else {
          const applied = await target.evaluate((element, patch) => {
            const style = getComputedStyle(element);
            if (patch.kind === 'set_label') return element.textContent?.trim() === patch.value;
            if (patch.kind === 'set_visibility') return (style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0) === patch.value;
            if (patch.kind === 'set_size') {
              const padding = { sm: ['8px', '12px'], md: ['12px', '20px'], lg: ['18px', '28px'], xl: ['24px', '36px'] }[patch.value];
              return style.paddingTop === padding[0] && style.paddingLeft === padding[1];
            }
            if (patch.kind === 'set_background') return style.backgroundColor === { neutral: 'rgb(38, 50, 71)', blue: 'rgb(36, 89, 206)', red: 'rgb(171, 51, 64)', green: 'rgb(34, 113, 81)', amber: 'rgb(134, 91, 18)' }[patch.value];
            return style.borderTopLeftRadius === { none: '0px', sm: '4px', md: '10px', pill: '999px' }[patch.value];
          }, patch);
          if (!applied) diagnostics.push('The registered component did not render the requested config value.');
        }
      }
      return { compile, page: diagnostics.length === 0 ? 'rendered' : 'failed', diagnostics: diagnostics.slice(0, 12) };
    } catch (e) {
      if (signal?.aborted) throw error('CANCELLED', 'Verification cancelled.');
      return { compile, page: 'failed', diagnostics: [...diagnostics, safeText(String(e))].slice(0, 12) };
    } finally { signal?.removeEventListener('abort', abort); await context.close(); }
  }
  async close(): Promise<void> { await this.browser?.close(); this.browser = undefined; }
}

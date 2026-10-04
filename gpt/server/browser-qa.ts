import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserCase, BrowserEvidence, BrowserStep, Check, Task } from '../shared/types.js';
import { ProjectRuntime, ProjectRuntimeError, compileContract } from './runtime.js';
import { LocalBrowserRuntime, LocalProjectRuntimeError } from './local-verification.js';

export interface BrowserReport { evidence: BrowserEvidence[]; checks: Check[]; images: string[]; }
export interface BrowserSession { inspect(): Promise<string>; run(tests: BrowserCase[]): Promise<BrowserReport>; close(): Promise<void>; }
export type OpenBrowser = (task: Task, signal: AbortSignal, onEvent: (text: string) => void) => Promise<BrowserSession>;

export function coverageChecks(task: Task, tests: BrowserCase[]): Check[] {
  const ids = new Set<string>();
  if (!tests.length || tests.length > 40) throw new Error('QA harus menyediakan 1–40 skenario browser.');
  for (const test of tests) {
    if (!test.id || ids.has(test.id) || !test.steps.length || test.steps.length > 80) throw new Error('ID skenario harus unik dan berisi 1–80 langkah.');
    ids.add(test.id);
  }
  return (task.criteria || []).map(criterion => ({ name: `Cakupan ${criterion.id}`, passed: tests.some(test => test.criterionId === criterion.id && test.steps.some(step => step.action.startsWith('expect') || step.action === 'api')), detail: criterion.description }));
}
function localURL(base: string, relative = '/') {
  const url = new URL(relative, base);
  if (url.origin !== new URL(base).origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('QA hanya boleh membuka runtime project ini.');
  return url.href;
}
function locator(page: Page, selector?: string) { if (!selector || selector.length > 500) throw new Error('Selector browser tidak valid.'); return page.locator(selector); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function eventually(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(description);
}
async function expectObserved(read: () => Promise<unknown>, expected: unknown, description: string) {
  let actual: unknown;
  try { await eventually(async () => { actual = await read(); return actual === expected; }, description); }
  catch { throw new Error(`${description} Expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}.`); }
}
async function execute(page: Page, context: BrowserContext, runtime: ProjectRuntime | LocalBrowserRuntime, step: BrowserStep) {
  const base = runtime.url;
  const value = step.value || '';
  switch (step.action) {
    case 'goto': await page.goto(localURL(base, value), { waitUntil: 'domcontentloaded' }); break;
    case 'reload': await page.reload({ waitUntil: 'domcontentloaded' }); break;
    case 'click': await locator(page, step.selector).click(); break;
    case 'fill': await locator(page, step.selector).fill(value); break;
    case 'press': if (step.selector) await locator(page, step.selector).press(value); else await page.keyboard.press(value); break;
    case 'select': await locator(page, step.selector).selectOption(value); break;
    case 'check': await locator(page, step.selector).check(); break;
    case 'uncheck': await locator(page, step.selector).uncheck(); break;
    case 'hover': await locator(page, step.selector).hover(); break;
    case 'focus': await locator(page, step.selector).focus(); break;
    case 'rapidClick': {
      const box = await locator(page, step.selector).boundingBox();
      if (!box || !step.count || step.count < 2 || step.count > 5) throw new Error('Rapid click membutuhkan elemen terlihat dan count 2–5.');
      for (let i = 0; i < step.count; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      break;
    }
    case 'expectText': await eventually(async () => (await locator(page, step.selector).innerText()).includes(value), `Teks yang diharapkan tidak ditemukan: ${value}`); break;
    case 'expectExactText': await expectObserved(async () => (await locator(page, step.selector).innerText()).trim(), value, `Teks ${step.selector} tidak sama persis.`); break;
    case 'expectValue': await eventually(async () => await locator(page, step.selector).inputValue() === value, `Nilai input berbeda: ${value}`); break;
    case 'expectCount': if (!Number.isInteger(step.count) || step.count! < 0) throw new Error('Count tidak valid.'); await eventually(async () => await locator(page, step.selector).count() === step.count, `Jumlah elemen berbeda: ${step.count}`); break;
    case 'expectVisible': await locator(page, step.selector).waitFor({ state: 'visible' }); break;
    case 'expectHidden': await locator(page, step.selector).waitFor({ state: 'hidden' }); break;
    case 'expectDisabled': await eventually(async () => locator(page, step.selector).isDisabled(), 'Kontrol tidak disabled.'); break;
    case 'expectEnabled': await eventually(async () => locator(page, step.selector).isEnabled(), 'Kontrol tidak aktif kembali.'); break;
    case 'expectAttribute': if (!step.attribute) throw new Error('Nama attribute wajib.'); await eventually(async () => await locator(page, step.selector).getAttribute(step.attribute!) === value, 'Attribute tidak sesuai.'); break;
    case 'expectStyle': if (!step.property || !/^[a-zA-Z-]+$/.test(step.property)) throw new Error('Properti CSS tidak valid.'); await expectObserved(() => locator(page, step.selector).evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), step.property!), value, `Computed style ${step.selector} ${step.property} tidak sesuai.`); break;
    case 'expectNoOverflow': await eventually(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Konten meluber horizontal.'); break;
    case 'expectMinSize': {
      const box = await locator(page, step.selector).boundingBox();
      if (!box || box.width < (step.width || 0) || box.height < (step.height || 0)) throw new Error('Target kontrol lebih kecil dari ukuran minimum.');
      break;
    }
    case 'expectRequestCount': {
      const target = new URL(localURL(base, value));
      await eventually(async () => runtime.caseRequests.filter(request => request.path === target.pathname && request.method === (step.method || 'GET')).length === step.count, 'Jumlah request berbeda.');
      break;
    }
    case 'seedData': await runtime.seedTestData(step.body || value); break;
    case 'mockResponse':
    case 'delayResponse': {
      const url = localURL(base, value);
      if (step.action === 'mockResponse' && (!step.status || step.status < 200 || step.status > 599)) throw new Error('Mock membutuhkan status HTTP valid.');
      if (step.action === 'delayResponse' && (!step.delayMs || step.delayMs < 100 || step.delayMs > 3000)) throw new Error('Delay harus 100–3000ms.');
      if (step.body) JSON.parse(step.body);
      await page.route(url, async route => {
        if (step.method && route.request().method() !== step.method) return route.fallback();
        if (step.action === 'mockResponse') await route.fulfill({ status: step.status, contentType: 'application/json', body: step.body || '{}' });
        else { await new Promise(resolve => setTimeout(resolve, step.delayMs)); await route.continue(); }
        await page.unroute(url);
      });
      break;
    }
    case 'expectUrl': await eventually(async () => page.url() === localURL(base, value), 'URL tidak sesuai.'); break;
    case 'viewport': if (!step.width || !step.height || step.width < 320 || step.width > 2560 || step.height < 300 || step.height > 1800) throw new Error('Viewport di luar batas.'); await page.setViewportSize({ width: step.width, height: step.height }); break;
    case 'reducedMotion': await page.emulateMedia({ reducedMotion: value === 'true' ? 'reduce' : 'no-preference' }); break;
    case 'offline': await context.setOffline(value === 'true'); break;
    case 'api': {
      if (!Number.isInteger(step.status)) throw new Error('Tes API membutuhkan status yang diharapkan.');
      if (runtime instanceof LocalBrowserRuntime) runtime.observe(step.method || 'GET', localURL(base, value));
      const response = await context.request.fetch(localURL(base, value), { method: step.method || 'GET', data: step.body ? JSON.parse(step.body) : undefined, timeout: 5000 });
      if (response.status() !== step.status) throw new Error(`API ${value}: ${response.status()}, diharapkan ${step.status}.`);
      if (step.responseBody && canonical(await response.json()) !== canonical(JSON.parse(step.responseBody))) throw new Error(`Body API ${value} tidak sesuai hasil yang diharapkan.`);
      break;
    }
    default: throw new Error('Aksi browser tidak dikenal.');
  }
}

export const openBrowserQA: OpenBrowser = async (task, signal, onEvent) => {
  const runtime = task.access === 'local' ? new LocalBrowserRuntime({ ...task, previewPort: undefined }, signal, onEvent) : new ProjectRuntime(task, true);
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => { signal.removeEventListener('abort', abort); await browser?.close().catch(() => {}); await runtime.stop(); })();
  const abort = () => { void close(); };
  try {
    signal.throwIfAborted();
    await runtime.start();
    browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
    signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
    const contexts = new Set<BrowserContext>();
    const newContext = async () => {
      const context = await browser!.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
      context.setDefaultTimeout(4000);
      if (task.access !== 'local') await context.route('**/*', route => new URL(route.request().url()).origin === new URL(runtime.url).origin ? route.continue() : route.abort('blockedbyclient'));
      context.on('page', page => {
        page.on('dialog', dialog => dialog.dismiss());
        if (runtime instanceof LocalBrowserRuntime) page.on('request', request => runtime.observe(request.method(), request.url()));
      });
      contexts.add(context); return context;
    };
    return {
      async inspect() {
        const context = await newContext();
        try {
          const page = await context.newPage(); await page.goto(runtime.url, { waitUntil: 'networkidle' });
          return JSON.stringify(await page.evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 10000), controls: Array.from(document.querySelectorAll('input,textarea,select,button,a,form')).slice(0, 100).map(element => ({ tag: element.tagName.toLowerCase(), id: element.id, name: element.getAttribute('name'), type: element.getAttribute('type'), text: element.textContent?.slice(0, 150), label: element.getAttribute('aria-label') })) })));
        } finally { contexts.delete(context); await context.close(); }
      },
      async run(tests) {
        const checks = coverageChecks(task, tests), evidence: BrowserEvidence[] = [], images: string[] = [];
        const errors: string[] = [], network: string[] = [];
        const observe = (page: Page, label: string, isOffline = () => false) => {
          page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
          page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(`${label}: ${message.text()}`); });
          page.on('requestfailed', request => { if (!isOffline()) network.push(`${label}: ${request.url()} ${request.failure()?.errorText}`); });
        };
        const deadline = Date.now() + 180000;
        const folder = path.join(task.workspace, 'qa', `run-${task.retry}`); await mkdir(folder, { recursive: true });
        for (let index = 0; index < tests.length; index++) {
          signal.throwIfAborted(); if (Date.now() > deadline) throw new Error('QA browser melewati 3 menit; hasil belum terverifikasi.');
          const test = tests[index]; onEvent(`Browser: ${test.title}`);
          await runtime.resetTestData();
          runtime.caseRequests = [];
          const context = await newContext(), page = await context.newPage();
          const item: BrowserEvidence = { id: test.id, criterionId: test.criterionId, title: test.title, passed: true, detail: 'Semua langkah dijalankan.', steps: [] };
          let offline = false;
          observe(page, test.id, () => offline);
          try {
            await page.goto(runtime.url, { waitUntil: 'networkidle' });
            for (const step of test.steps) {
              signal.throwIfAborted(); if (Date.now() > deadline) throw new Error('Batas waktu pengujian tercapai.');
              if (step.action === 'offline') offline = step.value === 'true';
              onEvent(`${test.title} → ${step.action} ${step.selector || step.value || ''}`);
              try { await execute(page, context, runtime, step); item.steps.push({ action: step.action, passed: true, detail: `${step.selector || ''} ${step.value || ''}`.trim() }); }
              catch (error) { item.steps.push({ action: step.action, passed: false, detail: String((error as Error).message) }); throw error; }
            }
          } catch (error) { item.passed = false; item.detail = String((error as Error).message); }
          finally {
            const relative = `qa/run-${task.retry}/case-${index + 1}.png`;
            try { const screenshot = await page.screenshot({ path: path.join(task.workspace, relative), timeout: 4000 }); item.screenshot = relative; if (images.length < 2) images.push(screenshot.toString('base64')); } catch {}
            contexts.delete(context); await context.close();
          }
          evidence.push(item); checks.push({ name: test.title, passed: item.passed, detail: item.detail });
        }
        // Always inspect mobile/reduced motion, even if the planner forgot a layout check.
        const context = await newContext(), page = await context.newPage();
        const errorsBeforeMobile = errors.length, networkBeforeMobile = network.length;
        observe(page, 'mobile/reduced-motion');
        try {
          await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(runtime.url, { waitUntil: 'networkidle' });
          const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, content: document.body.innerText.trim().length > 0 }));
          const mobileErrors = [...errors.slice(errorsBeforeMobile), ...network.slice(networkBeforeMobile)];
          checks.push({ name: 'Mobile dan reduced motion', passed: layout.content && !layout.overflow && !mobileErrors.length, detail: mobileErrors.length ? mobileErrors.join('\n') : !layout.content ? 'Halaman tidak menampilkan konten.' : layout.overflow ? 'Konten meluber horizontal pada 390px.' : 'Halaman terbuka pada 390px dengan reduced motion.' });
          const screenshot = await page.screenshot({ path: path.join(folder, 'mobile.png') }); if (images.length >= 2) images.pop(); images.push(screenshot.toString('base64'));
        } finally { contexts.delete(context); await context.close(); }
        checks.push({ name: 'Runtime JavaScript', passed: !errors.length, detail: errors.join('\n') || 'Tidak ada exception atau console error tak terduga.' });
        checks.push({ name: 'Request browser', passed: !network.length, detail: network.join('\n') || 'Tidak ada request gagal tak terduga.' });
        if (task.access !== 'local') checks.push({ name: 'Kontrak respons API', passed: !runtime.contractFailures.length, detail: runtime.contractFailures.join('\n') || 'Tidak ada respons yang melanggar kontrak.' });
        if (task.contract && task.access !== 'local') for (const endpoint of compileContract(task.contract)) {
          checks.push({ name: `Endpoint ${endpoint.method} ${endpoint.pattern.source}`, passed: runtime.observedRequests.some(request => request.method === endpoint.method && request.endpoint === endpoint.pattern.source), detail: 'Setiap endpoint kontrak harus benar-benar menjalankan handler yang dipilih dalam pengujian integrasi.' });
        }
        return { evidence, checks, images };
      },
      close,
    };
  } catch (error) { await close(); if (error instanceof LocalProjectRuntimeError) throw new ProjectRuntimeError(error.message); throw error; }
};

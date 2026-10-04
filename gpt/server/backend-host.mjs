// Separate process: generated modules have no Node imports, credentials or shell tools.
import vm from 'node:vm';
import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
const root = process.argv[2], data = process.argv[3];
await mkdir(data, { recursive: true });
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
const modules = new Map();
async function load(file) {
  if (!file.startsWith(path.join(root, 'backend') + path.sep) || !/\.m?js$/.test(file)) throw new Error('Import harus berasal dari modul backend project.');
  if (modules.has(file)) return modules.get(file);
  const module = new vm.SourceTextModule(await readFile(file, 'utf8'), { context, identifier: file });
  modules.set(file, module);
  await module.link((specifier, parent) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error('Import eksternal tidak tersedia pada runtime lokal.');
    return load(path.resolve(path.dirname(parent.identifier), specifier));
  });
  return module;
}
try {
  const module = await load(path.join(root, 'backend', 'app.mjs'));
  await module.evaluate({ timeout: 3000 });
  if (typeof module.namespace.handle !== 'function') throw new Error('backend/app.mjs harus export handle().');
  const store = Object.freeze({
    async read() { try { return JSON.parse(await readFile(path.join(data, 'store.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } },
    async write(value) { const content = JSON.stringify(value); if (Buffer.byteLength(content) > 2000000) throw new Error('Data terlalu besar.'); await writeFile(path.join(data, 'store.tmp'), content); await rename(path.join(data, 'store.tmp'), path.join(data, 'store.json')); },
  });
  let chain = Promise.resolve();
  process.on('message', message => {
    // Serialized updates prevent read/modify/write races for the JSON store.
    chain = chain.then(async () => {
      try { const result = await module.namespace.handle({ ...message.request, store }); process.send?.({ id: message.id, result: result == null ? null : JSON.parse(JSON.stringify(result)) }); }
      catch (error) { process.send?.({ id: message.id, error: String(error.message || error) }); }
    });
  });
  process.send?.({ ready: true });
} catch (error) { process.send?.({ startupError: String(error.message || error) }); process.exitCode = 1; }

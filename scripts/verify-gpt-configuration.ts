import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { CodexRpc } from '../gpt/server/codex-rpc.js';

// Read-only provider configuration check: no model generation or quota usage.
const results = [];
for (const browser of [false, true]) {
  const rpc = new CodexRpc(browser);
  try {
    await rpc.initialize();
    const account = await rpc.call('account/read', { refreshToken: false });
    assert.equal(account.account?.type, 'chatgpt');
    const catalog = await rpc.call('model/list', { limit: 100, includeHidden: false });
    const models = catalog.data.map((model: any) => ({ id: model.model, efforts: model.supportedReasoningEfforts.map((entry: any) => entry.reasoningEffort) }));
    assert.ok(models.some((model: any) => model.id === 'gpt-6.1-sol' && ['medium', 'high'].every(effort => model.efforts.includes(effort))));
    assert.ok(models.some((model: any) => model.id === 'gpt-6-astra' && model.efforts.includes('medium')));
    const { config } = await rpc.call('config/read', {});
    const status = await rpc.call('mcpServerStatus/list', {});
    const tools = status.data.map((server: any) => ({ name: server.name, tools: Object.keys(server.tools || {}) }));
    const plugins = Object.fromEntries(Object.entries(config.plugins || {}).map(([id, value]: [string, any]) => [id, value.enabled]));
    assert.ok(Object.keys(plugins).every(id => !id.includes('"')), 'Plugin overrides must address the actual installed IDs.');
    assert.equal(plugins['chrome@openai-bundled'], browser);
    assert.equal(tools.find((server: any) => server.name === 'cua_repl')?.tools.includes('js') || false, browser);
    for (const [id, enabled] of Object.entries(plugins)) if (!['chrome@openai-bundled', 'browser@openai-bundled', 'unified-computer-use@openai-bundled'].includes(id)) assert.equal(enabled, false);
    results.push({ browser, accountType: account.account.type, models, plugins, tools });
  } finally { await rpc.close(); }
}
await writeFile('output/gpt-office/provider-configuration.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log('Plugin isolation and conditional Chrome access passed. No generation performed.');

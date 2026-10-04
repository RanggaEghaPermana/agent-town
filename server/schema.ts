import Ajv from 'ajv';
import type { BrowserCase, RoleId, StageOutput } from '../shared/types.js';

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const array = (items: unknown) => ({ type: 'array', items });
export const OUTPUT_SCHEMA = object({
  summary: string, markdown: string,
  files: array(object({ path: string, content: string })),
  verdict: { type: 'string', enum: ['pass', 'revise', 'none'] }, issues: strings,
  questions: array(object({ id: string, question: string, options: strings })),
  plan: object({ kind: { type: 'string', enum: ['answer', 'work', 'verify', 'operate'] }, lead: { type: 'string', enum: ['designer', 'frontend', 'backend'] }, browser: { type: 'boolean' }, needsBackend: { type: 'boolean' }, needsDesign: { type: 'boolean' }, complexity: { type: 'string', enum: ['clear', 'demanding', 'complex'] }, reason: string }, ['needsBackend', 'needsDesign', 'complexity', 'reason']),
  criteria: array(object({ id: string, description: string, category: { type: 'string', enum: ['happy', 'edge', 'error', 'persistence', 'responsive', 'motion'] } })),
  contract: object({ version: string, endpoints: array(object({ method: string, path: string, requestSchema: { type: 'object' }, responses: array(object({ status: { type: 'integer' }, schema: { type: 'object' } })) })) }),
  browserTests: array(object({ id: string, criterionId: string, title: string, steps: array(object({ action: { type: 'string', enum: ['click', 'fill', 'press', 'select', 'check', 'uncheck', 'hover', 'focus', 'rapidClick', 'expectDisabled', 'expectEnabled', 'expectAttribute', 'expectStyle', 'expectNoOverflow', 'expectMinSize', 'expectRequestCount', 'seedData', 'mockResponse', 'delayResponse', 'expectText', 'expectExactText', 'expectValue', 'expectCount', 'expectVisible', 'expectHidden', 'expectUrl', 'reload', 'goto', 'viewport', 'reducedMotion', 'offline', 'api'] }, selector: string, value: string, count: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, method: string, status: { type: 'integer' }, body: string, responseBody: string, attribute: string, property: string, delayMs: {type: 'integer'} }, ['action'])) })),
  findings: array(object({ role: { type: 'string', enum: ['frontend', 'backend', 'designer', 'pm', 'qa'] }, summary: string, reproduction: string, expected: string, actual: string, fixInBrowser: { type: 'boolean', description: 'True only when the FIX itself must be performed on a website such as a hosting dashboard. A defect that merely shows in the browser but is fixed in code or terminal is false.' } }, ['role', 'summary', 'reproduction', 'expected', 'actual'])),
  changedFiles: strings,
  needsBrowser: { type: 'boolean' },
  liveEvidence: array(object({ id: string, criterionId: string, title: string, passed: { type: 'boolean' }, detail: string, steps: array(object({ action: string, passed: { type: 'boolean' }, detail: string })) })),
  localVerification: object({ kind: { type: 'string', enum: ['browser', 'terminal', 'live'] }, url: string, serverCommand: string, terminalTests: array(object({ id: string, criterionId: string, title: string, command: string })) }, ['kind']),
}, ['summary', 'markdown', 'files', 'verdict', 'issues', 'questions']);
export function schemaFor(role: RoleId, phase = 'work', needsBackend = false, existingTests?: BrowserCase[], local = false) {
  const required = ['summary', 'markdown', 'files', 'verdict', 'issues', 'questions'];
  const extra = role === 'ceo' ? ['plan', ...(local ? ['criteria'] : [])] : role === 'pm' ? ['criteria', ...(needsBackend && !local ? ['contract'] : [])] : role === 'qa' ? (local && phase === 'prepare' ? ['localVerification'] : local && phase === 'live' ? ['liveEvidence', 'findings'] : ['browserTests', 'findings', ...(local ? ['localVerification'] : [])]) : local ? ['needsBrowser', 'localVerification'] : [];
  if (local) extra.push('changedFiles');
  if (role === 'ceo') required.push('plan');
  if (role === 'pm') required.push(...extra);
  if (role === 'qa') required.push(...(phase === 'test-plan' ? ['browserTests'] : phase === 'prepare' ? ['localVerification'] : phase === 'live' ? ['liveEvidence'] : ['findings']));
  const schema = object(Object.fromEntries([...new Set([...required, ...extra])].map(key => [key, OUTPUT_SCHEMA.properties[key]])), required);
  if (local && role === 'ceo') schema.properties.plan = { ...(OUTPUT_SCHEMA.properties.plan as Record<string, unknown>), required: ['kind', 'needsBackend', 'needsDesign', 'complexity', 'reason'] };
  if (role === 'qa' && existingTests?.length) {
    const tests = structuredClone(OUTPUT_SCHEMA.properties.browserTests) as { type: string; items: { properties: Record<string, unknown> }; maxItems?: number };
    tests.items.properties.id = { type: 'string', enum: existingTests.map(test => test.id) };
    tests.maxItems = existingTests.length;
    schema.properties.browserTests = tests;
  }
  return schema;
}
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(OUTPUT_SCHEMA);
export function validateOutput(value: unknown): StageOutput {
  if (!validate(value)) throw new Error(`Format hasil agent tidak sesuai: ${ajv.errorsText(validate.errors)}`);
  return value as unknown as StageOutput;
}

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const output = mkdtempSync(join(tmpdir(), 'correctool-tests-'));
writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}');
mkdirSync(join(output, 'source'));
for (const file of readdirSync('src').filter(f => f.endsWith('.ts'))) copyFileSync(join('src', file), join(output, 'source', file));
try {
  execFileSync(resolve('node_modules/.bin/tsc'), [
    '--ignoreConfig', '--noEmit', 'false', '--outDir', output,
    '--target', 'ES2022', '--module', 'node16', '--moduleResolution', 'node16',
    '--lib', 'ES2022,DOM,DOM.Iterable', '--strict', '--skipLibCheck',
    ...['sessions', 'credentials', 'transcriber', 'exercise-logic', 'review', 'request', 'progress', 'stats', 'exstats'].map(f => join(output, 'source', `${f}.ts`)),
  ], { stdio: 'pipe' });
} catch (err) {
  rmSync(output, { recursive: true, force: true });
  throw new Error(err.stdout?.toString() || err.message);
}
writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}');
const require = createRequire(join(output, 'package.json'));
const load = name => require(join(output, name + '.js'));
after(() => rmSync(output, { recursive: true, force: true }));

function storage() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}

test('saving reports failure and allows a successful retry', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw Error('full'); } };
  const { addSaved, loadSaved } = load('sessions');
  const sentence = { id: 1, text: 'Ciao', status: 'done' };
  assert.equal(addSaved([sentence]), false);
  globalThis.localStorage = storage();
  assert.equal(addSaved([sentence]), true);
  assert.equal(loadSaved().length, 1);
});

test('legacy API keys migrate to session storage until remembering is explicitly enabled', () => {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  localStorage.setItem('correctool.key', 'test-credential');
  const { loadCredential, saveCredential } = load('credentials');
  assert.deepEqual(loadCredential(), { key: 'test-credential', remember: false });
  assert.equal(localStorage.getItem('correctool.key'), null);
  assert.equal(sessionStorage.getItem('correctool.key'), 'test-credential');
  assert.equal(saveCredential('test-credential', true), true);
  assert.equal(loadCredential().remember, true);
  assert.equal(saveCredential('test-credential', false), true);
  assert.equal(localStorage.getItem('correctool.key'), null);
});

test('microphone setup failure stops tracks and releases the shared lock', async () => {
  let stopped = 0;
  let closed = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }),
  } } });
  globalThis.AudioContext = class {
    state = 'running';
    async resume() { throw Error('setup failed'); }
    async close() { closed++; }
  };
  const { PauseTranscriber } = load('transcriber');
  await assert.rejects(new PauseTranscriber(() => {}).start(), /setup failed/);
  await assert.rejects(new PauseTranscriber(() => {}).start(), /setup failed/);
  assert.equal(stopped, 2);
  assert.equal(closed, 2);
});

test('microphone lock also protects pending permission requests', async () => {
  let grant;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const { PauseTranscriber } = load('transcriber');
  const first = new PauseTranscriber(() => {});
  const pending = first.start();
  await assert.rejects(new PauseTranscriber(() => {}).start(), /Another recording/);
  grant({ getTracks: () => [{ stop() {} }] });
  await assert.rejects(pending, /setup failed/);
});

test('failed transcription clips remain in review and produce an incomplete-results notice', () => {
  const { reviewSegments, failureNotice } = load('review');
  const failed = { id: 1, text: '', status: 'failed' };
  const clips = reviewSegments([failed, { id: 2, text: '', status: 'done' }]);
  assert.deepEqual(clips, [failed]);
  assert.match(failureNotice(clips), /Results are incomplete/);
  assert.equal(failureNotice([{ text: 'Ciao', status: 'done' }]), '');
});

test('exercise-only mistakes contribute to weak-area ranking', () => {
  const { weakAreas } = load('exercise-logic');
  const areas = weakAreas({ byType: { article: 1 } }, { byType: {
    preposition: { right: 0, wrong: 10 }, conjugation: { right: 10, wrong: 0 },
  } });
  assert.equal(areas[0].type, 'preposition');
  assert.equal(areas[0].accuracy, 0);
  assert.equal(areas.some(a => a.type === 'conjugation'), false);
});

test('progress can be reset when only exercise results exist', () => {
  class Element {
    children = [];
    append(...items) { this.children.push(...items); }
    addEventListener() {}
  }
  globalThis.document = { createElement: () => new Element() };
  const { buildProgress } = load('progress');
  const root = buildProgress({ sessions: 0 }, { total: 1, correct: 1, byType: {} }, () => {});
  const find = el => el.textContent === 'Reset my progress' || el.children?.some(find);
  assert.equal(find(root), true);
});

test('API requests time out, including stalled response bodies, and support cancellation', async () => {
  const original = globalThis.fetch;
  const { apiFetch } = load('request');
  const keepAlive = setInterval(() => {}, 1000);
  const waitForAbort = signal => new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  try {
    globalThis.fetch = async (_, { signal }) => waitForAbort(signal);
    await assert.rejects(apiFetch('https://example.invalid', {}, 10), /timed out/);
    const controller = new AbortController();
    const pending = apiFetch('https://example.invalid', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    globalThis.fetch = async (_, { signal }) => ({ blob: () => waitForAbort(signal) });
    await assert.rejects(apiFetch('https://example.invalid', {}, 10), /timed out/);
  } finally {
    globalThis.fetch = original;
    clearInterval(keepAlive);
  }
});


test('API wrapper preserves successful JSON and HTTP error details', async () => {
  const original = globalThis.fetch;
  const { apiFetch } = load('request');
  try {
    globalThis.fetch = async () => new Response('{"text":"Ciao"}', { headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(await (await apiFetch('https://example.invalid', {})).json(), { text: 'Ciao' });
    globalThis.fetch = async () => new Response('rate limited', { status: 429 });
    const response = await apiFetch('https://example.invalid', {});
    assert.equal(response.status, 429);
    assert.equal(response.ok, false);
    assert.equal(await response.text(), 'rate limited');
  } finally { globalThis.fetch = original; }
});

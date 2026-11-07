'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ADAPTER = pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'herdr.ts')).href;

const ENV = {
  HERDR_ENV: '1',
  HERDR_PANE_ID: 'pane-1',
  HERDR_BIN_PATH: '/fake/herdr',
};

function arg(argv, flag) {
  return argv[argv.indexOf(flag) + 1];
}

function harness({ env = ENV } = {}) {
  const spawned = [];
  const deps = {
    now: () => 1000,
    spawn: (binary, args) => spawned.push({ binary, args }),
  };
  return import(ADAPTER).then(({ createAdapter }) => ({
    spawned,
    adapter: createAdapter({ env, deps }),
  }));
}

test('reports state through the herdr binary', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  assert.equal(spawned.length, 1);
  const [{ binary, args }] = spawned;
  assert.equal(binary, '/fake/herdr');
  assert.deepEqual(args.slice(0, 3), ['pane', 'report-agent', 'pane-1']);
  assert.equal(arg(args, '--state'), 'working');
  assert.equal(arg(args, '--source'), 'custom:codebuddy');
  assert.equal(arg(args, '--agent'), 'codebuddy');
  assert.ok(Number(arg(args, '--seq')) > 0);
});

test('does nothing outside a herdr pane', async () => {
  const { spawned, adapter } = await harness({ env: {} });
  assert.equal(adapter.enabled, false);
  await adapter.turnStart();
  await adapter.sessionEnd('prompt_input_exit');
  assert.deepEqual(spawned, []);
});

test('does nothing without the herdr binary', async () => {
  const { spawned, adapter } = await harness({
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'pane-1' },
  });
  assert.equal(adapter.enabled, false);
  await adapter.turnStart();
  assert.deepEqual(spawned, []);
});

test('skips reports that do not change the state', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.turnStart();
  assert.equal(spawned.length, 1);
  await adapter.turnComplete();
  assert.equal(spawned.length, 2);
});

test('reports an increasing sequence', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.turnComplete();
  const seq = spawned.map(({ args }) => Number(arg(args, '--seq')));
  assert.ok(seq[1] > seq[0], 'every report carries a higher seq');
});

test('reports the session and its resume command on session start', async () => {
  const { spawned, adapter } = await harness();
  await adapter.sessionStart('session-abc');
  const { args } = spawned[0];
  assert.equal(arg(args, '--state'), 'idle');
  assert.equal(arg(args, '--agent-session-id'), 'session-abc');
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['codebuddy', '--resume', 'session-abc']);
});

test('releases the pane on a real exit and stays idle on clear', async () => {
  const { spawned, adapter } = await harness();
  await adapter.sessionEnd('prompt_input_exit');
  assert.deepEqual(spawned[0].args.slice(0, 3), ['pane', 'release-agent', 'pane-1']);
  assert.ok(!spawned[0].args.includes('--state'));

  const second = await harness();
  await second.adapter.sessionEnd('clear');
  assert.deepEqual(second.spawned[0].args.slice(0, 3), ['pane', 'report-agent', 'pane-1']);
  assert.equal(arg(second.spawned[0].args, '--state'), 'idle');
});

test('ignores subagent turns', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart(undefined, 'agent-1');
  await adapter.turnComplete('agent-1');
  assert.deepEqual(spawned, [], 'a subagent turn does not move the pane');
});

test('reports a subagent permission prompt from the tool.check hook', async () => {
  // A fresh module instance: the adapter caches env and last state per import.
  const fresh = pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'register.ts')).href + '?subagent-ask';
  const { register } = await import(fresh);
  const spawned = [];
  const handlers = {};
  const $ = {
    env: { get: async name => ENV[name] },
    session: { id: async () => 'session-1' },
    process: { run: async argv => { spawned.push(argv); } },
  };
  register((name, handler) => { handlers[name] = handler; });

  const verdict = await handlers['tool.check'](
    $, { tool_use_id: 'toolu_1', agentId: 'agent-1' }, async () => ({ decision: 'ask' })
  );
  await new Promise(setImmediate);

  assert.equal(verdict.decision, 'ask', 'the verdict passes through untouched');
  assert.equal(spawned.length, 1);
  assert.equal(arg(spawned[0], '--state'), 'blocked', 'the prompt is visible to the pane');
});

test('blocks only when the permission verdict asks', async () => {
  const { spawned, adapter } = await harness();
  await adapter.check('allow');
  assert.deepEqual(spawned, []);
  await adapter.check('ask');
  assert.equal(arg(spawned[0].args, '--state'), 'blocked');
});

test('reports the current session id when a turn starts under a new one', async () => {
  const { spawned, adapter } = await harness();
  await adapter.sessionStart('session-a');
  await adapter.turnStart('session-b');
  const last = spawned.at(-1).args;
  assert.equal(arg(last, '--state'), 'working');
  assert.equal(arg(last, '--agent-session-id'), 'session-b');
  await adapter.turnStart('session-b');
  assert.equal(spawned.length, 2, 'unchanged id is not resent');
});

test('hooks stay inside the Mod sandbox', () => {
  const dir = path.join(__dirname, 'plugin', 'hooks');
  for (const name of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    // Comments mention process/node:* by name; only real code counts.
    const src = readFileSync(path.join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /^\s*import[^;]*from\s+['"]node:/m, `${name}: no node:* imports`);
    assert.doesNotMatch(src, /(?<![.\w])process\./, `${name}: use $.env, not process`);
    assert.doesNotMatch(src, /\brequire\(/, `${name}: use $ host APIs`);
    assert.doesNotMatch(src, /import\s+(?!type\b)[^;]*from\s+['"]codebuddy-code/m,
      `${name}: codebuddy-code is type-only`);
  }
});

test('register wires every lifecycle event', async () => {
  const { register } = await import(
    pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'register.ts')).href
  );
  const events = [];
  register(pattern => events.push(pattern));
  assert.deepEqual(events, [
    'session.start', 'turn.start', 'turn.complete',
    'tool.check', 'tool.call', 'session.end',
  ]);
});

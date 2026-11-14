'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ADAPTER = pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'herdr.ts')).href;
const DETECT = pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'detect.ts')).href;

const ENV = {
  HERDR_ENV: '1',
  HERDR_PANE_ID: 'pane-1',
  HERDR_BIN_PATH: '/fake/herdr',
};

/** A turn that ended without a reply to examine. */
const END = { reason: 'answer', answer: '' };

const TRUST_FIXTURE = readFileSync(
  path.join(__dirname, 'test', 'fixtures', 'trust.txt'),
  'utf8',
);
const SCREEN_PROSE = readFileSync(
  path.join(__dirname, 'test', 'fixtures', 'prose-question.txt'),
  'utf8',
);
const TURN_END_TASK = readFileSync(
  path.join(__dirname, 'test', 'fixtures', 'turn-end-task.txt'),
  'utf8',
);

const PERMISSION_EN = [
  'Bash command',
  '$ echo herdr',
  '──────────────────────────────',
  'Do you want to proceed?',
  '> 1. Yes',
  "  2. Yes, and don't ask again for session (shift + tab)",
  '  3. No (escape)',
].join('\n');

const PERMISSION_ZH = [
  '请求权限',
  '──────────────────────────────',
  '是否继续？',
  '> 1. 允许',
  '  2. 总是允许',
  '  3. 拒绝',
].join('\n');

const PERMISSION_FULL = [
  '╭─ Bash command ────────────────╮',
  '│ echo herdr                   │',
  '╰──────────────────────────────╯',
  'Do you want to proceed?',
  '> 1. Yes',
  '  3. No',
  '──────────────────────────────',
  '⎇ main | Model: DeepSeek-V4.1-Flash',
].join('\n');

const PERMISSION_BOXED = [
  '╭─ Tool use ───────────────────────╮',
  '│ mcp__server__tool                │',
  '│                                  │',
  '│ Do you want to proceed?          │',
  '│ > 1. Yes                         │',
  "│   2. Yes, and don't ask again     │",
  '│   3. No                          │',
  '╰──────────────────────────────────╯',
].join('\n');

const QUESTION_BOXED = [
  '╭─ Question ───────────────────────╮',
  '│ Which option should I take?      │',
  '│ > 1. Option A                    │',
  '│   2. Option B                    │',
  '│                                  │',
  '│ Enter to select · ↑/↓            │',
  '│ to navigate · Esc to cancel      │',
  '╰──────────────────────────────────╯',
].join('\n');

const PLAN_EN = [
  'Ready to code?',
  '──────────────────────────────',
  'Would you like to proceed?',
  '> 1. Yes',
  '  2. No, keep planning',
  '  3. Exit plan mode',
].join('\n');

const PLAN_ZH = [
  '准备好开始编码了吗？',
  '──────────────────────────────',
  '> 1. 继续',
  '  2. 继续规划',
  '  3. 退出计划模式',
].join('\n');

const QUESTION_EN = [
  'How should I proceed?',
  '> 1. Option A',
  '  2. Option B',
  '  3. Other',
  '──────────────────────────────',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
].join('\n');

const QUESTION_ZH = [
  '接下来怎么做？',
  '> 1. 方案 A',
  '  2. 方案 B',
  'Enter 选择 · ↑/↓ 导航 · Esc 取消',
].join('\n');

const IDLE = [
  '────────────────────────────────────────────────────────',
  '> 真机验证楷体海报效果                                    ↵ send',
  '────────────────────────────────────────────────────────',
  '⎇ main | Model: DeepSeek-V4.1-Flash | Thinking: default',
  'deepseek-v4.1-flash max · ← for agents · ? for shortcuts',
  '-- INSERT --',
].join('\n');

const CONFIG_MENU = [
  'Select model',
  '1. Opus',
  '2. Sonnet',
  'Enter to select · Esc to cancel',
].join('\n');

const TRUST = [
  'Do you trust the files in this folder?',
  '  /tmp/herdr-trust',
  '> 1. Yes, I trust this folder',
  '  2. No, exit',
].join('\n');

const ENTER_PLAN = [
  'Enter plan mode?',
  'CodeBuddy wants to enter plan mode to explore and design an implementation approach.',
  '> 1. Yes, enter plan mode',
  '  2. No, start implementing now',
].join('\n');

const WORKFLOW = [
  'Run a dynamic workflow?',
  '──────────────────────────────',
  '> 1. Yes, run it',
  '  2. Back',
  '  3. No',
].join('\n');

function arg(argv, flag) {
  return argv[argv.indexOf(flag) + 1];
}

function harness({ env = ENV, snapshot = '', read } = {}) {
  const spawned = [];
  const deps = {
    now: () => 1000,
    spawn: (binary, args) => spawned.push({ binary, args }),
    readSnapshot:
      read || (async () => (typeof snapshot === 'function' ? snapshot() : snapshot)),
  };
  return import(ADAPTER).then(({ createAdapter }) => ({
    spawned,
    adapter: createAdapter({ env, deps }),
  }));
}

function registerHarness({ stdout = PERMISSION_EN, tag = 'screen' } = {}) {
  // A fresh module instance: register caches the adapter per import.
  const fresh = pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'register.ts')).href + '?' + tag;
  return import(fresh).then(({ register }) => {
    const calls = [];
    const handlers = {};
    const $ = {
      env: { get: async name => ENV[name] },
      session: { id: async () => 'session-1' },
      process: {
        run: async (argv, init) => {
          calls.push({ argv, init });
          if (argv[1] === 'pane' && argv[2] === 'read') {
            return { exitCode: 0, stdout, stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      },
    };
    register((name, handler) => {
      handlers[name] = handler;
    });
    return { calls, handlers, $ };
  });
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
  await adapter.turnComplete(END);
  await adapter.sessionEnd('prompt_input_exit');
  assert.deepEqual(spawned, []);
});

test('does nothing without the herdr binary', async () => {
  const { spawned, adapter } = await harness({
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'pane-1' },
  });
  assert.equal(adapter.enabled, false);
  await adapter.turnStart();
  await adapter.turnComplete(END);
  assert.deepEqual(spawned, []);
});

test('skips reports that do not change the state', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.turnStart();
  assert.equal(spawned.length, 1);
  await adapter.turnComplete(END);
  assert.equal(spawned.length, 2);
});

test('reports an increasing sequence', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.turnComplete(END);
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
  await adapter.turnComplete({ agentId: 'agent-1', reason: 'answer', answer: '' });
  assert.deepEqual(spawned, [], 'a subagent turn does not move the pane');
});

test('blocks the pane while the model question tool is open', async () => {
  const { calls, handlers, $ } = await registerHarness({ tag: 'ask-tool' });

  await handlers['turn.start']($, {}, async e => e);
  await new Promise(setImmediate);
  calls.length = 0;

  let answer;
  const pending = handlers['tool.call'](
    $,
    { tool: 'AskUserQuestion', tool_use_id: 'toolu_q' },
    () => new Promise(resolve => {
      answer = resolve;
    }),
  );
  await new Promise(setImmediate);
  assert.equal(arg(calls[0].argv, '--state'), 'blocked', 'blocked before the question is answered');

  answer({ result: 'blue' });
  await pending;
  await new Promise(setImmediate);
  assert.equal(arg(calls.at(-1).argv, '--state'), 'working', 'working once it is answered');
});

test('reports a subagent permission prompt from the tool.check hook', async () => {
  const { calls, handlers, $ } = await registerHarness({ tag: 'subagent-ask' });

  const verdict = await handlers['tool.check'](
    $,
    { tool_use_id: 'toolu_1', agentId: 'agent-1' },
    async () => ({ decision: 'ask' }),
  );
  await new Promise(setImmediate);

  assert.equal(verdict.decision, 'ask', 'the verdict passes through untouched');
  assert.equal(calls.length, 1);
  assert.equal(arg(calls[0].argv, '--state'), 'blocked', 'the prompt is visible to the pane');
});

test('blocks only when the permission verdict asks', async () => {
  const { spawned, adapter } = await harness();
  await adapter.check('allow');
  assert.deepEqual(spawned, []);
  await adapter.check('ask');
  assert.equal(arg(spawned[0].args, '--state'), 'blocked');
  assert.equal(arg(spawned[0].args, '--message'), 'waiting for permission');
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

test('detect: recognises permission, plan and question screens', async () => {
  const { classify } = await import(DETECT);
  assert.equal(classify(PERMISSION_EN).id, 'permission');
  assert.equal(classify(PERMISSION_EN).message, 'waiting for permission');
  assert.equal(classify(PERMISSION_ZH).id, 'permission');
  assert.equal(classify(PERMISSION_FULL).id, 'permission');
  assert.equal(classify(PERMISSION_BOXED).id, 'permission');
  assert.equal(classify(PLAN_EN).id, 'plan');
  assert.equal(classify(PLAN_EN).message, 'approve the plan');
  assert.equal(classify(PLAN_ZH).id, 'plan');
  assert.equal(classify(QUESTION_EN).id, 'question');
  assert.equal(classify(QUESTION_EN).message, 'answer the question');
  assert.equal(classify(QUESTION_ZH).id, 'question');
  assert.equal(classify(QUESTION_BOXED).id, 'question');
  assert.equal(classify(QUESTION_REVIEW).id, 'question', 'the review page still waits on the person');
  assert.equal(classify(ENTER_PLAN).id, 'permission');
  assert.equal(classify(WORKFLOW).id, 'workflow');
});

const QUESTION_REVIEW = [
  '←  ☒ 颜色  ✔ Submit  →',
  'Review your answers',
  '●  选红色还是蓝色？',
  '  → 红色',
  '',
  'Ready to submit your answers?',
  '',
  '❯ 1. Submit answers',
  '  2. Cancel',
  '',
  'Enter to select · Tab/Arrow keys to navigate',
].join('\n');

test('detect: leaves idle screens and unrelated menus alone', async () => {
  const { classify } = await import(DETECT);
  assert.equal(classify(IDLE), null, 'the prompt box is not a blocker');
  assert.equal(classify(CONFIG_MENU), null, 'a config menu is not a blocker');
  assert.equal(classify(TRUST), null, 'trust is a startup gate, not in scope');
  assert.equal(classify(TRUST_FIXTURE), null, 'the real trust screen is not a blocker');
  assert.equal(classify('Do you want to proceed?'), null, 'a transcript line without options');
  assert.equal(classify(''), null);
});

test('turn end reports idle without reading the screen', async () => {
  let reads = 0;
  const { spawned, adapter } = await harness({
    read: async () => {
      reads++;
      return TURN_END_TASK;
    },
  });
  await adapter.turnComplete({ reason: 'answer', answer: '已跑完 12 个测试，全部通过。' });
  assert.equal(reads, 0, 'the reply text comes from the event, not the pane');
  assert.equal(arg(spawned.at(-1).args, '--state'), 'idle');
});

test('detect: prose on the screen is not a blocker', async () => {
  const { classify } = await import(DETECT);
  // The reported false block: a running task row above the turn-end banner.
  assert.equal(classify(TURN_END_TASK), null, 'task rows are not read as a sign-off');
  assert.equal(classify(SCREEN_PROSE), null, 'a reply on screen is not a dialog either');
});

test('detect: the reply text decides the prose question', async () => {
  const { asksInReply } = await import(DETECT);
  assert.equal(asksInReply('两个方案都行。\n\n回「accept all」或逐条改。'), true);
  assert.equal(asksInReply('用「作用」还是「描述」？\n'), true, 'a trailing question mark counts');
  assert.equal(asksInReply('已改完 61 行，列名统一为「描述」。'), false);
  assert.equal(asksInReply(''), false);
});

test('blocks at turn end when the reply asks', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.turnComplete({ reason: 'answer', answer: '要我把 P2 也加上吗？' });
  const last = spawned.at(-1).args;
  assert.equal(arg(last, '--state'), 'blocked');
  assert.equal(arg(last, '--message'), 'answer the question');
});

test('keeps a non-answer turn idle', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnComplete({ reason: 'aborted', answer: '要我继续吗？' });
  assert.equal(arg(spawned.at(-1).args, '--state'), 'idle', 'no block on an aborted turn');
});

test('reads the detection snapshot before reporting idle on session start', async () => {
  const { spawned, adapter } = await harness({ snapshot: PERMISSION_EN });
  await adapter.sessionStart('session-abc');
  const last = spawned.at(-1).args;
  assert.equal(arg(last, '--state'), 'blocked');
  assert.equal(arg(last, '--message'), 'waiting for permission');

  const second = await harness({ snapshot: IDLE });
  await second.adapter.sessionStart('session-abc');
  assert.equal(arg(second.spawned.at(-1).args, '--state'), 'idle');
});

test('reads the snapshot once when reporting idle', async () => {
  let reads = 0;
  const { adapter } = await harness({
    read: async () => {
      reads++;
      return IDLE;
    },
  });
  await adapter.sessionStart('session-abc');
  assert.equal(reads, 1);
});

test('falls back to idle when the screen read fails, and does not retry', async () => {
  let reads = 0;
  const { spawned, adapter } = await harness({
    read: async () => {
      reads++;
      throw new Error('pane read failed');
    },
  });
  await adapter.sessionStart('session-abc');
  assert.equal(arg(spawned.at(-1).args, '--state'), 'idle');
  await adapter.sessionStart('session-abc');
  assert.equal(reads, 1, 'the failed read is remembered for the process');
});

test('drops a slow screen read once a newer state event lands', async () => {
  let release;
  let reads = 0;
  const { spawned, adapter } = await harness({
    read: () => {
      reads++;
      return new Promise(resolve => {
        release = resolve;
      });
    },
  });
  const pending = adapter.sessionStart('session-abc');
  await adapter.turnStart();
  release(PERMISSION_EN);
  await pending;
  assert.equal(reads, 1);
  assert.deepEqual(spawned.map(({ args }) => arg(args, '--state')), ['working']);
});

test('blocks on the prompt announcement before the engine waits', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.prompted('needs your permission to use AskUserQuestion');
  assert.equal(arg(spawned.at(-1).args, '--state'), 'blocked');
  assert.equal(arg(spawned.at(-1).args, '--message'), 'answer the question');

  await adapter.toolDone();
  await adapter.prompted('needs your permission to use ExitPlanMode');
  assert.equal(arg(spawned.at(-1).args, '--message'), 'approve the plan');

  await adapter.toolDone();
  await adapter.prompted('needs your permission to use Bash');
  assert.equal(arg(spawned.at(-1).args, '--message'), 'waiting for permission');
});

test('ignores notifications that are not permission prompts', async () => {
  const { spawned, adapter } = await harness();
  await adapter.turnStart();
  await adapter.prompted('CodeBuddy is waiting for your input');
  assert.deepEqual(spawned.map(({ args }) => arg(args, '--state')), ['working']);
});

test('returns to idle after a question asked outside a turn', async () => {
  const { spawned, adapter } = await harness();
  adapter.asking();
  adapter.toolDone();
  assert.equal(arg(spawned[0].args, '--message'), 'answer the question');
  assert.deepEqual(spawned.map(({ args }) => arg(args, '--state')), ['blocked', 'idle']);

  const second = await harness();
  await second.adapter.turnStart();
  second.adapter.asking();
  second.adapter.toolDone();
  assert.deepEqual(second.spawned.map(({ args }) => arg(args, '--state')), [
    'working', 'blocked', 'working',
  ]);
});

test('keeps the resume command when session start hits a blocker', async () => {
  const { spawned, adapter } = await harness({ snapshot: PERMISSION_EN });
  await adapter.sessionStart('session-abc');
  const last = spawned.at(-1).args;
  assert.equal(arg(last, '--state'), 'blocked');
  assert.equal(arg(last, '--message'), 'waiting for permission');
  assert.equal(arg(last, '--agent-session-id'), 'session-abc');
  assert.deepEqual(last.slice(last.indexOf('--') + 1), ['codebuddy', '--resume', 'session-abc']);
});

test('register reads the detection source with a short timeout', async () => {
  const { calls, handlers, $ } = await registerHarness({ tag: 'screen-read' });
  await handlers['session.start']($, {}, async e => e);
  await new Promise(setImmediate);

  const read = calls.find(({ argv }) => argv[1] === 'pane' && argv[2] === 'read');
  assert.ok(read, 'the adapter asked for the pane snapshot');
  assert.deepEqual(read.argv, ['/fake/herdr', 'pane', 'read', 'pane-1', '--source', 'detection']);
  assert.equal(read.init.timeoutMs, 1500);

  const report = calls.find(({ argv }) => argv[2] === 'report-agent');
  assert.equal(arg(report.argv, '--state'), 'blocked');
  assert.equal(arg(report.argv, '--message'), 'waiting for permission');
});

test('register reports the turn-end reply text', async () => {
  const { calls, handlers, $ } = await registerHarness({ tag: 'turn-answer' });
  await handlers['turn.start']($, {}, async e => e);
  await new Promise(setImmediate);
  calls.length = 0;

  await handlers['turn.complete'](
    $,
    { reason: 'answer', answer: '要我把 P2 也加上吗？' },
    async e => e,
  );
  await new Promise(setImmediate);
  assert.equal(arg(calls.at(-1).argv, '--state'), 'blocked');
  assert.equal(arg(calls.at(-1).argv, '--message'), 'answer the question');
  assert.ok(calls.every(({ argv }) => argv[2] !== 'read'), 'no pane read at turn end');
});

test('register blocks on the notification before the question tool runs', async () => {
  const { calls, handlers, $ } = await registerHarness({ tag: 'notify' });
  await handlers['turn.start']($, {}, async e => e);
  await new Promise(setImmediate);
  calls.length = 0;

  const seen = await handlers['classic.Notification'](
    $,
    { message: 'needs your permission to use AskUserQuestion', notification_type: 'permission_prompt' },
    async e => e,
  );
  await new Promise(setImmediate);
  assert.equal(arg(calls[0].argv, '--state'), 'blocked', 'blocked before the tool.call arrives');
  assert.equal(arg(calls[0].argv, '--message'), 'answer the question');
  assert.equal(seen.message, 'needs your permission to use AskUserQuestion', 'passes through');
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
    pathToFileURL(path.join(__dirname, 'plugin', 'hooks', 'register.ts')).href + '?events'
  );
  const events = [];
  register(pattern => events.push(pattern));
  assert.deepEqual(events, [
    'session.start', 'turn.start', 'turn.complete',
    'tool.check', 'tool.call', 'classic.Notification', 'session.end',
  ]);
});

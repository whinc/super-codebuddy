/**
 * Herdr reporting for CodeBuddy, as a Mod.
 *
 * Mods run in an isolated VM: no `node:*` imports and no `process`. The
 * standalone hook's socket transport (node:net) is therefore unavailable here,
 * so every report goes through the herdr CLI via `$.process.run`.
 *
 * Contract: https://herdr.dev/tui/docs/add-herdr-support/
 */

import { classify, type Hit } from './detect.ts';

export type HerdrState = 'idle' | 'working' | 'blocked';

export type HerdrEnv = {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
  HERDR_BIN_PATH?: string;
};

export type Deps = {
  spawn(binary: string, args: string[]): void;
  readSnapshot(): Promise<string>;
  every(ms: number, fn: () => void): { cancel(): void };
  now(): number;
};

type Entry = {
  state?: HerdrState;
  release?: boolean;
  sessionId?: string;
  force?: boolean;
  message?: string;
};

const SOURCE = 'custom:codebuddy';
const AGENT = 'codebuddy';
/** Herdr rejects a resume command with an apostrophe, a control character, or a path. */
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
/**
 * A question UI can open mid-turn with no hook to announce it (PTC asks inside
 * REPL), so a running turn reads the screen on this period instead.
 */
const POLL_MS = 2000;

export function createAdapter({ env, deps }: { env: HerdrEnv; deps: Deps }) {
  const pane = env.HERDR_PANE_ID;
  const binary = env.HERDR_BIN_PATH;
  const enabled = env.HERDR_ENV === '1' && !!pane && !!binary;

  let seq = deps.now();
  let lastState: HerdrState | null = null;
  let lastSessionId: string | undefined;
  let turnActive = false;
  /** A newer state event makes an in-flight screen read stale. */
  let epoch = 0;
  /** A failed read is remembered for the process, never retried. */
  let screenBroken = false;
  /** The poll timer a running turn owns, if any. */
  let poll: { cancel(): void } | null = null;
  /** A read already in flight; a slow one must not stack behind the next tick. */
  let reading = false;
  /** True while the blocked state came from the screen, so a miss may clear it. */
  let screenBlocked = false;

  function argsFor(entry: Entry): string[] {
    const args = [
      'pane',
      entry.release ? 'release-agent' : 'report-agent',
      pane as string,
      '--source', SOURCE,
      '--agent', AGENT,
      '--seq', String(++seq),
    ];
    if (!entry.release) args.push('--state', entry.state as string);
    if (entry.message) args.push('--message', entry.message);
    if (entry.sessionId) {
      args.push('--agent-session-id', entry.sessionId, '--', 'codebuddy', '--resume', entry.sessionId);
    }
    return args;
  }

  function report(entry: Entry): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (!entry.force && !entry.sessionId && !entry.release && entry.state === lastState) {
      return Promise.resolve();
    }
    if (entry.release) lastState = null;
    else lastState = entry.state ?? lastState;
    if (entry.sessionId) lastSessionId = entry.sessionId;
    deps.spawn(binary as string, argsFor(entry));
    return Promise.resolve();
  }

  /**
   * While a turn runs, reads the bottom buffer on a timer: a question UI that
   * no hook announced holds the pane at blocked until it leaves the screen.
   * Hook-reported blocked/working are not cleared by a miss here.
   */
  async function pollScreen(): Promise<void> {
    if (!enabled || screenBroken || reading || !turnActive) return;
    reading = true;
    let hit: Hit | null = null;
    try {
      hit = classify(await deps.readSnapshot());
    } catch {
      screenBroken = true;
      stopPolling();
      return;
    } finally {
      reading = false;
    }
    if (!turnActive) return;
    if (hit) {
      screenBlocked = true;
      return report({ state: 'blocked', message: hit.message });
    }
    const wasScreen = screenBlocked;
    screenBlocked = false;
    if (wasScreen && lastState === 'blocked') return report({ state: 'working' });
  }

  function startPolling(): void {
    if (!enabled || screenBroken || poll) return;
    poll = deps.every(POLL_MS, () => {
      void pollScreen();
    });
  }

  function stopPolling(): void {
    poll?.cancel();
    poll = null;
  }

  /**
   * Reports idle after reading the live bottom buffer. A visible blocking UI
   * wins; a miss, a failed read, or an older Herdr without `detection` keeps
   * the idle report. Hook-reported blocked/working are never touched here.
   */
  async function idle(entry: Entry): Promise<void> {
    if (!enabled || screenBroken || !pane) return report(entry);
    const mine = ++epoch;
    try {
      const hit = classify(await deps.readSnapshot());
      if (mine !== epoch) return;
      return report(hit ? { ...entry, state: 'blocked', message: hit.message } : entry);
    } catch {
      screenBroken = true;
      if (mine !== epoch) return;
      return report(entry);
    }
  }

  return {
    enabled,

    /** Called with $.session.id() as the session announces itself. */
    sessionStart(sessionId?: string) {
      turnActive = false;
      screenBlocked = false;
      stopPolling();
      const valid = sessionId && SESSION_ID.test(sessionId) ? sessionId : undefined;
      return idle({ state: 'idle', sessionId: valid, force: !!valid });
    },

    turnStart(sessionId?: string, agentId?: string) {
      if (agentId) return Promise.resolve();
      turnActive = true;
      screenBlocked = false;
      epoch++;
      startPolling();
      const changed = sessionId && SESSION_ID.test(sessionId) && sessionId !== lastSessionId;
      return report({ state: 'working', sessionId: changed ? sessionId : undefined });
    },

    turnComplete(agentId?: string) {
      if (agentId) return Promise.resolve();
      turnActive = false;
      screenBlocked = false;
      stopPolling();
      return idle({ state: 'idle' });
    },

    /**
     * The verdict of tool.check: an ask waits on a person. A subagent's prompt
     * waits on the same person, so it is reported too.
     */
    check(decision: string) {
      if (decision !== 'ask') return Promise.resolve();
      epoch++;
      screenBlocked = false;
      return report({ state: 'blocked', message: 'waiting for permission' });
    },

    /**
     * The model's own question tool waits on the person whatever tool.check
     * said: it is a question, not a permission decision. $.ui.ask from another
     * Mod is the same tool.call, so this covers those questions too.
     */
    asking() {
      epoch++;
      screenBlocked = false;
      return report({ state: 'blocked', message: 'answer the question' });
    },

    /** Runs after a tool call settles, approved or not. */
    toolDone() {
      epoch++;
      screenBlocked = false;
      return report({ state: turnActive ? 'working' : 'idle' });
    },

    sessionEnd(reason: string) {
      turnActive = false;
      screenBlocked = false;
      stopPolling();
      // /clear and /resume end the conversation but keep the process and the pane.
      if (reason === 'clear' || reason === 'resume') return idle({ state: 'idle', force: true });
      epoch++;
      return report({ release: true });
    },
  };
}

export type Adapter = ReturnType<typeof createAdapter>;

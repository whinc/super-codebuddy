/**
 * Herdr reporting for CodeBuddy, as a Mod.
 *
 * Mods run in an isolated VM: no `node:*` imports and no `process`. The
 * standalone hook's socket transport (node:net) is therefore unavailable here,
 * so every report goes through the herdr CLI via `$.process.run`.
 *
 * Contract: https://herdr.dev/tui/docs/add-herdr-support/
 */

import { asksInReply, classify } from './detect.ts';

export type HerdrState = 'idle' | 'working' | 'blocked';

export type HerdrEnv = {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
  HERDR_BIN_PATH?: string;
};

export type Deps = {
  /** Runs one herdr CLI call; true when herdr accepted it. */
  send(binary: string, args: string[]): Promise<boolean>;
  readSnapshot(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
};

/** The part of turn.complete this adapter reads. */
export type TurnEnd = {
  agentId?: string;
  reason: string;
  answer: string;
};

type Entry = {
  state?: HerdrState;
  release?: boolean;
  sessionId?: string;
  force?: boolean;
  message?: string;
};

/** A report as herdr sees it: the state and the words under it. */
type Asked = { state: HerdrState; message?: string };

const SOURCE = 'custom:codebuddy';
const AGENT = 'codebuddy';
/** Herdr rejects a resume command with an apostrophe, a control character, or a path. */
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
// shortcut: the engine's English prompt copy is the only discriminator; upgrade
// to a typed prompt event when one lands.
const PERMISSION_PREFIX = 'needs your permission to use ';
/** A report that fails is retried, then the next event sends again. */
const ATTEMPTS = 3;
const RETRY_MS = 400;

export function createAdapter({ env, deps }: { env: HerdrEnv; deps: Deps }) {
  const pane = env.HERDR_PANE_ID;
  const binary = env.HERDR_BIN_PATH;
  const enabled = env.HERDR_ENV === '1' && !!pane && !!binary;

  let seq = deps.now();
  /**
   * Herdr keeps the highest seq per pane and source. Seeding from the clock and
   * topping up on every report lets a process that started earlier win the pane
   * back: a nested `codebuddy -p` in the same pane starts from a later clock,
   * and a plain counter would stay below that base for the rest of the session.
   */
  function nextSeq(): string {
    seq = Math.max(seq + 1, deps.now());
    return String(seq);
  }
  let lastSessionId: string | undefined;

  /**
   * The engine's own turn state. Only witnesses that always arrive move it:
   * a submitted prompt or turn.start starts a turn, Stop or turn.complete ends
   * one. A tool settling never ends a turn, so a missed turn event can leave
   * the pane working, never idle.
   */
  let busy = false;
  /**
   * Decisions a person still owes us, keyed by the tool call that waits
   * (`tool_use_id`) or, for a question or a notice that names no call, by the
   * tool name. The value is what the pane shows under the block.
   */
  const waiting = new Map<string, string>();
  /** The last turn ended by asking in prose; the next prompt answers it. */
  let awaitingReply = false;

  /**
   * The last report we asked herdr to accept. The message is part of it: a
   * second block phrased differently still changes what the pane says, so it
   * must be sent even though the state is the same.
   */
  let requested: Asked | null = null;
  /** A newer state event makes an in-flight screen read stale. */
  let epoch = 0;
  /** A failed read is remembered for the process, never retried. */
  let screenBroken = false;

  function state(): Entry {
    if (awaitingReply) return { state: 'blocked', message: 'answer the question' };
    // First wait in wins: a person facing several prompts is held by the
    // earliest one, and the rest are cleared as their tools settle.
    for (const message of waiting.values()) return { state: 'blocked', message };
    return { state: busy ? 'working' : 'idle' };
  }

  function same(a: Asked, b: Asked): boolean {
    return a.state === b.state && a.message === b.message;
  }

  function argsFor(entry: Entry): string[] {
    const args = [
      'pane',
      entry.release ? 'release-agent' : 'report-agent',
      pane as string,
      '--source', SOURCE,
      '--agent', AGENT,
      '--seq', nextSeq(),
    ];
    if (!entry.release) args.push('--state', entry.state as string);
    if (entry.message) args.push('--message', entry.message);
    if (entry.sessionId) {
      args.push('--agent-session-id', entry.sessionId, '--', 'codebuddy', '--resume', entry.sessionId);
    }
    return args;
  }

  /** Sends in the background; the hook never waits on herdr. */
  function report(entry: Entry): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (entry.release) {
      requested = null;
      void deliver(entry, argsFor(entry), null);
      return Promise.resolve();
    }
    const asked: Asked = { state: entry.state as HerdrState, message: entry.message };
    if (!entry.force && !entry.sessionId && requested && same(requested, asked)) {
      return Promise.resolve();
    }
    requested = asked;
    void deliver(entry, argsFor(entry), asked);
    return Promise.resolve();
  }

  async function deliver(entry: Entry, args: string[], asked: Asked | null): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let ok = false;
      try {
        ok = await deps.send(binary as string, args);
      } catch {
        ok = false;
      }
      if (ok) {
        if (entry.sessionId) lastSessionId = entry.sessionId;
        return;
      }
      // A newer report supersedes this one: herdr keeps the higher seq anyway.
      if (!asked || !requested || !same(requested, asked)) return;
      if (attempt < ATTEMPTS) await deps.sleep(RETRY_MS * attempt);
    }
    // Nothing landed: let the next event send this state again.
    if (asked && requested && same(requested, asked)) requested = null;
  }

  /** Recomputes the state from the facts and reports it. */
  function recompute(extra: Partial<Entry> = {}): Promise<void> {
    epoch++;
    return report({ ...state(), ...extra });
  }

  /**
   * Reports idle after reading the live bottom buffer. A visible blocking UI
   * wins; a miss, a failed read, or an older Herdr without `detection` keeps
   * the idle report. A one-shot override: the hit is not a persistent fact.
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

    /** Called with `$.session.id()` as the session announces itself. */
    sessionStart(sessionId?: string) {
      waiting.clear();
      awaitingReply = false;
      const valid = sessionId && SESSION_ID.test(sessionId) ? sessionId : undefined;
      // A prompt submitted before the session announced itself already proved work.
      if (busy) return report({ state: 'working', sessionId: valid, force: !!valid });
      return idle({ state: 'idle', sessionId: valid, force: !!valid });
    },

    /**
     * classic.UserPromptSubmit: a person just asked for work. This is the
     * witness that always arrives, so a missed turn.start cannot leave the
     * pane idle through the turn.
     */
    submit() {
      busy = true;
      awaitingReply = false;
      return recompute();
    },

    turnStart(sessionId?: string, agentId?: string) {
      if (agentId) return Promise.resolve();
      busy = true;
      const changed = sessionId && SESSION_ID.test(sessionId) && sessionId !== lastSessionId;
      return recompute(changed ? { sessionId } : {});
    },

    /**
     * The event carries the turn's final reply text. A reply that signs off by
     * asking is the only prose block, and it needs no pane read: task rows and
     * TUI chrome never reach this text.
     */
    turnComplete(e: TurnEnd) {
      if (e.agentId) return Promise.resolve();
      busy = false;
      if (e.reason === 'answer' && asksInReply(e.answer)) awaitingReply = true;
      return recompute();
    },

    /**
     * classic.Stop / StopFailure: the turn is over. This is the guaranteed
     * exit witness for a block whose tool never reports back, and its
     * `last_assistant_message` carries the reply turn.complete may have been
     * sampled away from.
     */
    stop(lastReply?: string) {
      busy = false;
      waiting.clear();
      // A reply that ends by asking really is a question, and the next prompt
      // clears it. A miss never clears a block turn.complete already set,
      // which would put the pane back to idle with the question still there.
      if (lastReply && asksInReply(lastReply)) awaitingReply = true;
      return recompute();
    },

    /**
     * The verdict of tool.check: an ask waits on a person. Keyed by the tool
     * call so an unrelated tool settling cannot clear it.
     */
    check(decision: string, toolUseId: string) {
      if (decision !== 'ask') return Promise.resolve();
      waiting.set(toolUseId, 'waiting for permission');
      return recompute();
    },

    /**
     * The model's own question tool waits on the person whatever tool.check
     * said: it is a question, not a permission decision. $.ui.ask from another
     * Mod is the same tool.call, so this covers those questions too.
     */
    asking(tool = 'AskUserQuestion', toolUseId?: string) {
      waiting.set(toolUseId ?? `question:${tool}`, 'answer the question');
      return recompute();
    },

    /**
     * A permission or question UI announced before the engine waits. In a PTC
     * session this is the only pre-answer signal: AskUserQuestion's tool.call
     * comes after executeNested, so it cannot report the wait.
     */
    prompted(message: string) {
      if (!message.startsWith(PERMISSION_PREFIX)) return Promise.resolve();
      const tool = message.slice(PERMISSION_PREFIX.length);
      const what =
        tool === 'AskUserQuestion'
          ? 'answer the question'
          : tool === 'ExitPlanMode'
            ? 'approve the plan'
            : 'waiting for permission';
      waiting.set(`notice:${tool}`, what);
      return recompute();
    },

    /** Runs after a tool call settles, approved or not. */
    toolDone(tool?: string, toolUseId?: string) {
      if (toolUseId) waiting.delete(toolUseId);
      if (tool) {
        waiting.delete(tool);
        waiting.delete(`notice:${tool}`);
        waiting.delete(`question:${tool}`);
      }
      // A settle that names nothing is a last resort: the turn end clears the
      // rest anyway.
      if (!tool && !toolUseId) waiting.clear();
      return recompute();
    },

    sessionEnd(reason: string) {
      busy = false;
      // /clear and /resume end the conversation but keep the process and the pane.
      if (reason === 'clear' || reason === 'resume') {
        waiting.clear();
        awaitingReply = false;
        return idle({ state: 'idle', force: true });
      }
      epoch++;
      return report({ release: true });
    },
  };
}

export type Adapter = ReturnType<typeof createAdapter>;

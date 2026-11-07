/**
 * Herdr reporting for CodeBuddy, as a Mod.
 *
 * Mods run in an isolated VM: no `node:*` imports and no `process`. The
 * standalone hook's socket transport (node:net) is therefore unavailable here,
 * so every report goes through the herdr CLI via `$.process.run`.
 *
 * Contract: https://herdr.dev/tui/docs/add-herdr-support/
 */

export type HerdrState = 'idle' | 'working' | 'blocked';

export type HerdrEnv = {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
  HERDR_BIN_PATH?: string;
};

export type Deps = {
  spawn(binary: string, args: string[]): void;
  now(): number;
};

type Entry = {
  state?: HerdrState;
  release?: boolean;
  sessionId?: string;
  force?: boolean;
};

const SOURCE = 'custom:codebuddy';
const AGENT = 'codebuddy';
/** Herdr rejects a resume command with an apostrophe, a control character, or a path. */
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;

export function createAdapter({ env, deps }: { env: HerdrEnv; deps: Deps }) {
  const pane = env.HERDR_PANE_ID;
  const binary = env.HERDR_BIN_PATH;
  const enabled = env.HERDR_ENV === '1' && !!pane && !!binary;

  let seq = deps.now();
  let lastState: HerdrState | null = null;
  let lastSessionId: string | undefined;

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

  return {
    enabled,

    /** Called with $.session.id() as the session announces itself. */
    sessionStart(sessionId?: string) {
      const valid = sessionId && SESSION_ID.test(sessionId) ? sessionId : undefined;
      return report({ state: 'idle', sessionId: valid, force: !!valid });
    },

    turnStart(sessionId?: string, agentId?: string) {
      if (agentId) return Promise.resolve();
      const changed = sessionId && SESSION_ID.test(sessionId) && sessionId !== lastSessionId;
      return report({ state: 'working', sessionId: changed ? sessionId : undefined });
    },

    turnComplete(agentId?: string) {
      if (agentId) return Promise.resolve();
      return report({ state: 'idle' });
    },

    /**
     * The verdict of tool.check: ask is the only one that waits on a person.
     * A subagent's prompt waits on the same person, so it is reported too.
     */
    check(decision: string) {
      if (decision !== 'ask') return Promise.resolve();
      return report({ state: 'blocked' });
    },

    /** Runs after a tool call settles, approved or not: the pane is working again. */
    toolDone() {
      return report({ state: 'working' });
    },

    sessionEnd(reason: string) {
      // /clear and /resume end the conversation but keep the process and the pane.
      if (reason === 'clear' || reason === 'resume') return report({ state: 'idle', force: true });
      return report({ release: true });
    },
  };
}

export type Adapter = ReturnType<typeof createAdapter>;

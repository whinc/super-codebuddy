/**
 * Wires CodeBuddy engine events to Herdr pane state.
 *
 * Every hook is observation only: the event passes through untouched, so a
 * broken report can never change what the session does.
 *
 * Mods run in an isolated VM: no `node:*` imports and no `process`. Env comes
 * from `$.env` and the herdr CLI from `$.process.run`, so the adapter is built
 * on first use.
 */

import type { EngineInterface, On } from 'codebuddy-code';
import { createAdapter, type Adapter, type HerdrEnv } from './herdr.ts';

// A herdr call is a local CLI round trip. The timeout only bounds one that
// hangs; the retries run detached, so no hook ever waits on this.
const REPORT_TIMEOUT_MS = 2500;

let engine: EngineInterface | undefined;
let loading: Promise<Adapter> | undefined;

function load($: EngineInterface): Promise<Adapter> {
  if (!loading) {
    loading = (async () => {
      const env: HerdrEnv = {
        HERDR_ENV: await $.env.get('HERDR_ENV'),
        HERDR_PANE_ID: await $.env.get('HERDR_PANE_ID'),
        HERDR_BIN_PATH: await $.env.get('HERDR_BIN_PATH'),
      };
      return createAdapter({
        env,
        deps: {
          now: () => Date.now(),
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
          async send(binary, args) {
            if (!engine) return false;
            const result = await engine.process.run([binary, ...args], { timeoutMs: REPORT_TIMEOUT_MS });
            return result.exitCode === 0;
          },
          async readSnapshot() {
            const pane = env.HERDR_PANE_ID;
            const binary = env.HERDR_BIN_PATH;
            if (!pane || !binary) throw new Error('herdr env is incomplete');
            const result = await $.process.run(
              [binary, 'pane', 'read', pane, '--source', 'detection'],
              { timeoutMs: 1500 },
            );
            if (result.exitCode !== 0) throw new Error('pane read failed');
            return result.stdout;
          },
        },
      });
    })();
  }
  return loading;
}

function quiet(report: Promise<void>) {
  report.catch(() => {});
}

/**
 * A classic tool hook names the call it is about. The id is what a wait is
 * keyed by, so passing it is what lets the right prompt be cleared.
 */
function callOf(e: unknown): { tool?: string; toolUseId?: string } {
  const ev = e as { tool_name?: unknown; tool_use_id?: unknown } | undefined;
  return {
    tool: typeof ev?.tool_name === 'string' ? ev.tool_name : undefined,
    toolUseId: typeof ev?.tool_use_id === 'string' ? ev.tool_use_id : undefined,
  };
}

/** classic.Stop carries the reply the turn ended on, sampled hook or not. */
function lastReplyOf(e: unknown): string | undefined {
  const text = (e as { last_assistant_message?: unknown } | undefined)?.last_assistant_message;
  return typeof text === 'string' ? text : undefined;
}

// Every hook is registered by its literal event name: a name computed in a
// loop reached the Mod with no delivery in the 2.183 probe, so the handlers
// that look alike stay written out.
export function register(on: On): void {
  const use = ($: EngineInterface) => {
    engine = $;
    return load($);
  };

  on('session.start', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.sessionStart(await $.session.id()));
    return next(e);
  });

  // A person asked for work: the turn is under way from here, whether or not
  // the sampled turn.start event lands.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.submit());
    return next(e);
  });

  // A /clear or /resume ends the conversation under a new id and fires no
  // session.start, so every turn is a chance for the pane to learn the id; the
  // adapter only resends it when it changed.
  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e);
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.turnStart(await $.session.id()));
    return next(e);
  });

  // Nothing listens to session.compact: auto-compaction runs inside a turn that
  // is already working, and a manual compaction outside one has no turn.complete
  // to bring the pane back to idle — Stop does.
  on('turn.complete', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.turnComplete(e));
    return next(e);
  });

  // Stop is the guaranteed turn end: it arrives even when turn.complete was
  // sampled away, so a block whose tool never reports back cannot strand the pane.
  on('classic.Stop', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.stop(lastReplyOf(e)));
    return next(e);
  });

  on('classic.StopFailure', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.stop());
    return next(e);
  });

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e);
    // A $.tool.check query carries no tool_use_id; only real calls wait on a person.
    // Subagent calls are included: their prompt waits on the same person, and the
    // pane showing "busy" through that wait is what this mod exists to prevent.
    if (e.tool_use_id) {
      const adapter = await use($);
      if (adapter.enabled) quiet(adapter.check(verdict.decision, e.tool_use_id));
    }
    return verdict;
  });

  on('tool.call', async ($, e, next) => {
    const adapter = await use($);
    // The question UI waits on the person for as long as it is open, so the
    // pane blocks before the tool runs, not after it answers. $.ui.ask from
    // another Mod is the same AskUserQuestion tool.call.
    if (adapter.enabled && e.tool === 'AskUserQuestion') {
      quiet(adapter.asking(e.tool, e.tool_use_id));
    }
    const result = await next(e);
    if (adapter.enabled) quiet(adapter.toolDone(e.tool, e.tool_use_id));
    return result;
  });

  // The engine announces a prompt before it waits, and 2.183 hands that
  // notification to Mods. In a PTC session AskUserQuestion's tool.call only
  // arrives after the answer, so this is the report that covers the wait.
  on('classic.Notification', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.prompted(e.message));
    return next(e);
  });

  // The same clear as tool.call, for the tool calls whose hook result is lost.
  on('classic.PostToolUse', async ($, e, next) => {
    const adapter = await use($);
    const { tool, toolUseId } = callOf(e);
    if (adapter.enabled) quiet(adapter.toolDone(tool, toolUseId));
    return next(e);
  });

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const adapter = await use($);
    const { tool, toolUseId } = callOf(e);
    if (adapter.enabled) quiet(adapter.toolDone(tool, toolUseId));
    return next(e);
  });

  // A denied call never runs, so no PostToolUse arrives: the decision is made,
  // and the prompt this call was holding is over. Only this call's, though —
  // another prompt may still be waiting on the same person.
  on('classic.PermissionDenied', async ($, e, next) => {
    const adapter = await use($);
    const { tool, toolUseId } = callOf(e);
    if (adapter.enabled) quiet(adapter.toolDone(tool, toolUseId));
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.sessionEnd(e.reason));
    return next(e);
  });
}

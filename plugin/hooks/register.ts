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
          spawn(binary, args) {
            if (!engine) return;
            void engine.process.run([binary, ...args]).catch(() => {});
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

  // A /clear or /resume ends the conversation under a new id and fires no
  // session.start, so every turn is a chance for the pane to learn the id; the
  // adapter only resends it when it changed.
  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e);
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.turnStart(await $.session.id(), e.agentId));
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.turnComplete(e.agentId));
    return next(e);
  });

  // Nothing listens to session.compact: auto-compaction runs inside a turn that
  // is already working, and a manual compaction outside one has no turn.complete
  // to bring the pane back to idle.

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e);
    // A $.tool.check query carries no tool_use_id; only real calls wait on a person.
    // Subagent calls are included: their prompt waits on the same person, and the
    // pane showing "busy" through that wait is what this mod exists to prevent.
    if (e.tool_use_id) {
      const adapter = await use($);
      if (adapter.enabled) quiet(adapter.check(verdict.decision));
    }
    return verdict;
  });

  on('tool.call', async ($, e, next) => {
    const adapter = await use($);
    // The question UI waits on the person for as long as it is open, so the
    // pane blocks before the tool runs, not after it answers. $.ui.ask from
    // another Mod is the same AskUserQuestion tool.call.
    if (adapter.enabled && e.tool === 'AskUserQuestion') quiet(adapter.asking());
    const result = await next(e);
    if (adapter.enabled) quiet(adapter.toolDone());
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

  on('session.end', async ($, e, next) => {
    const adapter = await use($);
    if (adapter.enabled) quiet(adapter.sessionEnd(e.reason));
    return next(e);
  });
}

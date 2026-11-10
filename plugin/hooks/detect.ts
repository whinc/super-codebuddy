/**
 * Strict blocked-screen detection for CodeBuddy.
 *
 * Mirrors the shape of Herdr's detection manifests: look at the live bottom of
 * the pane, require visible approval/question evidence, and fall back to idle
 * when nothing matches. Kept in its own module so a TUI copy change is a
 * one-file diff, and so the rules can be tested without the transport.
 */

export type Hit = { id: string; message: string };

const RECENT_LINES = 40;

/** A box edge, a rule, or a markdown separator. */
const HORIZONTAL_RULE = /^\s*[─═-]{3,}\s*$/;

/** An option row in a CodeBuddy picker: optional "> " marker, then "1. ". */
const OPTION = /^\s*[>❯]?\s*[1-9][.、]\s*\S/;

/** The first option of a permission dialog. */
const AFFIRMATIVE = /^\s*[>❯]?\s*1[.、]\s*(?:yes\b|是|允许|继续|同意|好)/i;

/** The "decline" side of a permission or plan dialog. */
const NEGATIVE =
  /^\s*[>❯]?\s*[1-9][.、]\s*(?:no\b|否|拒绝|取消|不|退出|继续规划|exit plan mode|keep planning)/i;

/** Titles that can only belong to a permission/plan confirmation. */
const PLAN_TITLES = [
  /ready to code\?/i,
  /would you like to proceed/i,
  /准备好开始编码了吗/,
  /是否退出计划/,
];

const PERMISSION_TITLES = [
  /do you want to proceed/i,
  /do you want to create/i,
  /do you want to make this edit/i,
  /do you want to multi edit/i,
  /do you want to allow/i,
  /are you sure you want to do this/i,
  /enter plan mode\?/i,
  /wants to enter plan mode/i,
  /requires confirmation/i,
  /请求权限/,
  /进入计划模式/,
  /是否继续/,
  /是否允许/,
  /要执行吗/,
  /确认执行/,
];

/** The workflow confirmation hides its title above the last rule. */
const WORKFLOW_TITLE = /run a dynamic workflow\?/i;

/** AskUserQuestion chrome, English and best-effort Chinese. */
const QUESTION_SELECT = /(?:enter\s+to\s+select|enter\s*(?:选择|選)|回车选择)/i;
const QUESTION_CANCEL = /(?:esc\s+to\s+cancel|esc\s*(?:取消|退出|关闭)|按\s*esc)/i;
const QUESTION_NAV = /(?:↑\s*\/?\s*↓|arrow\s+keys|方向键|上下键)/i;
const QUESTION_SPECIAL =
  /(?:submit answers|提交答案|skip interview and plan immediately|跳过访谈)/i;

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim() !== '');
}

/** The live bottom of the pane, ignoring trailing blank rows. */
function recent(text: string): string {
  return nonEmptyLines(text).slice(-RECENT_LINES).join('\n');
}

/** What follows the last horizontal rule, if the rule sits above the options. */
function afterLastRule(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HORIZONTAL_RULE.test(lines[i])) {
      return lines
        .slice(i + 1)
        .filter(line => line.trim() !== '')
        .join('\n');
    }
  }
  return '';
}

/** Strips the vertical borders a full ConfirmBox draws around every row. */
function clean(line: string): string {
  return line
    .replace(/^[\s│╭╮╰╯]+/, '')
    .replace(/[\s│╮╯]+$/, '');
}

/** The region as one line, so a wrapped title or footer still reads. */
function flatten(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(clean)
    .filter(line => line !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasOption(text: string): boolean {
  return text.split('\n').some(line => OPTION.test(clean(line)));
}

function hasConfirmOptions(lines: string[]): boolean {
  const cleaned = lines.map(clean);
  return cleaned.some(line => AFFIRMATIVE.test(line)) && cleaned.some(line => NEGATIVE.test(line));
}

/**
 * Returns the blocking UI the snapshot shows, or null when the screen is not
 * a known approval/question surface. Callers report idle on null.
 */
export function classify(snapshot: string): Hit | null {
  const bottom = recent(snapshot);
  if (bottom === '') return null;

  const after = afterLastRule(snapshot);
  // A rule above the option rows keeps tool output (diffs, commands) out of
  // the evidence. A full box has its bottom edge as the last rule, so fall
  // back to the whole bottom of the pane.
  const confirm = hasOption(after) ? after : bottom;
  const confirmFlat = flatten(confirm);
  const bottomFlat = flatten(bottom);
  const bottomLines = bottom.split('\n').map(clean);

  if (hasConfirmOptions(confirm.split('\n'))) {
    // The plan options are unique to ExitPlanMode; they also catch a localized
    // confirmTitle that did not land in PLAN_TITLES.
    const planish =
      PLAN_TITLES.some(pattern => pattern.test(confirmFlat)) ||
      /继续规划|退出计划|exit plan mode|keep planning/i.test(confirmFlat);
    if (planish) {
      return { id: 'plan', message: 'approve the plan' };
    }
    if (PERMISSION_TITLES.some(pattern => pattern.test(confirmFlat))) {
      return { id: 'permission', message: 'waiting for permission' };
    }
    if (WORKFLOW_TITLE.test(bottomFlat)) {
      return { id: 'workflow', message: 'approve the workflow' };
    }
  }

  const options = bottomLines.filter(line => OPTION.test(line)).length;
  const asks =
    QUESTION_SELECT.test(bottomFlat) &&
    QUESTION_CANCEL.test(bottomFlat) &&
    QUESTION_NAV.test(bottomFlat) &&
    (bottomLines.some(line => /[?？]\s*$/.test(line)) || QUESTION_SPECIAL.test(bottomFlat));

  return asks && options >= 2
    ? { id: 'question', message: 'answer the question' }
    : null;
}

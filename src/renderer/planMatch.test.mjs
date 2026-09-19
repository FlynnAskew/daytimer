// Plan vs Actual %, pinned. Run: node src/renderer/planMatch.test.mjs
//
// This function is now read by three things that must all agree: the main
// window, the widget (which writes the figure down at End Day), and Hub's
// ported copy in lib/hub/daytimer.js. Before it was extracted it had one
// caller and nothing to disagree with.
//
// The numbers below are what the ORIGINAL implementation produced, recorded
// rather than reasoned out, so this file's job is to notice a change rather
// than to argue the algorithm is right.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
global.window = {};
new Function(readFileSync(join(here, "planMatch.js"), "utf8"))();
const calc = global.window.dtPlanMatch.calculate;

let fails = 0;
const ok = (label, got, want) => {
  const pass = Object.is(got, want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// Local clock, because that is what the function reads — getHours(), not UTC.
const at = (h, m) => new Date(2026, 8, 18, h, m).toISOString();
const plan = (category, planned_start, planned_end) => ({ category, planned_start, planned_end });
const did = (category, fromH, fromM, toH, toM) =>
  ({ category, started_at: at(fromH, fromM), ended_at: at(toH, toM) });

console.log("- nothing to compare -");
ok("no plan and no actuals is null, not zero", calc([], []), null);
ok("null arguments do not throw", calc(null, null), null);
ok("a plan with nothing tracked against it is zero", calc([plan("a", "09:00", "10:00")], []), 0);

console.log("- matching -");
/*
 * 80, NOT 100, and this is the asymmetry the comment in planMatch.js warns
 * against tidying: a plan fills `i < endSlot` (four quarter-hours) while an
 * entry fills `i <= endSlot` (five), so an hour worked exactly as planned
 * scores four out of five. Every figure anybody at Howler has ever seen was
 * produced this way, and Hub's copy reproduces it deliberately. Asserted so
 * that "fixing" it has to be a decision rather than a tidy-up.
 */
ok("an hour worked exactly as planned", calc([plan("a", "09:00", "10:00")], [did("a", 9, 0, 10, 0)]), 80);
ok("the right hour, the wrong kind of work", calc([plan("a", "09:00", "10:00")], [did("b", 9, 0, 10, 0)]), 0);
ok("half the planned block", calc([plan("a", "09:00", "11:00")], [did("a", 9, 0, 10, 0)]), 63);

console.log("- malformed rows are skipped, not fatal -");
ok("a plan with no times", calc([plan("a", null, null)], [did("a", 9, 0, 10, 0)]), 0);
ok("an entry with no times", calc([plan("a", "09:00", "10:00")], [{ category: "a" }]), 0);

console.log(fails ? `\nFAIL — ${fails} failed` : `\nPASS — all checks passed`);
process.exit(fails ? 1 : 0);

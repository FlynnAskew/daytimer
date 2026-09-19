/*
 * "Plan vs Actual %" — one copy, for both renderers.
 *
 * This lived inside main.js as calculatePlanMatch(), where only the main window
 * could reach it. The widget now needs it too: when End Day asks somebody for
 * their Plan vs Actual figure, it records what the real figure was AT THAT
 * MOMENT alongside what they typed, and plans and entries stay editable
 * afterwards — so the snapshot has to be taken there and then, by the widget.
 *
 * Extracted rather than copied. There is already a second implementation, in
 * Hub (planMatchScore in lib/hub/daytimer.js), ported verbatim so the number on
 * hub.howleruk.com agrees with the number here. Two copies that must agree is
 * already one more than anybody can maintain; a third, in the window that
 * decides what gets WRITTEN DOWN, would be the one that quietly drifts.
 *
 * ── What it measures ──────────────────────────────────────────────────────
 *
 * Both sides are reduced to 15-minute slots holding a CATEGORY, and a slot
 * counts as matching only when plan and actual both have one and the categories
 * are equal. So it answers "did I spend that quarter-hour on the kind of work I
 * planned" — not "did I do the exact task", and not "how much did I track".
 *
 * ── The asymmetry is deliberate, do not tidy it ───────────────────────────
 *
 * Planned blocks fill `i < endSlot`; actual entries fill `i <= endSlot`, so an
 * entry covers one slot more than a plan of identical length. It has been this
 * way since the desktop app's first version and every figure anybody has ever
 * seen was produced by it. "Fixing" it would move everyone's score by a few
 * points overnight with nothing to explain it, and would put this file out of
 * step with Hub's copy. If it is ever changed, both copies change together and
 * somebody says so out loud.
 *
 * Loaded as a plain <script> (widget.html and main.html), like fun.js and
 * troop.js, so it has no module system to fit into.
 */
(function () {
  function calculatePlanMatch(plans, actuals) {
    plans = plans || [];
    actuals = actuals || [];

    if (plans.length === 0 && actuals.length === 0) return null;
    if (plans.length === 0) return 0;

    // Build per-15-min category map for plan
    const planMap = {};
    plans.forEach(p => {
      if (!p.planned_start || !p.planned_end) return;
      const [sh, sm] = String(p.planned_start).split(':').map(Number);
      const [eh, em] = String(p.planned_end).split(':').map(Number);
      const startSlot = sh * 4 + Math.floor(sm / 15);
      const endSlot   = eh * 4 + Math.floor(em / 15);
      for (let i = startSlot; i < endSlot; i++) {
        planMap[i] = p.category || '_nocat_';
      }
    });

    // Build per-15-min category map for actual
    const actualMap = {};
    actuals.forEach(a => {
      if (!a.started_at || !a.ended_at) return;
      const s = new Date(a.started_at);
      const e = new Date(a.ended_at);
      const startSlot = s.getHours() * 4 + Math.floor(s.getMinutes() / 15);
      const endSlot   = e.getHours() * 4 + Math.floor(e.getMinutes() / 15);
      for (let i = startSlot; i <= endSlot; i++) {
        actualMap[i] = a.category || '_nocat_';
      }
    });

    // Compare overlapping slots
    const allSlots = new Set([...Object.keys(planMap), ...Object.keys(actualMap)]);
    if (allSlots.size === 0) return null;
    let matching = 0;
    allSlots.forEach(s => {
      if (planMap[s] && actualMap[s] && planMap[s] === actualMap[s]) matching++;
    });

    return Math.round((matching / allSlots.size) * 100);
  }

  window.dtPlanMatch = { calculate: calculatePlanMatch };
})();

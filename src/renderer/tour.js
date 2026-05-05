// ═══════════════════════════════════════════════════════════
//  DayTimer — Onboarding tour runner
//
//  Self-contained: drop into a renderer, call tourRun(steps, opts)
//  with an array of step objects. Handles overlay, spotlight,
//  tooltip positioning, keyboard nav, skip, completion callback.
// ═══════════════════════════════════════════════════════════
//
//  Step shape:
//  {
//    target:   '#someElementId' OR () => HTMLElement OR null (centred modal)
//    title:    'Step heading'
//    body:     'Explanation paragraph (HTML allowed)'
//    placement: 'top' | 'bottom' | 'left' | 'right' | 'auto'  (default 'auto')
//    onShow:   optional fn(step) called before showing — can navigate page etc.
//    skipIfNoTarget: bool — skip silently if target() returns null (default true)
//  }
//
//  opts:
//  {
//    onFinish: () => void — called when tour ends (any reason)
//    storageKey: string — key in localStorage to record completion (optional)
//    finalLabel: 'Got it' (default for last button)
//  }

(function attachTourRunner(global) {
  if (global.tourRun) return; // already loaded

  const PADDING = 8;
  const TOOLTIP_W = 320;

  function injectStyles() {
    if (document.getElementById('dt-tour-styles')) return;
    const css = `
      .dt-tour-overlay {
        position: fixed; inset: 0; z-index: 9999;
        pointer-events: auto;
        animation: dt-fade 0.2s ease-out;
      }
      @keyframes dt-fade { from { opacity: 0; } to { opacity: 1; } }
      .dt-tour-spotlight {
        position: fixed; pointer-events: none;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.65);
        border-radius: 10px;
        transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease;
        z-index: 10000;
      }
      .dt-tour-tooltip {
        position: fixed;
        z-index: 10001;
        width: ${TOOLTIP_W}px; max-width: calc(100vw - 32px);
        background: var(--surface, #1a1a22);
        border: 1px solid var(--border, #2e2e3e);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 4px 14px rgba(0,0,0,0.3);
        padding: 18px 20px;
        color: var(--text, #e8e8f0);
        font-family: 'DM Sans', sans-serif;
        animation: dt-pop .2s cubic-bezier(.4,0,.2,1);
      }
      @keyframes dt-pop {
        from { transform: scale(.95); opacity: 0; }
        to   { transform: scale(1);   opacity: 1; }
      }
      .dt-tour-step-counter {
        font-size: 11px; color: var(--text-dim, #888899);
        letter-spacing: .08em; text-transform: uppercase; font-weight: 600;
        margin-bottom: 6px;
      }
      .dt-tour-title {
        font-size: 16px; font-weight: 700; line-height: 1.3; margin-bottom: 8px;
        color: var(--text, #e8e8f0);
      }
      .dt-tour-body {
        font-size: 13px; color: var(--text-dim, #aaaabb); line-height: 1.55;
        margin-bottom: 16px;
      }
      .dt-tour-body strong { color: var(--text, #e8e8f0); font-weight: 600; }
      .dt-tour-actions {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
      }
      .dt-tour-skip {
        background: none; border: none; padding: 0;
        color: var(--text-dim, #888899);
        font-size: 12px; font-family: inherit; cursor: pointer;
        text-decoration: underline; text-underline-offset: 3px;
      }
      .dt-tour-skip:hover { color: var(--text, #e8e8f0); }
      .dt-tour-nav { display: flex; gap: 8px; }
      .dt-tour-btn {
        background: var(--surface2, #2a2a35);
        border: 1px solid var(--border, #2e2e3e);
        color: var(--text, #e8e8f0);
        padding: 7px 14px; border-radius: 7px;
        font-size: 12px; font-family: inherit; font-weight: 500; cursor: pointer;
        transition: background .12s;
      }
      .dt-tour-btn:hover { background: color-mix(in srgb, var(--accent, #6ee7b7) 10%, var(--surface2, #2a2a35)); }
      .dt-tour-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .dt-tour-btn.primary {
        background: var(--accent, #6ee7b7);
        border-color: var(--accent, #6ee7b7);
        color: var(--bg, #0f0f13);
        font-weight: 600;
      }
      .dt-tour-btn.primary:hover { filter: brightness(1.1); }
      .dt-tour-arrow {
        position: absolute; width: 12px; height: 12px;
        background: var(--surface, #1a1a22);
        border: 1px solid var(--border, #2e2e3e);
        transform: rotate(45deg);
      }
    `;
    const s = document.createElement('style');
    s.id = 'dt-tour-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function resolveTarget(t) {
    if (!t) return null;
    if (typeof t === 'function') {
      try { return t(); } catch (e) { return null; }
    }
    if (typeof t === 'string') return document.querySelector(t);
    return t;
  }

  function placeTooltip(tooltipEl, arrowEl, rect, preferredPlacement) {
    const margin = 14;
    const tipH = tooltipEl.offsetHeight;
    const tipW = tooltipEl.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Auto placement: pick the side with most room
    let placement = preferredPlacement || 'auto';
    if (placement === 'auto') {
      const space = {
        bottom: vh - rect.bottom,
        top:    rect.top,
        right:  vw - rect.right,
        left:   rect.left
      };
      placement = Object.entries(space).sort((a,b) => b[1]-a[1])[0][0];
    }

    let left, top;
    let arrowStyle = '';
    switch (placement) {
      case 'bottom':
        top  = rect.bottom + margin;
        left = rect.left + (rect.width / 2) - (tipW / 2);
        arrowStyle = `top: -7px; left: ${Math.max(20, Math.min(tipW - 20, (rect.left + rect.width/2) - left))}px; border-right: none; border-bottom: none;`;
        break;
      case 'top':
        top  = rect.top - tipH - margin;
        left = rect.left + (rect.width / 2) - (tipW / 2);
        arrowStyle = `bottom: -7px; left: ${Math.max(20, Math.min(tipW - 20, (rect.left + rect.width/2) - left))}px; border-left: none; border-top: none;`;
        break;
      case 'right':
        left = rect.right + margin;
        top  = rect.top + (rect.height / 2) - (tipH / 2);
        arrowStyle = `left: -7px; top: ${Math.max(20, Math.min(tipH - 20, (rect.top + rect.height/2) - top))}px; border-right: none; border-top: none;`;
        break;
      case 'left':
        left = rect.left - tipW - margin;
        top  = rect.top + (rect.height / 2) - (tipH / 2);
        arrowStyle = `right: -7px; top: ${Math.max(20, Math.min(tipH - 20, (rect.top + rect.height/2) - top))}px; border-left: none; border-bottom: none;`;
        break;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(vw - tipW - 8, left));
    top  = Math.max(8, Math.min(vh - tipH - 8, top));

    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top  = top  + 'px';

    if (arrowStyle && arrowEl) {
      arrowEl.style.cssText = arrowStyle + 'position: absolute;';
      arrowEl.style.display = '';
    } else if (arrowEl) {
      arrowEl.style.display = 'none';
    }
  }

  function placeCentred(tooltipEl, arrowEl) {
    const tipH = tooltipEl.offsetHeight;
    const tipW = tooltipEl.offsetWidth;
    tooltipEl.style.left = ((window.innerWidth  - tipW) / 2) + 'px';
    tooltipEl.style.top  = ((window.innerHeight - tipH) / 2) + 'px';
    if (arrowEl) arrowEl.style.display = 'none';
  }

  global.tourRun = async function tourRun(steps, opts = {}) {
    injectStyles();
    let i = 0;

    const tooltipWidth = opts.tooltipWidth || TOOLTIP_W;

    // Build the DOM elements
    const overlay = document.createElement('div');
    overlay.className = 'dt-tour-overlay';
    const spotlight = document.createElement('div');
    spotlight.className = 'dt-tour-spotlight';
    spotlight.style.display = 'none';
    const tooltip = document.createElement('div');
    tooltip.className = 'dt-tour-tooltip';
    tooltip.style.width = tooltipWidth + 'px';
    const arrow = document.createElement('div');
    arrow.className = 'dt-tour-arrow';

    document.body.appendChild(overlay);
    document.body.appendChild(spotlight);
    tooltip.appendChild(arrow);
    document.body.appendChild(tooltip);

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      [overlay, spotlight, tooltip].forEach(el => el.parentNode && el.parentNode.removeChild(el));
      document.removeEventListener('keydown', onKey);
      if (opts.storageKey) {
        try { localStorage.setItem(opts.storageKey, '1'); } catch (e) {}
      }
      try { opts.onFinish && opts.onFinish(); } catch (e) {}
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); }
      else if (e.key === 'Enter' || e.key === 'ArrowRight') { next(); }
      else if (e.key === 'ArrowLeft') { back(); }
    };
    document.addEventListener('keydown', onKey);

    async function show() {
      const step = steps[i];
      if (!step) return cleanup();

      try { step.onShow && await step.onShow(step); } catch (e) {}

      // Wait briefly so any DOM changes from onShow can settle
      await new Promise(r => setTimeout(r, 80));

      const target = resolveTarget(step.target);
      const skipIfMissing = step.skipIfNoTarget !== false;
      if (!target && skipIfMissing && step.target) {
        // Skip this step
        i++;
        return show();
      }

      tooltip.innerHTML = `
        <div class="dt-tour-step-counter">Step ${i + 1} of ${steps.length}</div>
        <div class="dt-tour-title">${step.title || ''}</div>
        <div class="dt-tour-body">${step.body || ''}</div>
        <div class="dt-tour-actions">
          <button class="dt-tour-skip" data-act="skip">Skip tour</button>
          <div class="dt-tour-nav">
            <button class="dt-tour-btn" data-act="back" ${i === 0 ? 'disabled' : ''}>Back</button>
            <button class="dt-tour-btn primary" data-act="next">${i === steps.length - 1 ? (opts.finalLabel || 'Got it') : 'Next'}</button>
          </div>
        </div>
      `;
      tooltip.appendChild(arrow);

      tooltip.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', (e) => {
          const a = e.currentTarget.dataset.act;
          if (a === 'skip') cleanup();
          else if (a === 'back') back();
          else next();
        });
      });

      if (target) {
        // Position spotlight + tooltip
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        await new Promise(r => setTimeout(r, 160));
        const rect = target.getBoundingClientRect();
        spotlight.style.display = '';
        spotlight.style.top    = (rect.top    - PADDING) + 'px';
        spotlight.style.left   = (rect.left   - PADDING) + 'px';
        spotlight.style.width  = (rect.width  + PADDING * 2) + 'px';
        spotlight.style.height = (rect.height + PADDING * 2) + 'px';
        // measure tooltip after render
        await new Promise(r => requestAnimationFrame(r));
        placeTooltip(tooltip, arrow, rect, step.placement);
      } else {
        // No target — centred modal style
        spotlight.style.display = 'none';
        await new Promise(r => requestAnimationFrame(r));
        placeCentred(tooltip, arrow);
      }
    }

    function next() {
      if (i >= steps.length - 1) return cleanup();
      i++; show();
    }
    function back() {
      if (i === 0) return;
      i--; show();
    }

    // Reposition on resize
    const onResize = () => {
      const target = resolveTarget(steps[i] && steps[i].target);
      if (target) {
        const rect = target.getBoundingClientRect();
        spotlight.style.top    = (rect.top    - PADDING) + 'px';
        spotlight.style.left   = (rect.left   - PADDING) + 'px';
        spotlight.style.width  = (rect.width  + PADDING * 2) + 'px';
        spotlight.style.height = (rect.height + PADDING * 2) + 'px';
        placeTooltip(tooltip, arrow, rect, steps[i].placement);
      } else {
        placeCentred(tooltip, arrow);
      }
    };
    window.addEventListener('resize', onResize);
    const origCleanup = cleanup;

    show();
  };
})(window);

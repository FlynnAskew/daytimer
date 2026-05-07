// ═══════════════════════════════════════════════════════════
//  DayTimer — Fun effects module
//
//  Self-contained delights that get loaded into both renderers.
//  Exposes window.dtFun = { confetti, toast, sparkle, sounds, ... }
//
//  Claude Code pipeline test: 2026-05-07
// ═══════════════════════════════════════════════════════════

(function attachFun(global) {
  if (global.dtFun) return;

  // ── Inject styles once ─────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('dt-fun-styles')) return;
    const css = `
      @keyframes dt-toast-in {
        from { transform: translateX(-50%) translateY(-30px); opacity: 0; }
        to   { transform: translateX(-50%) translateY(0);     opacity: 1; }
      }
      @keyframes dt-toast-out {
        from { transform: translateX(-50%) translateY(0);    opacity: 1; }
        to   { transform: translateX(-50%) translateY(-30px); opacity: 0; }
      }
      .dt-toast {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        background: var(--surface, #1a1a22);
        color: var(--text, #e8e8f0);
        border: 1px solid var(--border, #2e2e3e);
        border-left: 3px solid var(--accent, #FF7D00);
        border-radius: 10px;
        padding: 12px 18px;
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        box-shadow: 0 14px 40px rgba(0,0,0,0.4);
        max-width: 360px;
        animation: dt-toast-in .35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .dt-toast.leaving { animation: dt-toast-out .25s ease-out forwards; }
      .dt-toast .dt-toast-emoji { display: inline-block; margin-right: 8px; font-size: 16px; vertical-align: -2px; }

      .dt-confetti-container {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 99998;
        overflow: hidden;
      }
      .dt-confetti-piece {
        position: absolute;
        will-change: transform, opacity;
      }

      @keyframes dt-sparkle-pop {
        0%   { transform: scale(0) rotate(0deg);   opacity: 0; }
        40%  { transform: scale(1.3) rotate(90deg); opacity: 1; }
        100% { transform: scale(0) rotate(180deg); opacity: 0; }
      }
      .dt-sparkle {
        position: absolute;
        pointer-events: none;
        font-size: 22px;
        animation: dt-sparkle-pop 0.9s ease-out forwards;
      }

      @keyframes dt-streak-pulse {
        0%, 100% { transform: scale(1); }
        50%      { transform: scale(1.15); }
      }
      .dt-streak-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        background: linear-gradient(135deg, #ff7d00 0%, #ff4d00 100%);
        color: #fff;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        font-family: 'DM Sans', sans-serif;
        animation: dt-streak-pulse 2s ease-in-out infinite;
      }
    `;
    const s = document.createElement('style');
    s.id = 'dt-fun-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Toast ──────────────────────────────────────────────────
  function toast(message, opts = {}) {
    injectStyles();
    const emoji = opts.emoji || '';
    const t = document.createElement('div');
    t.className = 'dt-toast';
    t.innerHTML = `${emoji ? `<span class="dt-toast-emoji">${emoji}</span>` : ''}<span>${message}</span>`;
    document.body.appendChild(t);
    const duration = opts.duration || 4000;
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 280);
    }, duration);
  }

  // ── Confetti ───────────────────────────────────────────────
  function confetti(opts = {}) {
    injectStyles();
    const colours = opts.colours || ['#FF7D00', '#000000', '#4A4949', '#FFFFFF'];
    const count = opts.count || 80;
    const duration = opts.duration || 2200;

    const container = document.createElement('div');
    container.className = 'dt-confetti-container';
    document.body.appendChild(container);

    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const startX = (opts.originX != null ? opts.originX : cw / 2);
    const startY = (opts.originY != null ? opts.originY : ch / 2);

    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'dt-confetti-piece';
      const size = 6 + Math.random() * 8;
      const isCircle = Math.random() > 0.5;
      const colour = colours[Math.floor(Math.random() * colours.length)];
      p.style.width  = size + 'px';
      p.style.height = (isCircle ? size : size * 0.4) + 'px';
      p.style.background = colour;
      p.style.borderRadius = isCircle ? '50%' : '2px';
      p.style.left = startX + 'px';
      p.style.top  = startY + 'px';

      const angle = (Math.random() * Math.PI) - Math.PI; // upward-ish
      const velocity = 6 + Math.random() * 11;
      const vx = Math.cos(angle) * velocity * (Math.random() > 0.5 ? 1 : -1);
      const vy = Math.sin(angle) * velocity - (4 + Math.random() * 6);
      const rotSpeed = (Math.random() - 0.5) * 720;

      let t = 0;
      let x = 0, y = 0, rot = 0;
      const gravity = 0.4;
      const startTime = performance.now();

      const animate = (now) => {
        t = (now - startTime) / 16; // 60fps frames
        x = vx * t;
        y = vy * t + 0.5 * gravity * t * t;
        rot = rotSpeed * (t / 60);
        const lifetime = (now - startTime) / duration;
        const opacity = lifetime > 0.7 ? (1 - (lifetime - 0.7) / 0.3) : 1;
        p.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        p.style.opacity = Math.max(0, opacity);
        if (now - startTime < duration) {
          requestAnimationFrame(animate);
        } else {
          p.remove();
        }
      };
      requestAnimationFrame(animate);
    }

    setTimeout(() => container.remove(), duration + 100);
  }

  // ── Sparkle (small celebration) ────────────────────────────
  function sparkle(targetEl, opts = {}) {
    if (!targetEl) return;
    injectStyles();
    const rect = targetEl.getBoundingClientRect();
    const count = opts.count || 5;
    const symbols = opts.symbols || ['✨', '⭐', '🎉'];

    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = 'dt-sparkle';
      s.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      s.style.left = (rect.left + Math.random() * rect.width) + 'px';
      s.style.top  = (rect.top  + Math.random() * rect.height) + 'px';
      s.style.animationDelay = (i * 80) + 'ms';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1200);
    }
  }

  global.dtFun = { toast, confetti, sparkle };
})(window);

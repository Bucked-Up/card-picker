/**
 * createCardPicker — flip-to-win card grid.
 *
 * createCardPicker({
 *   wrapper: '#picker',              // selector or Element (grid parent)
 *   logo: 'logo.png',                // image on the unflipped cards
 *   images: [{ src, label, tag }],   // prizes, revealed in order, one per click;
 *                                    // optional `tag` = corner badge text (e.g. 'FREE')
 *   // optional
 *   cards: 9,                        // total cards (min: images.length)
 *   columns: 3,
 *   confetti: true,
 *   timer: true,                     // fake "hurry up" bar under the grid, removed on first flip
 *   timerDuration: 19000,            // ms until the bar runs out (and just disappears)
 *   onFlip: (prize, index, revealed) => {},
 *   onComplete: (prizes) => {},
 * })
 *
 * Returns { reset, destroy }.
 */
(() => {
  const STYLE_ID = 'card-picker-styles';
  const CONFETTI_SRC = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';

  const CSS = `
    .cp-grid {
      display: grid;
      grid-template-columns: repeat(var(--cp-columns, 3), 1fr);
      gap: 8px;
      width: 100%;
      max-width: 400px;
      margin: 0 auto;
    }
    .cp-card {
      position: relative;
      aspect-ratio: 1 / 1;
      padding: 0;
      border: 0;
      background: none;
      perspective: 1000px;
      cursor: pointer;
      font: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .cp-card:focus-visible { outline: 3px solid #2b8cff; outline-offset: 3px; border-radius: 15px; }
    .cp-inner {
      position: relative;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
      transition: transform 0.6s;
    }
    .cp-card.cp-flipped .cp-inner { transform: rotateY(180deg); }
    .cp-card.cp-swivel .cp-inner { animation: cp-swivel 0.65s ease-in-out; }
    .cp-face {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 5px;
      border-radius: 15px;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      box-shadow: 0 3px 6px #aaa;
      overflow: hidden;
    }
    .cp-front { background: var(--cp-front-bg, #eaf6ff); border: 4px solid var(--cp-front-border, #0a3cff); }
    .cp-front img { max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; }
    .cp-back {
      flex-direction: column;
      gap: 4px;
      text-align: center;
      background: var(--cp-back-bg, #0061ff);
      border: 5px solid var(--cp-back-border, #ff0000);
      transform: rotateY(180deg);
    }
    .cp-back img { width: 100%; height: 55%; object-fit: contain; }
    .cp-label {
      font-family: 'Poppins', 'Arial Narrow', sans-serif;
      font-weight: 700;
      font-size: 0.9rem;
      line-height: 1.1;
      letter-spacing: -0.5px;
      text-transform: uppercase;
      color: var(--cp-label-color, #fff);
    }
    .cp-tag {
      position: absolute;
      top: 0;
      right: 0;
      padding: 4px 8px;
      background: var(--cp-tag-bg, #ff0000);
      color: var(--cp-tag-color, #fff);
      font-family: 'Poppins', 'Arial Narrow', sans-serif;
      font-weight: 700;
      font-size: 0.75rem;
      line-height: 1;
      text-transform: uppercase;
      border-bottom-left-radius: 10px;
      pointer-events: none;
    }
    .cp-grid.cp-complete .cp-card:not(.cp-flipped) { cursor: default; }
    .cp-grid.cp-complete .cp-card:not(.cp-flipped) .cp-front {
      filter: grayscale(1);
      background: #efefef;
      border-color: #fff;
      transition: filter 0.4s, background 0.4s;
    }
    .cp-timer { width: 100%; max-width: 400px; margin: 8px auto 6px; }
    .cp-timer-track { height: 10px; border-radius: 5px; background: #e5e7eb; overflow: hidden; }
    .cp-timer-fill { height: 100%; width: 100%; border-radius: 5px; }
    @keyframes cp-swivel {
      0% { transform: rotateY(0deg); }
      25% { transform: rotateY(-37deg); }
      75% { transform: rotateY(37deg); }
      100% { transform: rotateY(0deg); }
    }
    @media (max-width: 480px) { .cp-grid { gap: 6px; } }
    @media (max-width: 352px) {
      .cp-label { font-size: 0.6rem; }
      .cp-tag { font-size: 0.55rem; padding: 3px 6px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .cp-inner { transition: none; }
      .cp-card.cp-swivel .cp-inner { animation: none; }
    }
  `;

  const injectStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  };

  let confettiPromise = null;
  const loadConfetti = () => {
    if (window.confetti) return Promise.resolve(window.confetti);
    if (!confettiPromise) {
      confettiPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CONFETTI_SRC;
        script.async = true;
        script.onload = () => resolve(window.confetti);
        script.onerror = () => {
          confettiPromise = null;
          reject(new Error('card-picker: failed to load confetti'));
        };
        document.head.appendChild(script);
      });
    }
    return confettiPromise;
  };

  // Fake countdown: drains fast to 60%, then crawls through a long tail while it
  // shifts green -> yellow -> red and shakes harder. Timeline mirrors the original
  // (9s curve with its last 2s stretched to 12s = 19s), scaled to `duration`.
  const GREEN = [34, 197, 94];
  const YELLOW = [234, 179, 8];
  const RED = [220, 38, 38];

  const mix = (c1, c2, t) => c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  const lighten = (rgb, amt) => rgb.map((v) => Math.round(v + (255 - v) * amt));
  const rgbStr = ([r, g, b]) => `rgb(${r},${g},${b})`;
  const colorForRemaining = (r) => (r > 0.5 ? mix(YELLOW, GREEN, (r - 0.5) / 0.5) : mix(RED, YELLOW, r / 0.5));
  const depletedFor = (t) => {
    if (t <= 0.6) return 0.6 * (t / 0.6) ** 1.8;
    const x = (t - 0.6) / 0.4;
    return 0.6 + 0.4 * (1 - (1 - x) ** 2);
  };

  const runTimerBar = (track, fill, duration, onEnd) => {
    const scale = duration / 19000;
    const CURVE = 9000 * scale;
    const TAIL_CURVE = 2000 * scale;
    const TAIL_REAL = 12000 * scale;
    const SPLIT = CURVE - TAIL_CURVE;
    const TOTAL = SPLIT + TAIL_REAL;

    const curveElapsed = (elapsed) => (elapsed <= SPLIT
      ? elapsed
      : SPLIT + Math.min((elapsed - SPLIT) / TAIL_REAL, 1) * TAIL_CURVE);

    let start = null;
    let rafId = null;

    const frame = (ts) => {
      if (start === null) start = ts;
      const elapsed = ts - start;
      const depleted = depletedFor(curveElapsed(Math.min(elapsed, TOTAL)) / CURVE);
      const remaining = 1 - depleted;
      const base = colorForRemaining(remaining);

      fill.style.width = `${remaining * 100}%`;
      fill.style.background = `linear-gradient(180deg, ${rgbStr(lighten(base, 0.28))} 0%, ${rgbStr(base)} 100%)`;

      const shakeAmp = depleted ** 4 * 2.8;
      const shakeFreq = 8 + depleted * 22;
      track.style.transform = `translateX(${shakeAmp * Math.sin((elapsed / 1000) * shakeFreq)}px)`;

      if (elapsed < TOTAL) rafId = requestAnimationFrame(frame);
      else onEnd();
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  };

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function createCardPicker({
    wrapper,
    logo,
    images = [],
    cards = 9,
    columns = 3,
    confetti = true,
    timer = true,
    timerDuration = 19000,
    onFlip = () => {},
    onComplete = () => {},
  } = {}) {
    const root = typeof wrapper === 'string' ? document.querySelector(wrapper) : wrapper;
    if (!root) throw new Error(`card-picker: wrapper "${wrapper}" not found`);
    if (!images.length) throw new Error('card-picker: "images" must contain at least one prize');

    injectStyles();
    if (confetti) loadConfetti().catch(() => {});
    images.forEach(({ src }) => { new Image().src = src; });

    const total = Math.max(cards, images.length);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let grid;
    let revealed = 0;
    let swivelTimer = null;
    let timerEl = null;
    let stopTimer = null;

    const isDone = () => revealed >= images.length;

    const stopSwivel = () => {
      clearTimeout(swivelTimer);
      swivelTimer = null;
    };

    const startSwivel = () => {
      if (reducedMotion) return;
      const tick = () => {
        if (revealed > 0) return;
        const idle = [...grid.children].filter((c) => !c.classList.contains('cp-swivel'));
        if (idle.length) {
          const card = pickRandom(idle);
          card.classList.add('cp-swivel');
          setTimeout(() => card.classList.remove('cp-swivel'), 800);
        }
        swivelTimer = setTimeout(tick, 1800);
      };
      swivelTimer = setTimeout(tick, 2000);
    };

    const removeTimer = () => {
      if (stopTimer) stopTimer();
      stopTimer = null;
      if (timerEl) timerEl.remove();
      timerEl = null;
    };

    // Removed outright (no fade) so whatever sits below never slides around.
    const mountTimer = () => {
      if (!timer) return;
      timerEl = document.createElement('div');
      timerEl.className = 'cp-timer';
      timerEl.setAttribute('aria-hidden', 'true');
      timerEl.innerHTML = '<div class="cp-timer-track"><div class="cp-timer-fill"></div></div>';
      grid.after(timerEl);
      stopTimer = runTimerBar(
        timerEl.firstElementChild,
        timerEl.querySelector('.cp-timer-fill'),
        timerDuration,
        removeTimer,
      );
    };

    const createCard = () => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cp-card';
      card.setAttribute('aria-label', 'Hidden card, flip to reveal');
      card.innerHTML = `
        <div class="cp-inner">
          <div class="cp-face cp-front"><img alt="" draggable="false"></div>
          <div class="cp-face cp-back"></div>
        </div>`;
      card.querySelector('.cp-front img').src = logo;
      return card;
    };

    const fillBack = (card, prize) => {
      const back = card.querySelector('.cp-back');
      back.innerHTML = '';
      const img = document.createElement('img');
      img.src = prize.src;
      img.alt = prize.label || '';
      back.appendChild(img);
      if (prize.label) {
        const label = document.createElement('div');
        label.className = 'cp-label';
        label.textContent = prize.label;
        back.appendChild(label);
      }
      if (prize.tag) {
        const tag = document.createElement('div');
        tag.className = 'cp-tag';
        tag.textContent = prize.tag;
        back.appendChild(tag);
      }
      const name = [prize.label, prize.tag && `(${prize.tag})`].filter(Boolean).join(' ');
      card.setAttribute('aria-label', name ? `Revealed: ${name}` : 'Revealed card');
    };

    const celebrate = () => {
      if (!confetti) return;
      const rect = grid.getBoundingClientRect();
      const origin = {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      };
      loadConfetti()
        .then((fire) => {
          fire({ particleCount: 150, spread: 100, startVelocity: 45, origin });
          setTimeout(() => fire({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0, y: 0.7 } }), 250);
          setTimeout(() => fire({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1, y: 0.7 } }), 400);
        })
        .catch(() => {});
    };

    const finish = () => {
      grid.classList.add('cp-complete');
      [...grid.children]
        .filter((c) => !c.classList.contains('cp-flipped'))
        .forEach((c) => c.setAttribute('aria-disabled', 'true'));
      celebrate();
      onComplete(images.slice());
    };

    const handleClick = (e) => {
      const card = e.target.closest('.cp-card');
      if (!card || isDone() || card.classList.contains('cp-flipped')) return;
      stopSwivel();
      removeTimer();
      card.classList.remove('cp-swivel');

      const index = revealed;
      const prize = images[index];
      fillBack(card, prize);
      card.classList.add('cp-flipped');
      revealed += 1;
      onFlip(prize, index, revealed);

      // let the flip transition finish before celebrating
      if (isDone()) setTimeout(finish, reducedMotion ? 0 : 600);
    };

    const render = () => {
      grid = document.createElement('div');
      grid.className = 'cp-grid';
      grid.style.setProperty('--cp-columns', columns);
      for (let i = 0; i < total; i += 1) grid.appendChild(createCard());
      grid.addEventListener('click', handleClick);
      root.appendChild(grid);
      mountTimer();
    };

    const destroy = () => {
      stopSwivel();
      removeTimer();
      if (grid) {
        grid.removeEventListener('click', handleClick);
        grid.remove();
        grid = null;
      }
    };

    const reset = () => {
      destroy();
      revealed = 0;
      render();
      startSwivel();
    };

    render();
    startSwivel();

    return { reset, destroy };
  }

  window.createCardPicker = createCardPicker;
})();

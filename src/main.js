/* ============================================================================
 * main.js — orchestration : physique + rendu + accessibilité + réglages
 * ----------------------------------------------------------------------------
 * La physique tourne en pixels CSS, le rendu en pixels device : une seule
 * conversion (× dpr) au moment du dessin.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const canvas = document.getElementById('vortex');
  const field = global.VortexField.createField();
  const R = global.VortexRenderer.createRenderer(canvas, field);

  /* ------------------------------------------------------------ réglages
     Les quatre valeurs physiques vivent dans le renderer (S) et sont lues au
     démarrage : une seule source de vérité, le panneau les écrit en place. */
  const KNOBS = {
    rate: R.S.userRate,
    tanAlpha: R.S.tanAlpha,
    coreRatio: R.S.coreRatio,
    fade: 0.10,       // opacité du fondu par frame (longueur des traînées)
    parallax: 6       // amplitude de la parallaxe souris (px CSS)
  };

  const mq = global.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mq.matches;

  /* ------------------------------------------------------------- état anim */
  const state = {
    w: 0, h: 0,
    mouseX: 0.5, mouseY: 0.5,      // cible lissée de la parallaxe
    parX: 0, parY: 0,
    time: 0,
    last: 0,
    avgDt: 16.7,
    fps: 60,
    running: true
  };

  /* ====================================================== simulation */

  /* Un sous-pas adaptatif : on ne dépasse jamais 1/60 s de physique par
     sous-pas, sinon l'intégration analytique « saute » la zone du cœur. */
  function stepParticles(dt) {
    const cfg = field.cfg;
    const rOut = cfg.R * 1.12;
    const rIn = cfg.rCore * 1.9;
    const P = R.P;
    const probe = R.probe;

    let guard = 0;
    let remaining = dt;
    while (remaining > 1e-6 && guard < 64) {
      const h = Math.min(remaining, 1 / 60);
      remaining -= h;

      /* serpentement cohérent d'ensemble (bruit sinusoïdal lent) */
      const wob = 1 + 0.35 * Math.sin(state.time * 0.31);

      for (let i = 0; i < P.n; i++) {
        probe.r = P.r[i];
        probe.theta = P.th[i];
        probe.phase = P.ph[i];
        probe.seed = P.sd[i];
        probe.ter = P.ter[i] * wob;
        probe.kind = P.kind[i];
        probe.age = P.life[i];

        const died = field.step(probe, h, rIn, rOut);

        P.r[i] = probe.r;
        P.th[i] = probe.theta;
        P.kind[i] = probe.kind;
        if (died) {
          P.life[i] = 0;
        } else {
          const l = P.life[i] + h * 0.55;
          P.life[i] = l > 1 ? 1 : l;   // fondu d'apparition
        }

        /* θ peut diverger en théorie : on le replie pour garder la
           précision flottante sur les longues sessions. */
        if (P.th[i] > 1e6 || P.th[i] < -1e6) P.th[i] = P.th[i] % TAU;
      }
      guard++;
    }
  }

  /* ====================================================== boucle */
  function loop(now) {
    if (!state.running) return;
    const raw = state.last ? (now - state.last) / 1000 : 1 / 60;
    state.last = now;

    /* dt borné : jamais de saut après un onglet en arrière-plan */
    const dtReal = clamp(raw, 0, 0.05);
    state.avgDt += (raw * 1000 - state.avgDt) * 0.05;
    state.fps = Math.round(1000 / Math.max(1, state.avgDt));

    /* temps physique ralenti si reduced-motion */
    const speed = reduced ? 0.35 : 1;
    const dt = dtReal * speed;
    state.time += dt;

    /* rotation rigide cumulée : appliquée au rendu seulement, elle ne
       modifie jamais l'état physique des particules. */
    R.S.driftAngle = field.cfg.drift * state.time;
    R.S.time = state.time;

    /* --- parallaxe souris très douce : le centre se décale de quelques px */
    if (!reduced) {
      const targetX = (state.mouseX - 0.5) * KNOBS.parallax * 2;
      const targetY = (state.mouseY - 0.5) * KNOBS.parallax * 2;
      state.parX += (targetX - state.parX) * 0.045;
      state.parY += (targetY - state.parY) * 0.045;
    } else {
      state.parX += (0 - state.parX) * 0.1;
      state.parY += (0 - state.parY) * 0.1;
    }

    stepParticles(dt);

    /* --- rendu : une seule composition, ordre garanti par le renderer --- */
    R.frame(reduced ? 0.14 : KNOBS.fade, state.parX, state.parY);

    updateHud();
    requestAnimationFrame(loop);
  }

  /* ====================================================== HUD discret */
  const hud = document.getElementById('hud');
  let hudTick = 0;
  function updateHud() {
    if (!hud || hudTick++ % 20) return;
    hud.textContent = R.P.n + ' particules · ' + state.fps + ' fps · ' +
      (reduced ? 'mouvement réduit' : 'mouvement complet');
  }

  /* ====================================================== resize */
  let resizeRaf = 0;
  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyKnobs();
      R.resize();
      state.w = R.S.w; state.h = R.S.h;
      syncPanel();
    });
  }

  function applyKnobs() {
    R.S.userRate = KNOBS.rate;
    R.S.tanAlpha = KNOBS.tanAlpha;
    R.S.coreRatio = KNOBS.coreRatio;
    R.S.reduce = reduced;
  }

  /* ====================================================== souris / tactile */
  function onPointer(e) {
    const p = e.touches && e.touches[0] ? e.touches[0] : e;
    if (p.clientX == null) return;
    state.mouseX = p.clientX / Math.max(1, state.w);
    state.mouseY = p.clientY / Math.max(1, state.h);
  }

  /* ====================================================== panneau Physique */
  const panel = document.getElementById('panel');
  const panelToggle = document.getElementById('panelToggle');

  function syncPanel() {
    if (!panel) return;
    const set = (id, val, txt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val;
      const out = document.getElementById(id + 'Out');
      if (out) out.textContent = txt;
    };
    set('kRate', KNOBS.rate, KNOBS.rate.toFixed(1) + ' tr/min');
    set('kAlpha', KNOBS.tanAlpha, Math.round(Math.atan(KNOBS.tanAlpha) * 180 / Math.PI) + '°');
    set('kCore', KNOBS.coreRatio, (KNOBS.coreRatio * 100).toFixed(0) + ' % de R');
    set('kTrail', KNOBS.fade, KNOBS.fade < 0.06 ? 'longues' : KNOBS.fade > 0.12 ? 'courtes' : 'moyennes');
  }

  function bindPanel() {
    if (!panel) return;
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        fn(parseFloat(el.value));
        applyKnobs();
        /* seul le cœur et l'échelle changent la géométrie : il faut
           reconstruire les couches pré-rendues. */
        if (id === 'kCore') { R.resize(); }
        syncPanel();
      });
    };
    bind('kRate', v => { KNOBS.rate = v; });
    bind('kAlpha', v => { KNOBS.tanAlpha = v; });
    bind('kCore', v => { KNOBS.coreRatio = v; });
    bind('kTrail', v => { KNOBS.fade = v; });

    if (panelToggle) {
      panelToggle.addEventListener('click', () => togglePanel());
    }
    global.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') togglePanel();
    });
  }

  function togglePanel(force) {
    if (!panel) return;
    const open = force != null ? force : !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    if (panelToggle) panelToggle.setAttribute('aria-expanded', String(open));
  }

  /* ====================================================== démarrage */
  function start() {
    applyKnobs();
    R.resize();
    state.w = R.S.w; state.h = R.S.h;
    bindPanel();
    syncPanel();

    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
    global.addEventListener('pointermove', onPointer, { passive: true });
    global.addEventListener('touchmove', onPointer, { passive: true });

    /* pause hors écran : on ne simule pas dans le vide */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        state.running = false;
      } else if (!state.running) {
        state.running = true;
        state.last = 0;
        requestAnimationFrame(loop);
      }
    });

    /* accessibilité : réagit au changement de préférence à chaud */
    const onMq = () => {
      reduced = mq.matches;
      applyKnobs();
      R.S.count = R.chooseCount(reduced);
      R.spawnAll();
      syncPanel();
    };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* exposé pour le débogage / les vérifications */
  global.__vortex = { field, R, state, KNOBS, stepParticles };
})(window);

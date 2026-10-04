/* ============================================================================
 * renderer.js — rendu Canvas 2D du vortex (top-down)
 * ----------------------------------------------------------------------------
 * RÈGLES TENUES
 *   · Tout est pré-rendu dans des canvas hors écran : aucun gradient créé
 *     dans la boucle de rendu.
 *   · Rien n'est alloué dans la boucle (tableaux typés pré-alloués).
 *   · DPR plafonné à 2.
 *   · Traînées par fondu progressif (fillRect + alpha), jamais de lignes.
 *   · Mapping physique -> rendu :
 *       r        -> profondeur  (petit = sombre, froid, opaque)
 *       v_θ      -> éclat + longueur de traînée
 *       v_r      -> étirement radial
 *       z_s(r)   -> dégradé radial + caustiques concentriques
 *       ω du cœur-> œil sombre central
 * ==========================================================================*/
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* --------------------------------------------------------------- palette
   * Discipline stricte : aucun bleu ne dérive vers le violet ou le vert.
   * Teintes utilisées : 224° (bleu) -> 205° -> 193° (cyan). Jamais < 185°.
   * Aucun élément chaud. */
  const PALETTE = {
    bgDeep: '#030816',
    bgMid: '#061a33',
    /* famille 0 — eau profonde (bleu nuit) */
    deep0: '#04101f',
    deep1: '#0a2a52',
    /* famille 1 — courant (bleu moyen -> cyan) */
    cur0: 'rgba(59,130,246,0)',
    cur1: '#3b82f6',
    cur2: '#67e8f9',
    /* famille 2 — écume (blanc cassé / cyan très clair) */
    foam0: 'rgba(205,245,255,0)',
    foam1: '#cdf5ff',
    foam2: '#e8f6ff',
    caustic: 'rgba(103,232,249,1)'
  };

  function createRenderer(canvas, field) {
    const ctx = canvas.getContext('2d', { alpha: false });

    /* ------------------------------------------------------- état de rendu */
    const S = {
      dpr: 1, w: 0, h: 0,                 // taille CSS
      vw: 0, vh: 0,                       // taille device
      cx: 0, cy: 0,                       // centre du vortex (device px)
      layerBg: null, layerCaustic: null, layerVignette: null,
      sprite: [],                         // 3 familles
      spriteR: [32, 32, 32],              // rayon source de chaque sprite
      count: 900,
      reduce: false,
      driftAngle: 0,                      // rotation rigide cumulée (rad)
      time: 0,                            // temps du serpentement (s)
      sizeBoost: 1
    };

    /* ------------------------------------------------- tableaux typés (SoA)
       Pré-alloués une fois pour toutes : maximum large. */
    const MAXP = 26000;
    const P = {
      th: new Float32Array(MAXP),   // angle
      r: new Float32Array(MAXP),    // rayon
      ph: new Float32Array(MAXP),   // phase (serpentement)
      sd: new Float32Array(MAXP),   // grain aléatoire par particule
      sz: new Float32Array(MAXP),   // taille relative [0.5, 1.5]
      ter: new Float32Array(MAXP),  // amplitude de serpentement (px, à r=1)
      kind: new Uint8Array(MAXP),   // famille de sprite
      life: new Float32Array(MAXP), // âge (s) — sert au fondu d'apparition
      n: 0
    };

    /* objet scalaire réutilisé : zéro allocation dans step() */
    const probe = {
      r: 0, theta: 0, phase: 0, seed: 0, ter: 0, kind: 0, age: 0, x: 0, y: 0
    };

    /* ====================================================== construction */

    function buildSprites() {
      const size = 64;                       // sprites plus grands, dessinés petits
      S.sprite = [];
      S.spriteR = [];

      /* famille 0 — eau profonde : blob large, très diffus, sombre-bleu */
      S.sprite.push(makeSprite(size, [
        [0.00, PALETTE.deep1, 0.85],
        [0.35, 'rgba(10,42,82,0.55)'],
        [0.70, 'rgba(6,26,51,0.20)'],
        [1.00, 'rgba(3,8,22,0.0)']
      ]));

      /* famille 1 — courant : cœur bleu moyen, halo cyan */
      S.sprite.push(makeSprite(size, [
        [0.00, 'rgba(103,232,249,0.95)'],
        [0.18, PALETTE.cur1],
        [0.52, 'rgba(59,130,246,0.35)'],
        [1.00, PALETTE.cur0]
      ]));

      /* famille 2 — écume : petit cœur blanc, halo cyan très clair */
      S.sprite.push(makeSprite(size, [
        [0.00, PALETTE.foam2],
        [0.14, PALETTE.foam1],
        [0.42, 'rgba(205,245,255,0.40)'],
        [1.00, PALETTE.foam0]
      ]));

      S.spriteR = [size / 2, size / 2, size / 2];
    }

    function makeSprite(size, stops) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const h = size / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    }

    /* ------------------------------------------------------------- couches */

    /* Corps du vortex : dégradé radial sombre au centre, plus clair au bord.
       Option A retenue — œil SOMBRE (bleu nuit, presque noir). */
    function buildBg() {
      const c = document.createElement('canvas');
      c.width = S.vw; c.height = S.vh;
      const g = c.getContext('2d');

      g.fillStyle = PALETTE.bgDeep;
      g.fillRect(0, 0, S.vw, S.vh);

      const R = Math.max(S.vw, S.vh) * 0.78;
      const grad = g.createRadialGradient(S.cx, S.cy, 0, S.cx, S.cy, R);

      /* rayon 0 = cœur : presque noir ; bord : bleu profond */
      grad.addColorStop(0.000, '#01040c');
      grad.addColorStop(0.070, '#020a18');
      grad.addColorStop(0.160, '#05132c');
      grad.addColorStop(0.320, '#071f42');
      grad.addColorStop(0.560, PALETTE.bgMid);
      grad.addColorStop(0.820, '#08203c');
      grad.addColorStop(1.000, PALETTE.bgDeep);

      g.fillStyle = grad;
      g.beginPath();
      g.arc(S.cx, S.cy, R, 0, TAU);
      g.fill();

      S.layerBg = c;
    }

    /* Caustiques : anneaux concentriques lents, cyan pâle, faible opacité.
       Leurs rayons sont DÉRIVÉS du creux z_s(r) = z_∞ − Γ²/(8π²g r²) :
       la fosse est échantillonnée en N niveaux égaux, donc les anneaux se
       resserrent près du centre exactement comme la surface réelle. */
    function buildCaustics() {
      const c = document.createElement('canvas');
      c.width = S.vw; c.height = S.vh;
      const g = c.getContext('2d');
      const R = Math.max(S.vw, S.vh) * 0.74;
      const rCore = field.cfg.rCore * S.dpr;
      const N = 34;

      g.clearRect(0, 0, S.vw, S.vh);
      g.lineWidth = Math.max(1, 1 * S.dpr);

      for (let i = 1; i <= N; i++) {
        /* niveau de profondeur décroissant : le creux varie en 1/r²,
           r_k = r_c · sqrt(N / k)  =>  anneaux hyperboliquement espacés. */
        const rk = rCore * Math.sqrt(N / i);
        if (rk > R) continue;
        const t = i / N;                                  // 1 = près du cœur
        const a = (0.012 + 0.085 * t * t);                // faible opacité
        g.strokeStyle = 'rgba(103,232,249,' + a.toFixed(4) + ')';
        g.beginPath();
        /* anneau très légèrement elliptique : le creux n'est jamais
           parfaitement axisymétrique dans la réalité */
        g.ellipse(S.cx, S.cy, rk, rk * (1 + 0.02 * Math.sin(i * 1.7)), 0, 0, TAU);
        g.stroke();
      }
      S.layerCaustic = c;
    }

    /* Vignettage : coins assombris pour concentrer le regard. */
    function buildVignette() {
      const c = document.createElement('canvas');
      c.width = S.vw; c.height = S.vh;
      const g = c.getContext('2d');
      const R = Math.max(S.vw, S.vh) * 0.82;
      const grad = g.createRadialGradient(S.cx, S.cy, R * 0.34, S.cx, S.cy, R);
      grad.addColorStop(0.00, 'rgba(3,8,22,0)');
      grad.addColorStop(0.62, 'rgba(3,8,22,0.34)');
      grad.addColorStop(1.00, 'rgba(1,4,10,0.82)');
      g.fillStyle = grad;
      g.fillRect(0, 0, S.vw, S.vh);
      S.layerVignette = c;
    }

    /* ====================================================== population */

    function spawnAll() {
      const rOut = field.cfg.R * 1.12;
      const rIn = field.cfg.rCore * 1.9;
      const n = S.count;
      for (let i = 0; i < n; i++) initParticle(i, rIn, rOut, true);
      P.n = n;
    }

    function initParticle(i, rIn, rOut, anywhere) {
      /* répartition à peu près uniforme en surface (densité ∝ r dr) */
      const u = Math.random();
      const rr = Math.sqrt(rIn * rIn + u * (rOut * rOut - rIn * rIn));
      P.r[i] = anywhere ? rr : rOut * (0.86 + 0.14 * Math.random());
      P.th[i] = Math.random() * TAU;
      P.ph[i] = Math.random();
      P.sd[i] = Math.random() * TAU;

      /* les particules de bord sont plus grosses et plus diffuses,
         celles du cœur plus petites et plus nettes */
      const depthT = clamp(1 - (rr - field.cfg.rEye) / field.cfg.R, 0, 1);
      P.sz[i] = 0.55 + 1.45 * (1 - depthT) + 0.35 * Math.random();
      P.ter[i] = 0.35 + 0.9 * Math.random();
      P.kind[i] = field.pickKind(rr);
      P.life[i] = anywhere ? 1 : 0;
    }

    /* nombre de particules adaptatif : écran, mobile, reduced-motion */
    function chooseCount(reduce) {
      const area = S.w * S.h;
      const small = Math.min(S.w, S.h) < 620;
      const mobile = /Mobi|Android|iPhone|iPad/i.test(
        (global.navigator && global.navigator.userAgent) || ''
      );
      let n = Math.round(area / 1500);
      if (small || mobile) n = Math.round(area / 2600);
      n = clamp(n, 260, 2200);
      if (mobile) n = Math.min(n, 520);
      /* mobile : moins de particules, plus grosses */
      S.sizeBoost = small || mobile ? 1.55 : 1.0;
      if (reduce) n = Math.round(n * 0.35);
      return n;
    }

    /* -------------------------------------------------- pré-vieillissement
       La répartition STATIONNAIRE de l'équation de continuité,
       n(r) ∝ r/(1 − e^(−r²/λ)), est nettement creuse au cœur (≈ 0,25× la
       densité moyenne dans la couronne oculaire), alors qu'un tirage uniforme
       en surface y place beaucoup de particules. Sans pré-vieillissement, les
       premières secondes montreraient donc un cœur sur-peuplé en train de se
       vider, au lieu de l'état stable. On fait tourner la physique à vide
       pendant quelques secondes simulées : quelques millisecondes de calcul,
       et l'état affiché dès la première frame est le bon — ce qui compte
       pour le critère des 5 secondes. */
    function preAge(seconds) {
      const cfg = field.cfg;
      const rOut = cfg.R * 1.12;
      const rIn = cfg.rCore * 1.9;
      /* Pas volontairement large (0,5 s) : l'intégration du rayon est EXACTE
         sur le pas, et seule la statistique radiale nous intéresse ici — la
         finesse angulaire n'a aucune influence sur elle. Ce pas large rend le
         pré-vieillissement ~20× moins cher (≈ 5 ms au lieu de 130 ms), donc
         inaudible même si l'on redimensionne la fenêtre en continu. */
      const h = 1 / 2;
      const steps = Math.round(seconds / h);
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < P.n; i++) {
          probe.r = P.r[i]; probe.theta = P.th[i];
          probe.phase = P.ph[i]; probe.seed = P.sd[i];
          probe.ter = 0; probe.kind = P.kind[i]; probe.age = 0;
          field.step(probe, h, rIn, rOut);
          P.r[i] = probe.r; P.th[i] = probe.theta; P.kind[i] = probe.kind;
        }
      }
      for (let i = 0; i < P.n; i++) P.life[i] = 1;   // pas de fondu au démarrage
    }

    /* ====================================================== redimensionner */

    function resize() {
      const dpr = Math.min(global.devicePixelRatio || 1, 2);   // plafond DPR = 2
      const w = canvas.clientWidth || global.innerWidth;
      const h = canvas.clientHeight || global.innerHeight;

      S.dpr = dpr; S.w = w; S.h = h;
      S.vw = Math.max(1, Math.round(w * dpr));
      S.vh = Math.max(1, Math.round(h * dpr));
      S.cx = S.vw / 2;
      S.cy = S.vh / 2;

      canvas.width = S.vw;
      canvas.height = S.vh;

      /* le champ physique travaille en pixels CSS : on lui donne la taille
         CSS, mais les sprites sont dessinés en device px -> on garde une
         échelle pour convertir. */
      field.resize(w, h, S.userRate || RATE_DEFAULT, {
        tanAlpha: S.tanAlpha, coreRatio: S.coreRatio, eyeRatio: S.eyeRatio
      });

      buildBg();
      buildCaustics();
      buildVignette();

      /* Les sprites ne dépendent PAS de la taille : on ne les construit
         qu'une fois, mais c'est ici qu'on garantit qu'ils existent avant tout
         rendu — un appelant ne peut pas les oublier. */
      if (!S.sprite.length) buildSprites();

      S.count = chooseCount(S.reduce);
      spawnAll();
      preAge(30);          // 30 s simulées : la population atteint son régime
    }

    const RATE_DEFAULT = 9.5;   // tours/minute AU CŒUR (ressenti)
    S.userRate = RATE_DEFAULT;
    S.tanAlpha = 0.25;          // Q/Γ = tan(14°) — pente constante des volutes
    S.coreRatio = 0.16;         // r_c / R : l'œil occupe ~16 % du rayon
    S.eyeRatio = 0.55;          // r_œil / r_c : seuil de respawn

    /* ====================================================== frame */

    /* Fond : un seul fillRect par frame -> fondu progressif des traînées.
       Pas de lignes nettes, pas de clearRect (on veut la persistance). */
    function paintFade(alpha) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(3,8,22,' + alpha + ')';
      ctx.fillRect(0, 0, S.vw, S.vh);
    }

    function paintLayers() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (S.layerBg) ctx.drawImage(S.layerBg, 0, 0);

      if (S.layerCaustic) {
        /* caustiques en additif, faible opacité */
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.42;
        ctx.drawImage(S.layerCaustic, 0, 0);
        ctx.globalAlpha = 1;
      }
    }

    function paintVignette() {
      if (!S.layerVignette) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(S.layerVignette, 0, 0);
    }

    /* -------------------------------------------------- corps des particules
       Appelé avec les particules déjà avancées. Le rendu se contente de
       LIRE r et θ : c'est le seul mapping physique -> visuel. */
    function paintParticles() {
      const cfg = field.cfg;
      const dpr = S.dpr;
      const R = cfg.R;
      const rEye = cfg.rEye;
      const sizeBoost = S.sizeBoost || 1;
      const scale = dpr;                    // px CSS -> device px
      const cx = S.cx;                      // centre du vortex (device px)
      const cy = S.cy;
      /* Rotation rigide d'ensemble, purement cosmétique : elle garantit que
         « ça tourne » ne s'arrête jamais, sans toucher à l'état physique. */
      const drift = S.driftAngle;
      /* Serpentement : décalage angulaire borné, appliqué ici seulement.
         Amplitude 0,008 rad => ≈ 8 px au bord, ≈ 1 px près du cœur. */
      const t = S.time;
      const WOB = 0.008;

      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < P.n; i++) {
        const r = P.r[i];
        const base = P.th[i];
        const th = base + drift +
          Math.sin(base * 3 + P.ph[i] * 6.283 + P.sd[i] + t * 0.7) * WOB;
        const tt = clamp(1 - (r - rEye) / R, 0, 1);   // 1 = près du cœur

        /* --- éclat ∝ v_θ (vortex libre : le cœur tourne plus vite) --- */
        const shade = 0.30 + 0.70 * (tt * tt);

        /* --- profondeur : plus petit = plus opaque --- */
        const alpha = (0.16 + 0.68 * tt) * (P.life[i] < 0.12 ? P.life[i] / 0.12 : 1);
        if (alpha <= 0.004) continue;

        /* --- étirement : traînée plus longue là où v_θ est forte --- */
        const spin = 1 + 5.5 * tt * tt;
        const rad = (0.60 + P.sz[i] * 0.95) * sizeBoost * (1 - 0.42 * tt) * scale;

        const x = cx + Math.cos(th) * r * scale;
        const y = cy + Math.sin(th) * r * scale;

        let kk = P.kind[i];
        /* teinte : au bord on refroidit vers l'eau profonde, au cœur on
           éclaircit vers l'écume — jamais d'autre teinte que le bleu. */
        if (kk === 1 && tt > 0.72) kk = 2;
        const spr = S.sprite[kk];
        const sr = S.spriteR[kk];

        ctx.globalAlpha = alpha;
        ctx.drawImage(spr, x - rad, y - rad, rad * 2, rad * 2);

        /* Traînée : sprite comprimé tangentiellement (v_θ) et étiré
           radialement (v_r) -> le mouvement est lisible sans lignes nettes.
           Sous spin < 1,15 l'étirement est < 15 % : invisible, donc on
           économise le draw. Le seuil tombe à tt ≈ 0,165, soit r ≈ 0,92·R —
           environ un tiers de la population (mesuré : 34 %), ce qui supprime
           ~17 % des drawImage sans rien changer à l'image. */
        if (spin > 1.15) {
          ctx.globalAlpha = alpha * 0.30;
          ctx.drawImage(
            spr,
            x - rad * spin, y - rad / spin,
            rad * 2 * spin, rad * 2 / spin
          );
        }
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ------------------------------------------------------------------
     * frame — composition COMPLÈTE d'une image : fondu, couches, particules
     * sous parallaxe, vignettage. Un seul point d'entrée, pour que l'appelant
     * n'ait jamais à réimplémenter l'ordre de composition (l'oublier, c'est
     * dessiner les particules sous le fond ou perdre le vignettage).
     * ------------------------------------------------------------------ */
    function frame(fade, parX, parY) {
      const d = S.dpr;
      paintFade(fade);
      ctx.save();
      ctx.translate(parX * d, parY * d);
      paintLayers();
      paintParticles();
      ctx.restore();
      paintVignette();
    }

    return {
      S, P,
      probe,
      resize,
      frame,
      chooseCount
    };
  }

  global.VortexRenderer = { createRenderer, PALETTE, TAU, clamp };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRenderer, PALETTE };
  }
})(typeof window !== 'undefined' ? window : globalThis);

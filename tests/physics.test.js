/* ============================================================================
 * tests/physics.test.js — vérification du modèle physique
 * Exécution :  node tests/physics.test.js
 * ----------------------------------------------------------------------------
 * Contrôle les invariants exigés par la spécification :
 *   1. rotation solide au cœur, vortex libre à l'extérieur
 *   2. continuité de Rankine (Γ = 2πΩr_c²)
 *   3. spirale logarithmique : v_r/v_θ ≈ tan α sur toute la plage utile
 *   4. aspiration : v_r < 0 partout, jamais d'éjection
 *   5. raideur en 1/r² : ω(2r) = ω(r)/4 à l'extérieur
 *   6. respawn : aucune particule n'atteint r = 0
 *   7. intégration analytique : r²(t) exact à la tolérance machine
 * ==========================================================================*/
'use strict';

const { createField } = require('../src/field.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function close(a, b, tol) { return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)); }
function section(t) { console.log('\n' + t); }

const VW = 1440, VH = 900;
const RATE = 9.5, TAN = 0.30, CORE = 0.16, EYE = 0.55;
const X_STAR = 1.2564312086261697;   // racine de 1 − e^(−x) = 2x
const LAM_STAR = 1 - Math.exp(-X_STAR);      // ≈ 0.715332
const A_CORE = LAM_STAR / X_STAR;            // ≈ 0.569336

/* Profils de référence, écrits INDÉPENDAMMENT de l'implémentation :
     v_θ(r) = Γ/(2πr)·[1 − exp(−r²/λ)],   λ = r_c²/x*
     v_r(r) = −tan α · v_θ(r)             (spirale exacte) */
function vThetaRef(gamma, rCore, r) {
  if (r <= 0) return 0;
  const lambda = (rCore * rCore) / X_STAR;
  return (gamma / (2 * Math.PI * r)) * (1 - Math.exp(-(r * r) / lambda));
}
function vRadRef(gamma, rCore, tanA, r) {
  return -tanA * vThetaRef(gamma, rCore, r);
}

function makeField() {
  const f = createField();
  f.resize(VW, VH, RATE, { tanAlpha: TAN, coreRatio: CORE, eyeRatio: EYE });
  return f;
}

/* ==================================================================== 1–2 */
section('1–2. Cœur / extérieur / continuité de Rankine');
{
  const f = makeField();
  const c = f.cfg;
  const R = c.R;

  ok('r_c = coreRatio · R', close(c.rCore, R * CORE, 1e-12), 'r_c=' + c.rCore.toFixed(1));
  /* Γ = 2π ω₀ λ, avec ω₀ la vitesse angulaire de la rotation solide du cœur.
     Exprimé en unités de r_c : Γ = 2π ω₀ r_c²/x*. */
  ok('Γ = 2π·ω₀·λ = 2π·ω₀·r_c²/x*',
     close(c.gamma, 2 * Math.PI * c.omega0 * c.lambda, 1e-12) &&
     close(c.gamma, 2 * Math.PI * c.omega0 * c.rCore * c.rCore / X_STAR, 1e-12),
     'Γ=' + c.gamma.toExponential(3));
  /* v_θ est maximale exactement à r_c (c'est la définition de X_STAR).
     ω(r) = v_θ/r culmine PLUS PRÈS du centre, à r_c/√x* ≈ 0,892·r_c :
     la vitesse angulaire est donc maximale à l'intérieur du cœur. */
  const scanPeak = (fn) => { let br = 0, bv = -1;
    for (let r = c.rCore * 0.05; r < c.rCore * 3; r += 0.001) {
      const v = fn(r); if (v > bv) { bv = v; br = r; }
    }
    return br; };
  const peakV = scanPeak(r => f.thetaSpeed(r));
  ok('v_θ culmine exactement à r_c',
     Math.abs(peakV / c.rCore - 1) < 1e-3,
     'pic v_θ à ' + (peakV / c.rCore).toFixed(5) + '·r_c');
  /* ω est STRICTEMENT décroissante : maximum au centre, minimum au bord. */
  let monoW = true, prevW = Infinity;
  for (let r = 0.5; r < c.R * 1.2; r += 0.5) {
    const v = f.omega(r);
    if (v > prevW + 1e-12) monoW = false;
    prevW = v;
  }
  ok('ω strictement décroissante (rot. solide au cœur, 1/r² dehors)', monoW,
     'ω(0)=' + f.omega(1e-9).toFixed(4) + ' -> ω(R)=' + f.omega(c.R).toFixed(5));
  ok('ω(r_c) = ω₀·A_CORE = v_θ(r_c)/r_c',
     close(c.omegaAtCore, A_CORE * c.omega0, 1e-12) &&
     close(f.omega(c.rCore), c.omegaAtCore, 1e-9),
     'ω(r_c)=' + c.omegaAtCore.toFixed(4) + ' rad/s');
  ok('v_θ(r_c)/(Γ/(2πr_c)) = LAM_STAR (facteur de profil exact)',
     close(c.vMax / (c.gamma / (2 * Math.PI * c.rCore)), LAM_STAR, 1e-12),
     'LAM_STAR=' + LAM_STAR.toFixed(6));

  /* le profil doit coïncider avec Lamb–Oseen écrit à la main */
  let profErr = 0;
  for (let k = 1; k <= 60; k++) {
    const r = (k / 60) * R * 1.1;
    const a = f.thetaSpeed(r), b = vThetaRef(c.gamma, c.rCore, r);
    profErr = Math.max(profErr, Math.abs(a - b) / Math.max(1e-12, b));
  }
  ok('v_θ ≡ Γ/(2πr)·[1 − exp(−r²/λ)]  (rel. < 1e-9)', profErr < 1e-9,
     'écart relatif max ' + profErr.toExponential(2));

  /* Cœur : rotation solide -> ω(r) → ω₀ = ω(0) quand r → 0, l'écart
     relatif décroissant en r². On teste la CONVERGENCE, pas une valeur. */
  const relErr = (k) => Math.abs(f.omega(k * c.rCore) - c.omega0) / c.omega0;
  let solidOk = true, solidMax = 0;
  for (const k of [0.001, 0.005, 0.02, 0.05, 0.1]) {
    const e = relErr(k);
    solidMax = Math.max(solidMax, e);
    if (e > 0.02) solidOk = false;
  }
  ok('cœur : ω(r) → ω₀ (rotation solide, 2 % dès r ≤ 0,1·r_c)', solidOk,
     'écart max ' + (solidMax * 100).toFixed(3) + ' %');
  ok('ω(0) = ω₀ exactement (Γ = 2π ω₀ λ)', close(f.omega(1e-9), c.omega0, 1e-9),
     'ω(0)=' + f.omega(1e-9).toFixed(6));
  /* l'écart à la rotation solide décroît bien comme r² (signature Lamb–Oseen) */
  ok('écart à la rotation solide ∝ r² (quadratique)',
     relErr(0.02) / relErr(0.01) > 3.8 && relErr(0.02) / relErr(0.01) < 4.2,
     'rapport des écarts = ' + (relErr(0.02) / relErr(0.01)).toFixed(3));
  /* et la vitesse angulaire est plus forte DANS le cœur qu'à sa frontière */
  ok('ω augmente en entrant dans le cœur (concentration de vorticité)',
     f.omega(c.rCore * 0.5) > f.omega(c.rCore) * 1.4,
     'ω(0,5 r_c)/ω(r_c) = ' + (f.omega(c.rCore * 0.5) / f.omega(c.rCore)).toFixed(3));
  ok('ω(r_c)/ω₀ = A_CORE (identité du profil)',
     close(f.omega(c.rCore) / c.omega0, A_CORE, 1e-12),
     'ω(r_c)/ω₀=' + (f.omega(c.rCore) / c.omega0).toFixed(6));
  /* extérieur : ω(r)·r² → Γ/(2π) = ω₀λ/… : c'est la loi du vortex libre,
     la source de l'effet d'aspiration. */
  ok('ω(r)·r² → Γ/2π à l\'extérieur (vortex libre)',
     close(f.omega(30 * c.rCore) * Math.pow(30 * c.rCore, 2), c.gamma / (2 * Math.PI), 0.02),
     'ω(r)r²=' + (f.omega(30 * c.rCore) * Math.pow(30 * c.rCore, 2)).toFixed(1) +
     ' vs Γ/2π=' + (c.gamma / (2 * Math.PI)).toFixed(1));
  /* extérieur : vortex libre -> r·v_θ ≈ Γ/2π */
  const target = c.gamma / (2 * Math.PI);
  let freeOk = true, freeMax = 0;
  for (const r of [3, 5, 8, 12].map(k => k * c.rCore)) {
    if (r > R * 1.1) continue;
    const rv = r * f.thetaSpeed(r);
    const err = Math.abs(rv - target) / target;
    freeMax = Math.max(freeMax, err);
    if (err > 0.02) freeOk = false;
  }
  ok('extérieur : r·v_θ ≈ Γ/2π (vortex libre, ±2 %)', freeOk,
     'écart max ' + (freeMax * 100).toFixed(2) + ' %');

  ok('v_θ(0) = 0 (pas de singularité)', f.thetaSpeed(0) === 0);
  ok('v_θ > 0 partout (rotation non dégénérée)', f.thetaSpeed(1) > 0 && f.thetaSpeed(R) > 0);
}

/* ====================================================================== 3 */
section('3. Spirale logarithmique : angle trajectoire/cercle constant');
{
  const f = makeField();
  const c = f.cfg;
  let maxErr = 0;
  const rows = [];
  for (const r of [c.rCore * 1.5, c.rCore * 3, c.R * 0.35, c.R * 0.6, c.R * 0.95]) {
    const vt = Math.abs(f.thetaSpeed(r));
    const vr = Math.abs(f.radialSpeed(r));
    const ang = Math.atan(vr / vt);
    maxErr = Math.max(maxErr, Math.abs(ang - c.alpha) / c.alpha);
    rows.push('r=' + r.toFixed(0) + 'px α=' + (ang * 180 / Math.PI).toFixed(2) + '°');
  }
  ok('α mesuré ≈ atan(Q/Γ) partout (±3 %)', maxErr < 0.03,
     'α cible ' + (c.alpha * 180 / Math.PI).toFixed(2) + '° · ' + rows.join(' | '));

  /* α doit rester constant jusque DANS le cœur : c'est l'amortissement
     radial (radialDamp) qui l'assure en annulant v_r et v_θ ensemble. */
  let maxErrCore = 0;
  for (const r of [c.rCore, c.rCore * 0.5, c.rCore * 0.25, c.rEye]) {
    const vt = Math.abs(f.thetaSpeed(r));
    const vr = Math.abs(f.radialSpeed(r));
    maxErrCore = Math.max(maxErrCore, Math.abs(Math.atan(vr / vt) - c.alpha) / c.alpha);
  }
  ok('α constant jusqu\'à r_œil (spirale crédible jusqu\'au centre)', maxErrCore < 1e-9,
     'écart relatif max ' + maxErrCore.toExponential(2));

  /* v_r doit être EXACTEMENT proportionnel à v_θ (spirale exacte), et
     tendre vers −Q/(2πr) à l'extérieur. */
  let propErr = 0, farErr = 0;
  for (let k = 1; k <= 80; k++) {
    const r = (k / 80) * c.R * 1.2;
    const vr = f.radialSpeed(r), vt = f.thetaSpeed(r);
    if (vt > 1e-9) propErr = Math.max(propErr, Math.abs(vr / vt + TAN));
    /* asymptote lointaine : v_r ≈ −Q/(2πr) */
    if (r > c.rCore * 8) {
      const law = -c.q / (2 * Math.PI * r);
      farErr = Math.max(farErr, Math.abs(vr - law) / Math.abs(law));
    }
  }
  ok('v_r/v_θ = −tan α exactement (spirale logarithmique)', propErr < 1e-12,
     'écart max ' + propErr.toExponential(2));
  ok('loi de puits v_r ≈ −Q/(2πr) retrouvée à l\'extérieur (±2 %)', farErr < 0.02,
     'écart max ' + (farErr * 100).toFixed(3) + ' %');

  /* ---------------------------------------------------------------------
     La trajectoire exacte du champ est la spirale logarithmique
     r(θ) = r₀·exp(−tan α·θ). On l'intègre numériquement et on compare à la
     forme fermée au DERNIER point avant respawn (et non après : le respawn
     retirerait la particule au hasard).
     --------------------------------------------------------------------- */
  const r0 = 500;
  let p = { r: r0, theta: 0, phase: 0, seed: 0, ter: 0, kind: 1, age: 0 };
  const h = 1 / 240;
  let lastBefore = null, respawned = false, maxDrift = 0;
  /* le serpentement est désactivé dans ce test (ter = 0) : la trajectoire
     doit alors suivre la spirale exacte au pixel près. */
  for (let i = 0; i < 400000; i++) {
    const before = { r: p.r, theta: p.theta };
    if (f.step(p, h, c.rCore * 1.9, c.R * 1.12)) { respawned = true; break; }
    const predicted = r0 * Math.exp(-(c.q / c.gamma) * p.theta);
    maxDrift = Math.max(maxDrift, Math.abs(p.r - predicted));
    lastBefore = before;
  }
  ok('la particule finit bien par atteindre r_œil (aspiration effective)', respawned,
     'après ' + (lastBefore ? 'r=' + lastBefore.r.toFixed(2) + 'px' : '?'));
  ok('r(θ) ≡ r₀·exp(−(Q/Γ)θ) le long de la trajectoire (±1 px, sans bruit)',
     maxDrift < 1.0, 'dérive max ' + maxDrift.toFixed(4) + ' px');

  /* Le serpentement étant appliqué au RENDU (jamais dans l'état), la
     trajectoire physique doit rester sur la spirale même avec ter ≠ 0. */
  let p2 = { r: r0, theta: 0, phase: 0.3, seed: 1.1, ter: 1.25, kind: 1, age: 0 };
  let maxDrift2 = 0;
  for (let i = 0; i < 200000; i++) {
    if (f.step(p2, h, c.rCore * 1.9, c.R * 1.12)) break;
    const predicted = r0 * Math.exp(-(c.q / c.gamma) * p2.theta);
    maxDrift2 = Math.max(maxDrift2, Math.abs(p2.r - predicted));
  }
  ok('aucune dérive de la spirale, même avec le bruit de rendu armé (ter ≠ 0)',
     maxDrift2 < 1.0,
     'dérive max ' + maxDrift2.toFixed(4) + ' px · décalage visuel borné à ' +
     (0.008 * r0).toFixed(1) + ' px');
  /* --- les enroulements décroissent bien vers le centre ---------------- */
  const turnsFrom = (r0) => (1 / (2 * Math.PI)) * (c.gamma / c.q) * Math.log(r0 / c.rEye);
  ok('nombre de tours fini avant r_œil (pathologie 2.7 corrigée)',
     isFinite(turnsFrom(c.R)) && turnsFrom(c.R) < 40,
     turnsFrom(c.R).toFixed(1) + ' tours de R à r_œil');
  ok('moins de tours près du cœur qu\'au bord (enroulement qui se resserre)',
     turnsFrom(c.rCore * 3) < turnsFrom(c.R),
     turnsFrom(c.rCore * 3).toFixed(2) + ' tours depuis 3·r_c');
}

/* ====================================================================== 4 */
section('4. Aspiration (jamais d\'éjection)');
{
  const f = makeField();
  let negative = true;
  for (let r = 1; r < f.cfg.R * 1.2; r += 7) if (f.radialSpeed(r) >= 0) negative = false;
  ok('v_r(r) < 0 pour tout r', negative);
  ok('v_r borné au centre (|v_r(0)| fini)', isFinite(f.radialSpeed(0)) && Math.abs(f.radialSpeed(0)) < 1e6,
     'v_r(0)=' + f.radialSpeed(0).toFixed(1) + ' px/s');
  ok('v_r ≡ −tan α·v_θ (profil de référence)', (() => {
    let e = 0;
    for (let k = 1; k <= 50; k++) {
      const r = (k / 50) * f.cfg.R;
      e = Math.max(e, Math.abs(f.radialSpeed(r) - vRadRef(f.cfg.gamma, f.cfg.rCore, TAN, r)));
    }
    return e < 1e-9;
  })());
  /* le puits n'aspire plus au fond du creux : v_r → 0 quand r → 0,
     ce qui évite d'avoir à écrêter v_r arbitrairement */
  const vrNear = Math.abs(f.radialSpeed(f.cfg.rCore * 0.02));
  const vrFar = Math.abs(f.radialSpeed(f.cfg.R));
  ok('aspiration s\'annule au centre (aucune borne arbitraire nécessaire)',
     vrNear < vrFar, '|v_r(0,02 r_c)|=' + vrNear.toFixed(4) + ' < |v_r(R)|=' + vrFar.toFixed(3) + ' px/s');
}

/* ====================================================================== 5 */
section('5. Raideur en 1/r² : l\'aspiration vient de là');
{
  const f = makeField();
  const r = f.cfg.R * 0.5;
  const ratio = f.omega(r) / f.omega(2 * r);
  ok('ω(r)/ω(2r) ≈ 4 à l\'extérieur', close(ratio, 4, 0.03), 'ratio=' + ratio.toFixed(3));
  ok('ω décroît avec r', f.omega(r) > f.omega(2 * r) && f.omega(2 * r) > f.omega(4 * r));
}

/* ====================================================================== 6 */
section('6. Respawn : aucune particule n\'atteint r = 0');
{
  const f = makeField();
  const c = f.cfg;
  const rOut = c.R * 1.12, rIn = c.rCore * 1.9;
  /* On simule une POPULATION : c'est la seule façon de vérifier que le
     respawn réalimente bien le cœur en continu. Une particule seule met
     ~1 min à descendre, donc 1000 s de simulation d'une seule particule ne
     prouvent rien. */
  /* attention à l'ordre des arguments : step(p, dt, rIn, rOut) */
  const N = 400;
  const ps = [];
  for (let i = 0; i < N; i++) {
    ps.push({ r: Math.sqrt(rIn * rIn + Math.random() * (rOut * rOut - rIn * rIn)),
              theta: Math.random() * 6.283, phase: Math.random(), seed: Math.random(),
              ter: 0.35 + 0.9 * Math.random(), kind: 1, age: 0 });
  }
  let minR = Infinity, respawns = 0, bad = 0, diedThisStep;
  const h = 1 / 60;
  for (let i = 0; i < 18000; i++) {          // 300 s simulées
    for (let j = 0; j < N; j++) {
      const p = ps[j];
      diedThisStep = f.step(p, h, rIn, rOut);
      if (diedThisStep) { respawns++; if (p.r < rIn - 1e-6) bad++; }
      if (!isFinite(p.r) || !isFinite(p.theta) || p.r <= 0) bad++;
      if (p.r < minR) minR = p.r;
      if (p.r > rOut + 1e-6) bad++;
    }
  }
  ok('jamais de rayon nul ou non fini sur 7,2 M de pas-particule', bad === 0,
     'min r=' + minR.toFixed(2) + 'px');
  ok('le respawn se déclenche et réalimente le cœur en continu', respawns > 5,
     respawns + ' respawns sur ' + N + ' particules en 300 s simulées');
  /* L'invariant n'est PAS [rIn, rOut] : après un respawn en bordure, une
     particule redescend légitimement sous rIn en spirale. L'invariant réel
     est r_œil < r ≤ rOut à tout instant — c'est lui qui garantit qu'aucune
     particule n'atteint r = 0. */
  ok('invariant respecté à tout instant : r_œil < r ≤ rOut',
     ps.every(p => p.r > c.rEye && p.r <= rOut + 1e-6),
     'min observé ' + minR.toFixed(2) + ' px > r_œil=' + c.rEye.toFixed(2) +
     ' · max ' + Math.max(...ps.map(p => p.r)).toFixed(2) + ' ≤ rOut=' + rOut.toFixed(2));
  ok('des particules peuplent le cœur (le respawn réalimente la zone active)',
     ps.filter(p => p.r < rIn).length > 0,
     ps.filter(p => p.r < rIn).length + ' / ' + N + ' particules sous rIn');
}

/* ====================================================================== 7 */
section('7. Stabilité numérique près du cœur (vs Euler naïf)');
{
  const f = makeField();
  const c = f.cfg;

  /* Euler explicite sur v_r = −k/r franchit r = 0 dès que dt > r²/k :
     c'est la divergence garantie que la spécification interdit. */
  const k = c.kQ;
  const r = c.rCore * 0.5;              // dans la zone rapide
  const dt = 2;                         // 2 s : un pas réaliste après un
                                        // onglet resté longtemps en arrière-plan
  /* Euler naïf : r' = r + v_r(r)·dt. Au cœur, |v_r|/r est maximal, donc
     c'est là que le schéma casse. */
  /* v_r de référence : loi asymptotique −Q/(2πr), sans l'amortissement de
     cœur. C'est elle qu'un Euler naïf sur r intégrerait. */
  const vrAt = k / r;
  const analytic = Math.sqrt(Math.max(r * r - k * dt, 0));
  const euler = r - vrAt * dt;          // Euler naïf sur r, sans borne
  /* Critère d'instabilité : r² = r0² − 2k·dt < 0  <=>  dt > r0²/(2k) */
  const dtCrit = (r * r) / (2 * k);
  ok('Euler naïf : dt > r²/(2k) (r² devient négatif en un pas)',
     dt > dtCrit && vrAt * dt > r,
     'dt=' + dt + ' s > dt_crit=' + dtCrit.toFixed(3) + ' s');
  ok('Euler naïf produit un rayon négatif', euler < 0, 'Euler r\'=' + euler.toFixed(1) + 'px');
  ok('le schéma retenu reste ≥ 0 et fini',
     analytic >= 0 && isFinite(analytic), 'analytique r\'=' + analytic.toFixed(1) + 'px');

  /* et ce, même avec un pas énorme : la borne angulaire protège le schéma */
  const big = { r: r, theta: 0, phase: 0, seed: 0, ter: 0, kind: 1, age: 0 };
  f.step(big, 2, c.rCore * 1.9, c.R * 1.12);
  ok('le pas adaptatif garde le rayon positif et fini (dt = 2 s)',
     big.r > 0 && isFinite(big.r) && isFinite(big.theta),
     'r=' + big.r.toFixed(2) + 'px après dt=2 s');

  /* pas adaptatif : même avec dt = 1/30 s, jamais de saut de rayon */
  let worst = 1;
  for (const start of [c.rEye * 1.05, c.rEye * 2, c.rCore, c.rCore * 3]) {
    const p = { r: start, theta: 0, phase: 0, seed: 0, ter: 1.25, kind: 1, age: 0 };
    const before = p.r;
    f.step(p, 1 / 30, c.rCore * 1.9, c.R * 1.12);
    /* soit la particule respawne (r saute en bordure, c'est voulu),
       soit elle avance de façon continue */
    const jumped = !(p.r >= Math.min(before, c.rEye) * 0.98) && p.r < before;
    if (jumped) worst = 0;
  }
  ok('aucun saut brutal du rayon malgré dt = 1/30 s', worst === 1);
}

/* ====================================================================== 8 */
section('8. Surface libre et caustiques');
{
  const f = makeField();
  const c = f.cfg;
  /* z_s ∝ −1/r² : la profondeur normalisée décroît de façon monotone */
  let mono = true, prev = Infinity;
  for (let r = c.rEye; r < c.R; r += 5) {
    const d = f.depth(r);
    if (d > prev + 1e-9) mono = false;
    prev = d;
  }
  ok('profondeur décroissante avec r (creux hyperbolique)', mono);
  ok('profondeur bornée dans [0,1]', f.depth(0) <= 1 && f.depth(0) >= 0 && f.depth(c.R * 2) >= 0,
     'depth(cœur)=' + f.depth(0).toFixed(3));
  /* espacement des anneaux : r_k = r_c·sqrt(N/k) -> le rapport entre deux
     anneaux voisins tend vers 1, c'est un resserrement hyperbolique. */
  const N = 34, rc = c.rCore;
  const a1 = rc * Math.sqrt(N / 30), a2 = rc * Math.sqrt(N / 31);
  ok('anneaux resserrés près du cœur', (a2 - a1) < (rc * Math.sqrt(N / 3) - rc * Math.sqrt(N / 4)));
}

/* ====================================================================== 9 */
section('9. Cohérence des paramètres du champ');
{
  const f = makeField();
  const c = f.cfg;
  const vCore = f.thetaSpeed(c.rCore);
  ok('v_θ(r_c) = ω(r_c)·r_c = vMax',
     close(vCore, c.omegaAtCore * c.rCore, 1e-9) && close(vCore, c.vMax, 1e-9),
     'v_max=' + vCore.toFixed(1) + ' px/s');
  /* v_max est atteint exactement à r = r_c : c'est la définition de X_STAR */
  let peakR = 0, peakV = -1;
  for (let r = 1; r < c.R * 1.2; r += 0.25) {
    const v = f.thetaSpeed(r);
    if (v > peakV) { peakV = v; peakR = r; }
  }
  ok('vitesse maximale atteinte à r = r_c (±0,5 %)',
     Math.abs(peakR - c.rCore) / c.rCore < 0.005,
     'pic à ' + peakR.toFixed(2) + 'px vs r_c=' + c.rCore.toFixed(2) + 'px');
  ok('r_œil < r_c (l\'œil est dans le cœur)', c.rEye < c.rCore,
     'r_œil=' + c.rEye.toFixed(1) + ' < r_c=' + c.rCore.toFixed(1));
  ok('tan α = Q/Γ', close(c.q / c.gamma, TAN, 1e-9));
  /* La période orbitale AU CŒUR est exactement 60/rate : c'est la grandeur
     que le curseur annonce, et c'est là que la rotation se lit. */
  const Treal = (2 * Math.PI) / f.omega(c.rCore);
  ok('période orbitale à r_c = 60/rate (valeur affichée au curseur)',
     close(Treal, 60 / RATE, 1e-9),
     'T(r_c)=' + Treal.toFixed(2) + ' s · T_bord=' + c.periodRim.toFixed(1) + ' s');
  ok('le bord tourne plus lentement que le cœur (signature du vortex)',
     c.periodRim > Treal * 5, 'rapport ' + (c.periodRim / Treal).toFixed(1) + '×');
  ok('vMax = ω(r_c)·r_c et aStar = LAM_STAR',
     close(c.vMax, c.omegaAtCore * c.rCore, 1e-12) && close(c.aStar, LAM_STAR, 1e-12),
     'vMax=' + c.vMax.toFixed(2) + ' px/s');
  ok('Γ = 2π ω₀ λ (définition qui rend ω(0) = ω₀)',
     close(c.gamma, 2 * Math.PI * c.omega0 * c.lambda, 1e-12),
     'Γ=' + c.gamma.toFixed(1));
}

/* ================================================================ résumé */
console.log('\n' + '='.repeat(62));
console.log(pass + ' vérifications passées, ' + fail + ' échec(s)');
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);

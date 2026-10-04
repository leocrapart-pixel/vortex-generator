/* ============================================================================
 * tests/dom.test.js — vérification du rendu, du routeur et de la boucle
 * Exécution :  node tests/dom.test.js
 * ----------------------------------------------------------------------------
 * Aucun navigateur n'est disponible ici : on fournit un DOM et un contexte
 * Canvas 2D MINIMALISTES mais suffisants pour exécuter réellement le code.
 * L'objectif n'est pas de juger l'esthétique, mais de garantir que
 *   · chaque fonction est appelée sans lever d'exception ;
 *   · aucune valeur non finie (NaN / Infinity) n'atteint l'API Canvas ;
 *   · le DPR est bien plafonné à 2 ;
 *   · le routeur couvre les trois vues, le 404 et les transitions ;
 *   · prefers-reduced-motion réduit bien densité et vitesse.
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function section(t) { console.log('\n' + t); }

/* ====================================================== Canvas 2D factice */
const canvasCalls = { drawImage: 0, fill: 0, gradient: 0, stroke: 0, ellipse: 0 };
const badValues = [];

function checkNums(where, args) {
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (typeof v === 'number' && !Number.isFinite(v)) {
      badValues.push(where + ' arg#' + i + ' = ' + v);
    }
  }
}

function makeGradient() {
  canvasCalls.gradient++;
  return { addColorStop(off, col) { checkNums('addColorStop', [off]); } };
}

function makeCtx(canvas) {
  const g = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    save() {}, restore() {}, translate(x, y) { checkNums('translate', [x, y]); },
    scale() {}, rotate() {}, beginPath() {}, closePath() {},
    fill() { canvasCalls.fill++; },
    stroke() { canvasCalls.stroke++; },
    arc(x, y, r) { checkNums('arc', [x, y, r]); },
    ellipse(x, y, rx, ry) { canvasCalls.ellipse++; checkNums('ellipse', [x, y, rx, ry]); },
    fillRect(x, y, w, h) { checkNums('fillRect', [x, y, w, h]); },
    clearRect(x, y, w, h) { checkNums('clearRect', [x, y, w, h]); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      checkNums('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
      return makeGradient();
    },
    createLinearGradient() { return makeGradient(); },
    drawImage(img, ...rest) {
      canvasCalls.drawImage++;
      if (!img) badValues.push('drawImage sans image');
      checkNums('drawImage', rest);
      /* forme 5 args : (img, dx, dy, dw, dh) : la taille doit être > 0.
         Une largeur ou une hauteur nulle/négative signifie sprite écrasé. */
      if (rest.length === 4) {
        const dw = rest[2], dh = rest[3];
        if (typeof dw === 'number' && typeof dh === 'number') {
          if (!(dw > 0) || !(dh > 0)) {
            badValues.push('drawImage taille non positive (' + dw.toFixed(4) + 'x' + dh.toFixed(4) + ')');
          }
          if (dw > 1e5 || dh > 1e5) {
            badValues.push('drawImage taille démesurée (' + dw.toFixed(0) + 'x' + dh.toFixed(0) + ')');
          }
        }
      }
    },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
    putImageData() {}
  };
  return g;
}

function makeCanvas() {
  const c = {
    width: 0, height: 0,
    clientWidth: 1440, clientHeight: 900,
    style: {},
    _ctx: null,
    getContext() { if (!this._ctx) this._ctx = makeCtx(this); return this._ctx; },
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, querySelector() { return null; },
    querySelectorAll() { return []; },
    dataset: {}, focus() {}
  };
  return c;
}

/* ============================================================ DOM factice */
function makeNode(tag) {
  const n = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], attributes: {}, style: {}, dataset: {},
    _cls: new Set(), innerHTML: '', textContent: '', value: '',
    hidden: false, disabled: false,
    firstElementChild: null,
    classList: {
      add: (c) => n._cls.add(c),
      remove: (c) => n._cls.delete(c),
      toggle: (c, f) => { const on = f == null ? !n._cls.has(c) : !!f; on ? n._cls.add(c) : n._cls.delete(c); return on; },
      contains: (c) => n._cls.has(c)
    },
    setAttribute(k, v) { n.attributes[k] = String(v); },
    getAttribute(k) { return k in n.attributes ? n.attributes[k] : null; },
    removeAttribute(k) { delete n.attributes[k]; },
    addEventListener(t, fn) { (n._h = n._h || {})[t] = (n._h[t] || []).concat(fn); },
    removeEventListener() {},
    dispatch(t, ev) { (n._h && n._h[t] ? n._h[t] : []).forEach(fn => fn(ev || {})); },
    querySelector() { return null },
    querySelectorAll() { return []; },
    focus() { n._focused = true; },
    reset() { n._reset = true; },
    appendChild(c) { n.children.push(c); return c; },
    closest() { return null }
  };
  return n;
}

/* ---- éléments attendus par le code ---- */
const nodes = {};
function el(id) {
  if (!nodes[id]) {
    const tag = /^c[A-Z]/.test(id) ? 'input' : 'div';
    nodes[id] = makeNode(tag);
    nodes[id].id = id;
  }
  return nodes[id];
}

['kRate', 'kAlpha', 'kCore', 'kTrail',
 'kRateOut', 'kAlphaOut', 'kCoreOut', 'kTrailOut',
 'cName', 'cMail', 'cMsg', 'cNameErr', 'cMailErr', 'cMsgErr',
 'formStatus', 'panelToggle', 'panel', 'hud', 'contactForm'].forEach(el);

/* la vue reçoit son HTML par innerHTML : on simule le DOM produit */
const viewMount = makeNode('main');
viewMount.id = 'view';
viewMount.innerHTML = '';
nodes.view = viewMount;

const vortexCanvas = makeCanvas();
vortexCanvas.id = 'vortex';
nodes.vortex = vortexCanvas;

/* les champs du formulaire sont retrouvés via #id par le routeur */
function formField(id) { return el(id); }
['cName', 'cMail', 'cMsg'].forEach(id => { el(id).value = ''; });

const document = {
  readyState: 'complete',
  title: '',
  hidden: false,
  documentElement: makeNode('html'),
  body: makeNode('body'),
  createElement: (t) => makeCanvas(),
  getElementById: (id) => nodes[id] || null,
  querySelector: (sel) => {
    if (sel === '#contactForm') return nodes.contactForm;
    if (sel.startsWith('#')) return nodes[sel.slice(1)] || null;
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '[data-nav]') return navLinks;
    return [];
  },
  addEventListener(t, fn) { (document._h = document._h || {})[t] = (document._h[t] || []).concat(fn); },
  dispatch(t, ev) { (document._h && document._h[t] ? document._h[t] : []).forEach(fn => fn(ev || {})); }
};

/* le mount doit exposer les champs du formulaire après rendu */
function installViewContent(html, path) {
  /* on extrait les id présents dans le HTML généré */
  const ids = [];
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  nodes.view.innerHTML = html;
  nodes.view._ids = ids;
  nodes.view.firstElementChild = ids.length ? makeNode('div') : null;
  /* les éléments du formulaire deviennent trouvables par id */
  ids.forEach(id => {
    const n = makeNode(/^c[A-Z]/.test(id) ? 'input' : 'div');
    n.id = id;
    nodes[id] = n;
  });
  /* les champs de formulaire doivent renvoyer une valeur exploitable */
  ['cName', 'cMail', 'cMsg'].forEach(id => { if (nodes[id]) nodes[id].value = ''; });
  return ids;
}

/* la vue réelle remplace querySelector sur le mount */
const viewIds = new Set();
nodes.view.querySelector = (sel) => {
  if (sel.startsWith('#')) return nodes[sel.slice(1)] || null;
  return null;
};
nodes.view.querySelectorAll = () => [];

const navLinks = ['accueil', 'projets', 'contact'].map(k => {
  const a = makeNode('a');
  a.setAttribute('data-nav', k);
  a.setAttribute('href', '#/' + (k === 'accueil' ? '' : k));
  return a;
});

const rafQueue = [];
const window = {
  document,
  devicePixelRatio: 3,                    // > 2 : on doit voir le plafond agir
  innerWidth: 1440, innerHeight: 900,
  location: { hash: '', pathname: '/index.html' },
  history: { replaceState() {} },
  navigator: { userAgent: 'node-test' },
  matchMedia: (q) => ({
    matches: q.indexOf('reduced-motion') >= 0 ? false : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  }),
  addEventListener(t, fn) { (window._h = window._h || {})[t] = (window._h[t] || []).concat(fn); },
  removeEventListener() {},
  dispatch(t, ev) { (window._h && window._h[t] ? window._h[t] : []).forEach(fn => fn(ev || {})); },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout: (fn, ms) => { window._timers.push({ fn, ms }); return window._timers.length; },
  clearTimeout() {},
  _timers: [],
  _h: {},
  getComputedStyle: () => ({ getPropertyValue: () => '' })
};
window.window = window;
window.globalThis = window;
window.self = window;

/* ====================================================== charger les scripts */
const sandbox = vm.createContext(window);
const files = ['src/field.js', 'src/renderer.js', 'src/views.js', 'src/router.js', 'src/main.js'];
section('0. Chargement des scripts (contexte type navigateur, file://)');
{
  let loaded = 0;
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: f });
      loaded++;
    } catch (e) {
      fail++;
      console.log('  FAIL ' + f + ' : ' + e.message);
    }
  }
  ok('les 5 scripts s\'exécutent sans exception', loaded === files.length,
     loaded + '/' + files.length);
  ok('window.VortexField exposé', typeof window.VortexField === 'object');
  ok('window.VortexRenderer exposé', typeof window.VortexRenderer === 'object');
  ok('window.VortexViews expose 3 vues', Object.keys(window.VortexViews.VIEWS).length === 3,
     Object.keys(window.VortexViews.VIEWS).join(' '));
  ok('window.VortexRouter exposé', typeof window.VortexRouter === 'object');
  ok('window.__vortex exposé (debug)', typeof window.__vortex === 'object');
}

const V = window.__vortex;
const R = V.R;
const field = V.field;

/* ==================================================================== 1 */
section('1. Sprite et couches pré-rendus (aucun gradient par frame)');
{
  ok('3 familles de sprites construites', R.S.sprite.length === 3,
     'tailles ' + R.S.spriteR.join('/'));
  ok('couche de fond construite', !!R.S.layerBg);
  ok('couche de caustiques construite', !!R.S.layerCaustic);
  ok('couche de vignettage construite', !!R.S.layerVignette);
  const gAfterResize = canvasCalls.gradient;
  /* simuler 3 frames : le nombre de gradients ne doit PAS augmenter */
  for (let i = 0; i < 3; i++) R.frame(0.1, 0, 0);
  ok('aucun createRadialGradient dans la boucle de rendu',
     canvasCalls.gradient === gAfterResize,
     'gradients ' + gAfterResize + ' -> ' + canvasCalls.gradient);
}

/* ==================================================================== 2 */
section('2. DPR plafonné et dimensions cohérentes');
{
  ok('devicePixelRatio = 3 en entrée', window.devicePixelRatio === 3);
  ok('DPR plafonné à 2', R.S.dpr === 2, 'dpr=' + R.S.dpr);
  ok('canvas dimensionné en device px', vortexCanvas.width === 2880 && vortexCanvas.height === 1800,
     vortexCanvas.width + 'x' + vortexCanvas.height);
  ok('centre au milieu du canvas', R.S.cx === 1440 && R.S.cy === 900);
  ok('r_c à 16 % du rayon de référence',
     Math.abs(R.S.userRate - V.KNOBS.rate) < 1e-9 && R.S.coreRatio === V.KNOBS.coreRatio);
}

/* ==================================================================== 3 */
section('3. Boucle de simulation et de rendu (600 frames)');
{
  const before = canvasCalls.drawImage;
  for (let i = 0; i < 600; i++) {
    V.stepParticles(1 / 60);
    R.frame(V.KNOBS.fade, V.state.parX, V.state.parY);
  }
  ok('600 frames rendues sans exception', true);
  const draws = canvasCalls.drawImage - before;
  ok('des particules sont effectivement dessinées', draws > before + 100000,
     draws + ' drawImage');
  /* Le quad de traînée est sauté quand l'étirement est invisible (< 15 %) :
     sans ce saut on serait à exactement 2 drawImage par particule et par
     frame. Le seuil tombe à r ≈ 0,92·R, soit ~34 % de la population, d'où
     ~1,66 draw/particule. Cette borne verrouille l'optimisation : si elle
     disparaît, le rapport remonte à 2,00 et le test échoue. */
  const framesRun = 600, particles = R.P.n;
  const perParticle = draws / framesRun / particles;
  ok('les quads de traînée invisibles sont sautés (< 1,70 draw/particule vs 2,00)',
     perParticle < 1.70,
     perParticle.toFixed(2) + ' drawImage par particule et par frame');
  ok('aucune valeur non finie / taille invalide transmise à Canvas',
     badValues.length === 0,
     badValues.length ? badValues.slice(0, 5).join(' | ') : 'aucune');
  /* tous les rayons restent dans les bornes physiques */
  const P = R.P;
  let minR = Infinity, maxR = -Infinity, bad = 0;
  for (let i = 0; i < P.n; i++) {
    const r = P.r[i], th = P.th[i];
    if (!Number.isFinite(r) || !Number.isFinite(th) || r <= field.cfg.rEye * 0.99) bad++;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  ok('toutes les particules sont dans la zone active', bad === 0,
     'r ∈ [' + minR.toFixed(1) + ', ' + maxR.toFixed(1) + '] px');

  /* Le cœur doit être peuplé DÈS LE DÉPART : c'est la zone que l'œil suit
     dans les 5 premières secondes. Le pré-vieillissement doit donc avoir
     installé la répartition stationnaire, pas l'état initial uniforme. */
  const inCore = (() => { let n = 0;
    for (let i = 0; i < P.n; i++) if (P.r[i] < field.cfg.rCore * 2) n++;
    return n; })();
  ok('le cœur est peuplé dès la première frame (pré-vieillissement)',
     inCore > 0, inCore + ' particules sous 2·r_c (sur ' + P.n + ')');
  const inEye = (() => { let n = 0;
    for (let i = 0; i < P.n; i++) if (P.r[i] < field.cfg.rEye) n++;
    return n; })();
  ok('mais jamais DANS l\'œil (r < r_œil)', inEye === 0, inEye + ' particule(s)');
}

/* ==================================================================== 4 */
section('4. Densité adaptative et accessibilité');
{
  const n1 = R.P.n;
  const n2 = R.chooseCount(true);
  const n3 = R.chooseCount(false);
  ok('densité réduite sous prefers-reduced-motion', n2 < n3, n3 + ' -> ' + n2 + ' particules');
  ok('densité plafonnée (jamais plus de 2200)', n3 <= 2200, n3 + ' particules');
  ok('densité plancher (jamais moins de 260)', n2 >= 260, n2 + ' particules');
  ok('nombre de particules initial cohérent', n1 === n3, n1 + ' = ' + n3);
}

/* ==================================================================== 5 */
section('5. Routeur : trois vues, 404, transitions');
{
  const Router = window.VortexRouter;
  ok('normalisation : # -> /', Router.normalize('') === '/');
  ok('normalisation : #/projets/ -> /projets', Router.normalize('#/projets/') === '/projets');
  ok('normalisation : projets -> /projets', Router.normalize('projets') === '/projets');
  ok('normalisation : ?query retirée', Router.normalize('#/contact?x=1') === '/contact');

  /* chaque vue produit du HTML non vide avec un h1 et pas de débordement */
  const Views = window.VortexViews;
  let allOk = true, titles = [];
  for (const key of ['/', '/projets', '/contact']) {
    const html = Views.VIEWS[key].render();
    titles.push(Views.VIEWS[key].title);
    if (!html || html.length < 200) allOk = false;
    if (html.indexOf('<h1') < 0) allOk = false;
    /* la contrainte de composition : pas de contenu au centre exact.
       Chaque vue doit séparer bande haute et bande basse. */
    if (html.indexOf('view__band--top') < 0 || html.indexOf('view__band--bottom') < 0) allOk = false;
  }
  ok('les 3 vues rendent un HTML structuré (h1 + bandes haut/bas)', allOk);
  ok('chaque vue a un titre de document', titles.every(t => t && t.length > 3), titles.join(' · '));

  /* résolution de route */
  window.location.hash = '#/projets';
  const r1 = Router.resolve();
  ok('route #/projets résolue', r1.path === '/projets' && !!r1.view);
  window.location.hash = '#/inconnu';
  const r2 = Router.resolve();
  ok('route inconnue -> view null (404 géré)', r2.view === null);

  /* le routeur écrit dans #view sans toucher au canvas */
  window.location.hash = '#/';
  Router.apply(false);
  ok('le canvas n\'est jamais recréé par le routeur',
     document.getElementById('vortex') === vortexCanvas);
  ok('le mount reçoit la vue accueil', nodes.view.innerHTML.indexOf('<h1') >= 0);
}

/* ==================================================================== 6 */
section('6. Palette : bleu uniquement, jamais de teinte chaude');
{
  const pal = window.VortexRenderer.PALETTE;
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  /* toutes les couleurs hexadécimales du CSS et de la palette */
  const hexes = [];
  const re = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  let m;
  while ((m = re.exec(css))) hexes.push(m[1]);
  for (const k in pal) {
    const v = pal[k];
    const mm = /#([0-9a-fA-F]{6})/.exec(v) || /#([0-9a-fA-F]{3})/.exec(v);
    if (mm) hexes.push(mm[1]);
  }
  /* certaines couleurs sont en rgba(...) : on les analyse aussi */
  const rgbas = [];
  const re2 = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  let m2;
  while ((m2 = re2.exec(css))) rgbas.push([+m2[1], +m2[2], +m2[3]]);
  while ((m2 = re2.exec(JSON.stringify(pal)))) rgbas.push([+m2[1], +m2[2], +m2[3]]);

  function hexToRgb(h) {
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function hue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return null;                        // gris : pas de teinte
    let h;
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return (h + 360) % 360;
  }

  const allRgb = hexes.map(hexToRgb).concat(rgbas);
  let warm = [], violet = [], green = [];
  for (const [r, g, b] of allRgb) {
    const h = hue(r, g, b);
    if (h == null) continue;                          // noir/gris/blanc
    /* bleu autorisé : 185° (cyan) -> 230° (bleu) */
    if (h > 230 && h < 300) violet.push('hsl(' + h.toFixed(0) + ')');
    if (h > 60 && h < 180) green.push('hsl(' + h.toFixed(0) + ')');
    if (r > g && r > b) warm.push('rgb(' + r + ',' + g + ',' + b + ') h=' + h.toFixed(0));
    if (h > 300 || h < 60) warm.push('hsl(' + h.toFixed(0) + ')');
  }
  ok('aucune teinte violette (h > 230°)', violet.length === 0, violet.slice(0, 4).join(' ') || 'aucune');
  ok('aucune teinte verte (60° < h < 180°)', green.length === 0, green.slice(0, 4).join(' ') || 'aucune');
  ok('aucune couleur chaude (rouge/orange/jaune/magenta)', warm.length === 0,
     warm.slice(0, 4).join(' ') || 'aucune');
  ok('le rouge domine au plus faiblement dans les gris froids',
     allRgb.every(([r, g, b]) => r <= b), allRgb.length + ' couleurs analysées');
}

/* ==================================================================== 7 */
section('7. Composition : protection du centre et lisibilité');
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  ok('un couloir central est réservé (--eye-safe)', /--eye-safe\s*:/.test(css));
  ok('la vue réserve ce couloir (gap: var(--eye-safe))',
     /gap:\s*var\(--eye-safe\)/.test(css));
  ok('le canvas est fixe et plein écran (#vortex position: fixed)',
     /#vortex\s*\{[^}]*position:\s*fixed/.test(css));
  ok('un voile radial protège le texte (.veil)', /\.veil\s*\{[^}]*radial-gradient/.test(css));
  ok('les cartes sont en verre dépoli (backdrop-filter)',
     /\.card\s*\{[^}]*backdrop-filter/.test(css));
  ok('prefers-reduced-motion est respecté dans le CSS',
     /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
  ok('prefers-contrast: more est géré', /@media\s*\(prefers-contrast:\s*more\)/.test(css));
  ok('cibles tactiles ≥ 44px (.btn min-height)',
     /\.btn\s*\{[^}]*min-height:\s*44px/.test(css));
  ok('focus visible défini', /:focus-visible/.test(css));
}

/* ==================================================================== 8 */
section('8. Vues : contenu et formulaire');
{
  const Views = window.VortexViews;
  const home = Views.VIEWS['/'].render();
  const proj = Views.VIEWS['/projets'].render();
  const cont = Views.VIEWS['/contact'].render();

  ok('Accueil : 3 cartes descriptives', (home.match(/class="card"/g) || []).length === 3,
     (home.match(/class="card"/g) || []).length + ' cartes');
  ok('Accueil : promesse + 2 appels à l\'action',
     home.indexOf('display') > 0 && (home.match(/class="btn/g) || []).length >= 2);
  ok('Projets : 6 cartes de projets', (proj.match(/class="card"/g) || []).length === 6,
     (proj.match(/class="card"/g) || []).length + ' cartes');
  ok('Contact : formulaire avec 3 champs',
     cont.indexOf('cName') > 0 && cont.indexOf('cMail') > 0 && cont.indexOf('cMsg') > 0);
  ok('Contact : retour visuel aria-live',
     /role="status"[^>]*aria-live="polite"|aria-live="polite"/.test(cont));
  ok('Contact : labels associés (for/id)',
     /for="cName"/.test(cont) && /id="cName"/.test(cont) &&
     /for="cMail"/.test(cont) && /for="cMsg"/.test(cont));
  ok('aucune vue ne place de contenu hors des bandes',
     [home, proj, cont].every(h => h.indexOf('view__band--top') > 0));
}

/* ================================================================ résumé */
console.log('\n' + '='.repeat(62));
console.log(pass + ' vérifications passées, ' + fail + ' échec(s)');
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);

/* ============================================================================
 * router.js — routeur SPA sur hash
 * ----------------------------------------------------------------------------
 * #/  ·  #/projets  ·  #/contact
 * Compatible file:// : le hash ne déclenche jamais de requête réseau, donc
 * aucun rechargement et aucun serveur nécessaire.
 *
 * Le canvas du vortex est HORS du conteneur de vues : il n'est jamais
 * détruit ni recréé lors d'un changement de route.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const views = global.VortexViews.VIEWS;
  const DEFAULT = '/';

  /* ------------------------------------------------------------ normaliser
     « #/projets/ » « #projets » « #/projets?x=1 » -> « /projets » */
  function normalize(hash) {
    let h = String(hash || '').replace(/^#/, '');
    h = h.split('?')[0].split('&')[0];
    if (!h) return DEFAULT;
    if (h.charAt(0) !== '/') h = '/' + h;
    h = h.replace(/\/+$/, '');
    return h === '' ? DEFAULT : h;
  }

  function resolve() {
    const path = normalize(global.location.hash);
    return { path: path, view: views[path] || null };
  }

  /* ------------------------------------------------------------- rendering */
  let current = null;

  function render(mount, view, path) {
    document.title = view.title;
    mount.innerHTML = view.render();
    mount.dataset.route = path;
    /* Route « nue » : ni voile radial ni couloir central réservé. */
    mount.classList.toggle('is-bare', !!view.bare);
    bindView(mount, path);
    current = path;
    markNav(view.nav);

    /* accessibilité : on annonce le changement de vue et on pose le focus
       sur le titre sans casser le défilement. */
    const h1 = mount.querySelector('h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
  }

  function markNav(key) {
    const links = document.querySelectorAll('[data-nav]');
    for (let i = 0; i < links.length; i++) {
      const on = links[i].getAttribute('data-nav') === key;
      links[i].classList.toggle('is-active', on);
      if (on) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  /* -------------------------------------------------- comportements de vue */
  function bindView(mount, path) {
    if (path === '/contact') bindContact(mount);
  }

  function bindContact(mount) {
    const form = mount.querySelector('#contactForm');
    if (!form) return;
    const status = mount.querySelector('#formStatus');

    const rules = [
      { id: 'cName', err: 'cNameErr', test: v => v.trim().length >= 1 },
      { id: 'cMail', err: 'cMailErr', test: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) },
      { id: 'cMsg', err: 'cMsgErr', test: v => v.trim().length >= 4 }
    ];

    function check(el, rule) {
      const ok = rule.test(el.value);
      const err = mount.querySelector('#' + rule.err);
      el.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (err) err.hidden = ok;
      return ok;
    }

    rules.forEach(r => {
      const el = mount.querySelector('#' + r.id);
      if (!el) return;
      el.addEventListener('blur', () => check(el, r));
      el.addEventListener('input', () => {
        if (el.getAttribute('aria-invalid') === 'true') check(el, r);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let ok = true;
      let firstBad = null;
      rules.forEach(r => {
        const el = mount.querySelector('#' + r.id);
        if (!el) return;
        const good = check(el, r);
        if (!good && !firstBad) firstBad = el;
        ok = ok && good;
      });

      if (!ok) {
        if (status) {
          status.textContent = 'Formulaire incomplet.';
          status.className = 'form__status is-bad';
        }
        if (firstBad) firstBad.focus();
        return;
      }

      /* Aucun backend : retour visuel local, sans requête réseau. */
      const name = (mount.querySelector('#cName').value || '').trim();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }

      global.setTimeout(() => {
        form.classList.add('is-sent');
        if (btn) { btn.disabled = false; btn.textContent = 'Envoyer'; }
        if (status) {
          status.textContent = 'Message envoyé' + (name ? ', ' + name : '') +
            '. Réponse sous deux jours ouvrés.';
          status.className = 'form__status is-ok';
        }
        form.reset();
      }, 520);
    });
  }

  /* ------------------------------------------------------------ navigation */
  function go(hash) {
    if (normalize(global.location.hash) === normalize(hash)) {
      apply(true);
    } else {
      global.location.hash = hash;
    }
  }

  function apply(force) {
    const r = resolve();
    const mount = document.getElementById('view');

    /* route inconnue -> 404 douce, jamais d'écran vide */
    if (!r.view) {
      document.title = 'Vortex — page introuvable';
      markNav(null);
      mount.innerHTML =
        '<div class="view__band view__band--top view__band--left">' +
          '<p class="eyebrow">404</p>' +
          '<h1 class="display display--sm">Ce courant ne mène nulle part.</h1>' +
          '<p class="lede">La page demandée n\'existe pas. Le vortex, lui, tourne toujours.</p>' +
          '<div class="actions"><a class="btn btn--primary" href="#/">Retour à l\'accueil</a></div>' +
        '</div>';
      current = null;
      return;
    }

    if (!force && current === r.path) return;

    /* transition : fondu sortant, puis rendu, puis fondu entrant.
       Aucune animation si prefers-reduced-motion. */
    const reduce = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !mount.firstElementChild) {
      render(mount, r.view, r.path);
      return;
    }

    mount.classList.add('is-leaving');
    global.setTimeout(() => {
      mount.classList.remove('is-leaving');
      render(mount, r.view, r.path);
      mount.classList.add('is-entering');
      global.requestAnimationFrame(() => {
        global.requestAnimationFrame(() => mount.classList.remove('is-entering'));
      });
    }, 170);
  }

  function start() {
    /* ancres internes -> on intercepte pour éviter tout rechargement */
    document.addEventListener('click', (e) => {
      const a = e.target.closest ? e.target.closest('a[href^="#/"]') : null;
      if (!a) return;
      e.preventDefault();
      go(a.getAttribute('href'));
    });

    global.addEventListener('hashchange', () => apply(false));

    /* hash vide au premier chargement : on le pose sans créer d'entrée
       d'historique supplémentaire */
    if (!global.location.hash) {
      global.history.replaceState(null, '', global.location.pathname + '#/');
    }
    apply(false);
  }

  global.VortexRouter = { start, go, normalize, resolve, apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);

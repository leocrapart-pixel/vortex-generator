/* ============================================================================
 * views.js — contenu des trois vues + vue Projets
 * ----------------------------------------------------------------------------
 * Le canvas du vortex reste EN ARRIÈRE-PLAN, fixe et plein écran : changer de
 * vue ne le touche jamais. Le contenu vit au-dessus, derrière un voile radial
 * qui protège la lisibilité.
 *
 * CONTRAINTE DE COMPOSITION : le vortex attire l'œil au centre, donc aucune
 * vue ne place de contenu dans l'ellipse centrale. La grille laisse un
 * « couloir » vide au milieu (voir styles.css : --eye-safe).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ data */
  const PROJECTS = [
    {
      tag: 'Fluide',
      title: 'Stable Fluids 2D',
      body: "Solveur de Navier–Stokes incompressible en WebGL : advection semi-lagrangienne, projection de pression, confinement de vorticité. La référence pour des volutes qui se détachent et fusionnent.",
      meta: 'WebGL · vorticité'
    },
    {
      tag: 'Champ',
      title: 'Helix Noise',
      body: "Champ de vitesse à divergence nulle, avec vorticité contrôlée. Se branche directement sur un vortex de Rankine pour un rendu très fluide sans solveur complet.",
      meta: 'GLSL · divergence-free'
    },
    {
      tag: 'Particules',
      title: 'Vorton WASM',
      body: "Méthode des vortons : le champ est porté par des singularités discrètes plutôt que par une grille. Idéal pour un cœur net et un champ lointain exact.",
      meta: 'WASM · recherche'
    },
    {
      tag: 'Rendu',
      title: 'Sprites pré-rendus',
      body: "Trois familles de sprites flous dessinés hors écran, composés en additif. Aucun gradient recalculé par frame : le coût par particule est constant.",
      meta: 'Canvas 2D'
    },
    {
      tag: 'Physique',
      title: 'Lamb–Oseen',
      body: "v_θ = Γ/(2πr)·[1 − exp(−r²/4νt)]. Continue, dérivable, sans singularité : le cœur émerge naturellement et grandit par diffusion visqueuse.",
      meta: 'Analytique'
    },
    {
      tag: 'Surface',
      title: 'Caustiques cyclostrophiques',
      body: "z_s(r) = z_∞ − Γ²/(8π²g r²). Le creux n'est jamais montré en coupe : il devient un dégradé radial et des anneaux concentriques espacés en 1/r².",
      meta: 'Top-down'
    }
  ];

  /* --------------------------------------------------------------- gabarits */
  function card(p) {
    return (
      '<article class="card">' +
        '<span class="card__tag">' + p.tag + '</span>' +
        '<h3 class="card__title">' + p.title + '</h3>' +
        '<p class="card__body">' + p.body + '</p>' +
        '<p class="card__meta">' + p.meta + '</p>' +
      '</article>'
    );
  }

  /* Accueil : le vortex SEUL. Aucun texte, aucune carte, aucun appel à
     l'action — la composition est le sujet. La navigation et le panneau
     physique restent accessibles (ils sont hors du conteneur de vues).
     `bare: true` supprime en plus le voile radial et le couloir central :
     sans texte à protéger, plus rien ne doit atténuer l'image. */
  function viewHome() {
    return '<div class="view__bare" aria-hidden="true"></div>';
  }

  function viewProjects() {
    return (
      '<div class="view__band view__band--top view__band--left">' +
        '<p class="eyebrow">Projets</p>' +
        '<h1 class="display display--sm">Six pièces, un seul champ.</h1>' +
        '<p class="lede">Chaque brique est autonome. Le champ analytique peut être remplacé par un ' +
          'solveur de fluide complet sans toucher à l\'architecture de la page.</p>' +
      '</div>' +
      '<div class="view__band view__band--bottom">' +
        '<div class="grid grid--3">' + PROJECTS.map(card).join('') + '</div>' +
      '</div>'
    );
  }

  function viewContact() {
    return (
      '<div class="view__band view__band--top view__band--left">' +
        '<p class="eyebrow">Contact</p>' +
        '<h1 class="display display--sm">Parlons du champ.</h1>' +
        '<p class="lede">Décrivez le rendu visé : matière, échelle, contrainte de performance. ' +
          'Réponse sous deux jours ouvrés.</p>' +
      '</div>' +
      '<div class="view__band view__band--bottom">' +
        '<form class="card form" id="contactForm" novalidate>' +
          '<div class="field">' +
            '<label for="cName">Nom</label>' +
            '<input id="cName" name="name" type="text" autocomplete="name" required ' +
              'aria-describedby="cNameErr">' +
            '<p class="field__err" id="cNameErr" hidden>Merci d\'indiquer un nom.</p>' +
          '</div>' +
          '<div class="field">' +
            '<label for="cMail">Courriel</label>' +
            '<input id="cMail" name="email" type="email" autocomplete="email" required ' +
              'aria-describedby="cMailErr">' +
            '<p class="field__err" id="cMailErr" hidden>Adresse invalide.</p>' +
          '</div>' +
          '<div class="field field--full">' +
            '<label for="cMsg">Message</label>' +
            '<textarea id="cMsg" name="message" rows="4" required ' +
              'aria-describedby="cMsgErr"></textarea>' +
            '<p class="field__err" id="cMsgErr" hidden>Quelques mots suffisent.</p>' +
          '</div>' +
          '<div class="form__foot">' +
            '<button class="btn btn--primary" type="submit">Envoyer</button>' +
            '<p class="form__status" id="formStatus" role="status" aria-live="polite"></p>' +
          '</div>' +
        '</form>' +
      '</div>'
    );
  }

  const VIEWS = {
    '/': { title: 'Vortex', render: viewHome, nav: 'accueil', bare: true },
    '/projets': { title: 'Vortex — Projets', render: viewProjects, nav: 'projets' },
    '/contact': { title: 'Vortex — Contact', render: viewContact, nav: 'contact' }
  };

  /* Seule VIEWS est consommée (par le routeur) : PROJECTS et card restent
     internes, on ne les exporte pas. */
  global.VortexViews = { VIEWS };
})(window);

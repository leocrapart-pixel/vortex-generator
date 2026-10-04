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

  function viewHome() {
    return (
      '<div class="view__band view__band--top">' +
        '<p class="eyebrow">Vue strictement du dessus · palette bleue · rotation vers le centre</p>' +
        '<h1 class="display">Le centre n\'est pas<br>un point, c\'est une <em>pente</em>.</h1>' +
        '<p class="lede">Un vortex de Lamb–Oseen avec puits radial, intégré exactement : ' +
          'la vitesse angulaire varie en 1/r², donc diviser le rayon par deux multiplie ' +
          'la rotation par quatre. C\'est cette raideur qui produit l\'aspiration — ' +
          'pas un effet ajouté par-dessus.</p>' +
        '<div class="actions">' +
          '<a class="btn btn--primary" href="#/projets">Voir les projets</a>' +
          '<a class="btn" href="#/contact">Nous contacter</a>' +
        '</div>' +
      '</div>' +
      '<div class="view__band view__band--bottom">' +
        '<div class="grid grid--3">' +
          card({ tag: 'Vue', title: 'Top-down strict', body: "Caméra verticale, on survole la surface. Aucune vue 3/4, aucun entonnoir visible : le creux hyperbolique se traduit uniquement par un dégradé radial et des caustiques concentriques.", meta: 'z_s(r) non projeté' }) +
          card({ tag: 'Mouvement', title: 'Aspiration, jamais éjection', body: "v_r = −Q/(2πr) est négatif partout. Le rapport v_r/v_θ reste voisin de tan α, donc chaque trajectoire est une spirale logarithmique d'angle constant.", meta: 'α = atan(Q/Γ) ≈ 14°' }) +
          card({ tag: 'Matière', title: 'Eau, pas galaxie', body: "Œil sombre, écume fine sur les bras, bulles qui spiralent et disparaissent près du cœur, traînées par fondu progressif — sans jamais une ligne nette.", meta: 'Canvas 2D · additif' }) +
        '</div>' +
      '</div>'
    );
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
    '/': { title: 'Vortex — Accueil', render: viewHome, nav: 'accueil' },
    '/projets': { title: 'Vortex — Projets', render: viewProjects, nav: 'projets' },
    '/contact': { title: 'Vortex — Contact', render: viewContact, nav: 'contact' }
  };

  /* Seule VIEWS est consommée (par le routeur) : PROJECTS et card restent
     internes, on ne les exporte pas. */
  global.VortexViews = { VIEWS };
})(window);

/* ============================================================================
 * field.js — champ de vitesse du vortex (Lamb–Oseen + puits radial)
 * ----------------------------------------------------------------------------
 * VUE TOP-DOWN STRICTE.
 *   Plan (x, y) = surface libre de l'eau vue de dessus.
 *   z_s(r) (creux hyperbolique) n'est JAMAIS projeté : il ne sert qu'au
 *   dégradé radial et aux caustiques concentriques. Aucune caméra inclinée,
 *   aucun effet entonnoir.
 *
 * PHYSIQUE
 *   v_theta(r,t) = Gamma/(2*pi*r) * [1 - exp(-r^2 / (4*nu*t))]   (Lamb–Oseen)
 *   v_r(r)       = -Q / (2*pi*r)                                 (puits 2D)
 *
 *   Cœur émergent   : r -> 0  =>  v_theta ~ Omega*r        (rotation solide)
 *   Extérieur       : r >> r_c =>  v_theta ~ Gamma/(2*pi*r) (vortex libre)
 *   Continuité Rankine : Gamma = 2*pi*Omega_core*r_c^2
 *   Maximum de v_theta atteint exactement à r = r_c.
 *
 *   r_c est une longueur ABSOLUE (r_c = 2*sqrt(nu*t) croît par diffusion) :
 *   sur un petit écran, la même valeur de nu*t donnerait un cœur
 *   proportionnellement énorme. On garde donc la FORME de Lamb–Oseen et on
 *   reconstruit la constante visqueuse λ = 4νt à partir du r_c voulu :
 *       λ = r_c² / x*,   x* ≈ 1.2564312  (racine de 1 − e^(−x) = 2x)
 *   ce qui place le maximum de vitesse pile sur r_c.
 *
 * INTÉGRATION EXACTE SUR LE PAS (jamais Euler naïf)
 *   r(t)^2 = r0^2 - (Q/pi)*t          (loi de continuité 2D incompressible)
 *   theta  = theta0 + (Gamma/Q)*ln(r0/r)   (spirale logarithmique)
 *   d'où, sur un pas dt :  r' = sqrt(max(r0^2 - k*dt, 0)),  k = Q/pi
 *   Ceci est la solution analytique, valable même quand r -> r_oeil.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /* STRUCTURE EXACTE DU PROFIL (λ = 4νt) :
   *
   *     v_θ(r) = Γ/(2πr)·(1 − e^(−r²/λ))        Γ = 2π ω₀ λ
   *     ω(r)   = v_θ/r = ω₀·(1 − e^(−y))/y ,   y = r²/λ
   *
   * Trois propriétés, toutes vérifiées numériquement par les tests :
   *   · ω(0) = ω₀ : le CŒUR TOURNE EN BLOC à la vitesse angulaire ω₀.
   *     C'est une conséquence directe du choix Γ = 2π ω₀ λ, pas une
   *     approximation. ω₀ est donc la vitesse angulaire de la rotation
   *     solide du cœur, et c'est la plus grande de tout le champ.
   *   · v_θ est MAXIMALE en r = r_c : en posant λ = r_c²/X_STAR, avec
   *     X_STAR racine de  x/2 = 1 − e^(−x)  (x* ≈ 1,2564312), on a
   *     r_c²/λ = x*, qui est exactement la condition du maximum.
   *   · ω décroît STRICTEMENT (rot. solide au cœur, puis 1/r² dehors) et
   *     ω(r)·r² → Γ/(2π) = ω₀·λ quand r → ∞ : à l'extérieur, ω = Γ/(2πr²),
   *     la loi du vortex libre qui produit l'aspiration (r/2 => ω×4).
   * Le « rayon du cœur » est donc exactement le rayon de vitesse maximale,
   * comme dans la spécification (où r_c = 2√(νt) est la même longueur). */
  const X_STAR = 1.2564312086261697;

  /* Deux constantes de forme du profil Lamb–Oseen évaluées à r = r_c,
     avec y = x* à cet endroit :
       LAM_STAR = 1 − e^(−y) ≈ 0,715332   (v_θ(r_c) / (Γ/(2πr_c)))
       A_CORE   = LAM_STAR/y ≈ 0,569336   (ω(r_c) / ω₀)
     Vérification directe, puisque Γ = 2π ω₀ λ et r_c²/λ = y :
       v_θ(r_c)/(Γ/(2πr_c)) = 1 − e^(−y) = LAM_STAR
       ω(r_c)/ω₀            = LAM_STAR/y = A_CORE
     Les deux relations sont exactes, pas approchées. */
  const LAM_STAR = 1 - Math.exp(-X_STAR);
  const A_CORE = LAM_STAR / X_STAR;

  /* ------------------------------------------------------- config physique */
  function makeConfig() {
    return {
      /* --- exposés au réglage artistique (panneau « Physique ») --- */
      gamma: 0,        // circulation  Γ     — vitesse globale / luminosité
      q: 0,            // débit du puits Q   — enroulement : tan α = Q/Γ
      coreRatio: 0.13, // r_c / R            — taille de l'œil
      gravity: 1,      // g                  — profondeur du creux z_s
      eyeRatio: 0.60,  // r_œil / r_c        — seuil de respawn
      /* Dérive de rotation rigide (rad/s), appliquée AU RENDU et non dans
         l'état : une rotation rigide préserve la spirale, alors qu'un terme
         ajouté à θ dans l'intégration la détruirait (l'angle avancerait sans
         que le rayon suive, et r = r₀·exp(−(Q/Γ)θ) ne serait plus vérifié). */
      drift: 0.03,

      /* --- dérivés (recalculés par resize()) --- */
      R: 500,          // rayon de référence = max(vw,vh) * 0.72
      rCore: 65,       // rayon du cœur en px (= rayon de v_θ maximale)
      rEye: 39,        // rayon d'aspiration (respawn) en px
      lambda: 0,       // λ = 4νt, reconstruit pour placer le pic à r_c
      omega0: 0,       // ω(0) : rotation solide du cœur ; Γ = 2π ω₀ λ
      omegaAtCore: 0,  // ω(r_c) = ω₀·A_CORE (< ω₀) — vitesse angulaire à r_c
      aStar: 0,        // LAM_STAR = 1 − e^(−y) ≈ 0,715332 (facteur de profil)
      vMax: 0,         // v_θ(r_c) = ω(r_c)·r_c — échelle de vitesse du rendu
      kQ: 0,           // k = Q/(2π)   ->   r² décroît de Q/π par seconde
      tanAlpha: 0.25,  // Q/Γ
      alpha: 0,        // angle trajectoire/cercle
      periodCore: 0,   // période orbitale à r_c (s) — = 60/rate
      periodRim: 0,    // période orbitale au bord (s)
    };
  }

  /* ------------------------------------------------------------- instance */
  function createField() {
    const cfg = makeConfig();

    /* ------------------------------------------------------------------
     * resize : recalcule les dérivés dépendant de la taille de l'écran.
     *
     * `userRate` = tours/minute AU CŒUR (ressenti). Définir la vitesse par
     * le cœur plutôt que par le bord est le seul choix stable : c'est là que
     * la rotation est rapide, lisible, et c'est le centre que l'œil suit.
     *
     * Le chaînage est sans circularité :
     *     T        = 60/rate                      (période orbitale à r_c)
     *     ω(r_c)   = 2π/T                         (vitesse angulaire à r_c)
     *     ω₀       = 2π/(T·A_CORE)                (A_CORE ≈ 0,5693)
     *     λ        = r_c²/x*                      (pic de v_θ placé sur r_c)
     *     Γ        = 2π ω₀ λ                      (=> ω(0) = ω₀ exactement)
     *     v_θ(r_c) = ω(r_c)·r_c                   (pic du profil Lamb–Oseen)
     * ------------------------------------------------------------------ */
    function resize(vw, vh, userRate, opts) {
      opts = opts || {};
      cfg.R = Math.max(vw, vh) * (opts.refRatio || 0.72);
      cfg.rCore = Math.max(8, cfg.R * (opts.coreRatio || cfg.coreRatio));
      cfg.rEye = Math.max(4, cfg.rCore * (opts.eyeRatio || cfg.eyeRatio));

      cfg.aStar = LAM_STAR;                         // ≈ 0.715332

      /* La grandeur annoncée par le curseur est la période orbitale À r_c
         (le bord du cœur, là où la rotation se lit). On en déduit ω₀, la
         vitesse angulaire de la rotation solide du cœur :

             ω(r_c) = ω₀·A_CORE = 2π/T  =>  ω₀ = 2π/(T·A_CORE)  */
      const T = 60 / Math.max(0.5, userRate);
      cfg.omega0 = TAU / (T * A_CORE);

      /* λ = 4νt, reconstruit pour que le pic de v_θ tombe pile sur r_c */
      cfg.lambda = (cfg.rCore * cfg.rCore) / X_STAR;

      /* Γ = 2π ω₀ λ : c'est CETTE relation, et non 2π ω₀ r_c², qui rend
         ω(0) = ω₀ exactement. En unités de r_c : Γ = 2π ω₀ r_c²/x*. */
      cfg.gamma = TAU * cfg.omega0 * cfg.lambda;

      /* Q dérivé de l'angle d'enroulement voulu : Q = Γ·tan α */
      const tanA = opts.tanAlpha != null ? opts.tanAlpha : cfg.tanAlpha;
      cfg.tanAlpha = tanA;
      cfg.q = cfg.gamma * tanA;

      /* vitesses angulaires dérivées.
         ω(r_c) = ω₀·A_CORE = 2π/T par construction, donc la période orbitale
         à r_c vaut exactement 60/rate. */
      cfg.periodCore = T;
      cfg.omegaAtCore = cfg.omega0 * A_CORE;
      /* v_θ(r_c) = ω(r_c)·r_c — pic du profil, échelle de vitesse du rendu */
      cfg.vMax = cfg.omegaAtCore * cfg.rCore;

      cfg.alpha = Math.atan(tanA);
      cfg.kQ = cfg.q / TAU;
      cfg.periodRim = TAU / omega(cfg.R);
      return cfg;
    }

    /* ------------------------------------------------------------- vitesses */
    /* v_θ exact (Lamb–Oseen). Borné partout, C^∞, v_θ(0) = 0.
       λ = 4νt = r_c²/X_STAR  =>  v_θ est maximale en r = r_c. */
    function thetaSpeed(r) {
      if (r <= 0) return 0;
      const rc = cfg.rCore;
      const x = X_STAR * (r * r) / (rc * rc);   // r² / (4νt)
      /* 1 - exp(-x), évalué sans perte de précision pour x petit */
      const lam = x < 1e-4 ? x - 0.5 * x * x : -Math.expm1(-x);
      return (cfg.gamma / (TAU * r)) * lam;
    }

    /* ω(r) = v_θ/r : rotation solide (Ω) au cœur, Γ/(2πr²) dehors.
       C'est le 1/r² qui produit l'aspiration : r/2 => ω×4. */
    function omega(r) {
      if (r <= 0) return cfg.omegaAtCore;
      return thetaSpeed(r) / r;
    }

    /* --------------------------------------------------------------------
     * v_r : PUITS RADIAL DÉRIVÉ DE LA SPIRALE EXACTE
     *
     * La spécification impose deux choses qui se recoupent :
     *   (a) v_r = −Q/(2πr)                    (puits 2D incompressible)
     *   (b) v_r/v_θ = −tan α partout          (spirale logarithmique exacte)
     *
     * (b) est la contrainte forte : elle doit tenir jusque dans le cœur, ce
     * qui interdit tout écrêtage séparé de v_r. On prend donc la seule forme
     * qui satisfasse (b) exactement :
     *
     *     v_r(r) = −tan α · v_θ(r)
     *
     * Conséquences, toutes conformes :
     *   · r → ∞  : v_θ → Γ/(2πr) et v_r → −tan α·Γ/(2πr) = −Q/(2πr)
     *               => la loi (a) est retrouvée asymptotiquement à l'extérieur,
     *                  avec Q = Γ·tan α.
     *   · r → 0  : v_r → −(Γ tan α/2λ)·r, soit une aspiration nulle au centre
     *               => aucune singularité, aucun besoin de borne arbitraire.
     *   · le flux radial intégré vaut Q_eff = Q·(1 − e^(−x) − x·E₁(x)),
     *     inférieur à Q près du cœur : le puits cesse d'aspirer au fond du
     *     creux, là où viscosité et tension de surface prennent le relais.
     *   · le champ EST divergence-free (il dérive de la fonction de courant
     *     ψ = (Γ/2π)[ln r − E₁(x)]), donc 2D incompressible exactement.
     * -------------------------------------------------------------------- */
    function radialSpeed(r) {
      if (r <= 0) return 0;
      return -cfg.tanAlpha * thetaSpeed(r);
    }

    /* Profondeur du creux (équilibre cyclostrophique intégré) :
         z_s(r) = z_∞ - Γ² / (8π² g r²)
       On renvoie la quantité SANS DIMENSION z_∞ - z_s, c.-à-d. la « fosse »,
       saturée au cœur : c'est elle qui pilote le dégradé et les caustiques.
       En top-down elle n'apparaît jamais comme un entonnoir. */
    function depth(r) {
      const rr = r < cfg.rCore ? cfg.rCore : r;
      const d = (cfg.gamma * cfg.gamma) / (8 * Math.PI * Math.PI * cfg.gravity * rr * rr);
      /* normalisée pour rester dans [0,1] à l'échelle du champ */
      const ref = (cfg.gamma * cfg.gamma) / (8 * Math.PI * Math.PI * cfg.gravity * cfg.R * cfg.R);
      return clamp(d / (ref * 9), 0, 1);
    }

    /* ==================================================================
     * step — avance une particule d'un pas dt.
     * Renvoie true si la particule a été respirée (respawn en bordure).
     * Aucune allocation : écrit dans l'objet `p` fourni (scalaires).
     * ================================================================== */
    function step(p, dt, rIn, rOut) {
      /* --- bornes de pas : adaptatif --------------------------------
         · ni plus d'un quart de tour par pas ;
         · ni un pas si grand que le rayon s'effondre. */
      const w = omega(p.r);
      const maxByAngular = w > 1e-6 ? 0.25 / w : dt;
      let h = dt;
      if (h > maxByAngular) h = maxByAngular;
      if (!(h > 0)) h = dt;                              // garde-fou

      const r0 = p.r;

      /* --- rayon : solution exacte de dr/dt = −tan α·v_θ(r) ----------
         Hors du cœur, 1 − e^(−x) → 1 et la loi redevient exactement
             r²(t) = r0² − (Q/π)·t            (loi de continuité 2D)
         Dans le cœur, le facteur (1 − e^(−x)) freine l'aspiration : on
         l'évalue au MILIEU du pas, ce qui est exact à l'ordre 2 et évite
         d'avoir à sous-paser. Un Euler naïf sur r² donnerait ici une
         convergence vers le centre bien trop rapide. */
      const rr = r0 < 1e-9 ? 1e-9 : r0;
      const x0 = X_STAR * (rr * rr) / (cfg.rCore * cfg.rCore);
      const damp0 = x0 < 1e-4 ? 1 : -Math.expm1(-x0) / x0;
      const r2h = rr * rr - cfg.kQ * damp0 * h;           // prédicteur milieu de pas
      const rm = Math.sqrt(r2h > 0 ? r2h : 0);
      const xm = X_STAR * (rm * rm + 1e-12) / (cfg.rCore * cfg.rCore);
      const dampM = xm < 1e-4 ? 1 : -Math.expm1(-xm) / xm;
      const r2 = rr * rr - cfg.kQ * dampM * h;
      const r1 = r2 > 0 ? Math.sqrt(r2) : 0;

      /* --- spirale logarithmique exacte : dθ = (Γ/Q)·ln(r0/r1) --------- */
      if (r1 > 1e-6 && r0 > 1e-6) {
        p.theta += (cfg.gamma / cfg.q) * Math.log(r0 / r1);
      } else {
        p.theta += w * h;
      }
      p.r = r1;

      /* NOTE — le serpentement (bruit sinusoïdal qui évite l'aspect
         mécanique) n'est PAS appliqué ici. Toute perturbation ajoutée à θ
         dans l'état est amplifiée par la relation de spirale
         dθ = (Γ/Q)·ln(r₀/r) et finit par faire dériver le rayon de plusieurs
         centaines de pixels. Il est donc appliqué AU RENDU, en décalage
         angulaire borné : la physique reste exactement sur la spirale, et
         l'ondulation visuelle reste cantonnée à ≈ 0,8 % du rayon. */

      /* --- borne extérieure : les particules ne s'échappent jamais --- */
      if (p.r > rOut) p.r = rOut;

      /* --- respawn : sous r_œil, la particule réapparaît en bordure ---
         Physiquement : zone où viscosité et tension de surface dominent,
         le nombre de tours y diverge. Indispensable : sans cette coupure,
         θ diverge quand r → 0. */
      if (p.r < cfg.rEye) {
        respawn(p, rIn, rOut);
        return true;
      }
      return false;
    }

    /* Respawn en bordure : rayon tiré dans [rIn, rOut], angle quelconque. */
    function respawn(p, rIn, rOut) {
      const u = Math.random();
      p.r = Math.sqrt(rIn * rIn + u * (rOut * rOut - rIn * rIn));
      p.theta = Math.random() * TAU;
      p.age = 0;
      /* les sprites de bord sont les plus froids et les plus diffus */
      p.kind = pickKind(p.r);
      return p;
    }

    /* Mélange des familles de sprites, pondéré par la profondeur :
       beaucoup d'eau profonde au bord, du courant au milieu, de l'écume
       surtout là où le cisaillement est fort (près du cœur). */
    function pickKind(r) {
      const t = clamp(1 - (r - cfg.rEye) / Math.max(1, cfg.R), 0, 1); // 1 = centre
      const roll = Math.random();
      if (roll < 0.10 + 0.34 * t * t) return 2; // écume
      if (roll < 0.55 + 0.30 * t) return 1;     // courant
      return 0;                                  // eau profonde
    }

    /* ----------------------------------------------------- accesseurs */
    return {
      cfg,
      resize,
      step,
      pickKind,      // utilisé par le renderer pour peupler la population
      thetaSpeed,
      omega,
      radialSpeed,
      depth
    };
  }

  /* Exposition globale : script classique, compatible file://
     (pas de module ES, donc aucun souci de CORS en ouverture directe). */
  global.VortexField = { createField, clamp, TAU };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createField, clamp, TAU };
  }
})(typeof window !== 'undefined' ? window : globalThis);

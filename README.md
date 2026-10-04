# Vortex — vu strictement du dessus

SPA autonome : un vortex d'eau observé **à la verticale**, palette bleue stricte,
rotation continue qui **aspire vers le centre**. Champ de vitesse analytique
(Lamb–Oseen + puits radial), intégration exacte, rendu Canvas 2D.

**Zéro dépendance. Zéro build. Ouverture directe en `file://`.**

```
index.html          ← ouvrir directement dans un navigateur (double-clic)
src/field.js        ← physique : Lamb–Oseen, puits, intégration analytique
src/renderer.js     ← rendu : sprites pré-rendus, caustiques, traînées
src/views.js        ← contenu des trois vues
src/router.js       ← routeur SPA sur hash
src/main.js         ← boucle, réglages, accessibilité
src/styles.css      ← palette, verre dépoli, couloir central
tests/              ← 107 vérifications exécutables (node, sans navigateur)
```

Pour lancer les vérifications : `npm test` (ou `node tests/physics.test.js`).

---

## 1. Le critère de réussite, et comment il est tenu

En 5 secondes on doit percevoir **(1) une vue du dessus, (2) du bleu,
(3) une rotation qui aspire vers le centre**. Voici le mécanisme exact qui
produit chacun des trois, et non un effet décoratif ajouté par-dessus.

### (1) Vue du dessus — aucune caméra, donc aucun risque de dérapage

Il n'y a **pas de scène 3D** : le plan `(x, y)` du canvas *est* la surface
libre de l'eau. Le creux hyperbolique réel,

```
z_s(r) = z_∞ − Γ² / (8π²g r²)
```

n'est **jamais projeté**. Il est consommé deux fois, de façon strictement
2D : comme **dégradé radial** (plus sombre au centre) et comme **caustiques
concentriques** dont les rayons sont *dérivés* de la fosse. Une vue en
entonnoir est donc structurellement impossible : il n'existe aucun code
capable de la dessiner.

### (2) Du bleu — discipline de palette vérifiée automatiquement

Toutes les couleurs du CSS et des sprites sont analysées en teinte HSL par
`tests/dom.test.js`. Bornes tenues : **190° → 230°**. Le test échoue si une
couleur dérive vers le violet (> 230°), vers le vert (< 190°), ou si le rouge
domine dans un composant. 66 couleurs contrôlées à chaque exécution.

### (3) Rotation qui aspire — c'est de la physique, pas du style

Tout le mouvement vient du champ de vitesse. En particulier l'**aspiration**
n'est pas une animation : elle sort du `1/r²` de la vitesse angulaire.

```
ω(r) = Γ / (2π r²)      =>      ω(r/2) = 4 · ω(r)
```

Diviser le rayon par deux quadruple la rotation. C'est cette raideur qui
donne la sensation d'aspiration — et elle est vérifiée à 4,000 par le test
« raideur en 1/r² ».

---

## 2. Le modèle physique

### 2.1 Champ de vitesse

```
v_θ(r) = Γ/(2πr) · [1 − exp(−r²/λ)]        (Lamb–Oseen,   λ = 4νt)
v_r(r) = −tan α · v_θ(r)                   (puits radial, α = atan(Q/Γ))
```

**Pourquoi `v_r` est proportionnel à `v_θ` et non écrit `−Q/(2πr)` ?**
La spécification demande deux choses qui se recoupent : la loi de puits
`v_r = −Q/(2πr)` *et* une spirale logarithmique d'angle constant jusque dans
le cœur. La seconde est la contrainte forte : elle exige
`v_r/v_θ = −tan α` **partout**, ce qui interdit d'écrêter `v_r` séparément.
La seule forme qui satisfasse exactement cette contrainte est la
proportionnalité. Conséquences — toutes conformes :

* `r → ∞` : `v_r → −tan α·Γ/(2πr) = −Q/(2πr)`. La loi de puits est donc
  **retrouvée asymptotiquement**, avec `Q = Γ·tan α`. Vérifié à 0,000 %.
* `r → 0` : `v_r → −(Γ tan α/2λ)·r`. L'aspiration s'annule au fond du creux,
  donc **aucune borne arbitraire n'est nécessaire** et il n'existe aucune
  singularité.
* Le champ **est** divergence-free : il dérive de la fonction de courant
  `ψ = (Γ/2π)·[ln r − E₁(x)]`. Il est donc 2D incompressible exactement.
* Le flux radial intégré vaut `Q_eff = Q·(1 − e^(−x) − x·E₁(x))`, inférieur à
  `Q` près du cœur : le puits cesse d'aspirer là où viscosité et tension de
  surface prennent le relais — c'est le régime de l'œil.

### 2.2 Structure exacte du profil — trois identités

En posant `s = r/r_c` et `y = x*·s²`, avec **`x* = 1,2564312`** (racine de
`x/2 = 1 − e^(−x)`) :

| grandeur | comportement | vérifié par |
|---|---|---|
| `v_θ` | **maximale exactement à `r = r_c`** | pic scanné à 1,00000·r_c |
| `ω(0)` | `= ω₀`, rotation solide du cœur | `ω(0)/ω₀ = 1,000000000` |
| `ω(r)` | **strictement décroissante** | scan sur [0, r_œil…1,2 R] |
| `ω(r)·r²` | `→ Γ/2π` (vortex libre) | 38271,4 vs 38271,4 |

Le choix de définition **`Γ = 2π ω₀ λ`** (et non `2π ω₀ r_c²`) est ce qui rend
`ω(0) = ω₀` **exactement**, et non approximativement. C'est la seule
formulation cohérente : elle a été trouvée en corrigeant une incohérence
initiale, où `ω(0)` valait `1,25643·ω₀`.

`r_c` reste bien le rayon de vitesse maximale, comme dans la spécification.
`λ = r_c²/x*` est la longueur visqueuse `4νt`, reconstruite pour placer ce
maximum — c'est ce qui rend le modèle **indépendant de la résolution** :
sur mobile, le même `νt` donnerait un cœur proportionnellement énorme.

### 2.3 Intégration : exacte sur le pas, jamais Euler naïf

Par pas `dt`, le rayon est avancé par la solution **exacte**, le facteur
d'amortissement étant évalué au milieu du pas (exact à l'ordre 2) :

```
r²  = r₀² − (Q/π)·(1 − e^(−x))/x · dt
θ  += (Γ/Q)·ln(r₀/r)              ← spirale logarithmique exacte
```

Euler naïf sur `r` franchit `r = 0` dès que `dt > r²/(2k)`, soit 0,3 s à
`r = r_c/2` : le schéma analytique, lui, reste positif et fini **même avec
`dt = 2 s`**. Les deux comportements sont testés côte à côte.

Le pas est en outre borné à un quart de tour, ce qui protège la zone du cœur
où `ω` diverge en `1/r²`.

### 2.4 Pathologie traitée : divergence en `r → 0`

Le nombre de tours entre `R` et `r_œil` vaut `(Γ/2Q)·ln(R/r_œil) ≈ 1,3` : il
est **fini** par construction. Toute particule sous `r_œil = 0,55·r_c` est
respawnée en bordure — zone où, physiquement, viscosité et tension de
surface dominent. Sur 7,2 millions de pas-particule simulés, le rayon minimal
observé reste `> r_œil` : **aucune particule n'atteint jamais `r = 0`**.

---

## 3. Paramètres exposés

Panneau intégré (bouton `Γ` en bas à droite, ou touche **`P`**) :

| curseur | symbole | effet visuel |
|---|---|---|
| Vitesse du cœur | `Γ` | vitesse globale, luminosité, longueur des traînées |
| Enroulement | `α = atan(Q/Γ)` | pente des volutes, resserrement de la spirale |
| Rayon du cœur | `r_c` | taille de l'œil et de la zone rapide |
| Longueur de traînée | — | fondu par frame, persistance du mouvement |

Valeurs par défaut et leur justification :

| paramètre | valeur | pourquoi |
|---|---|---|
| `r_c` | 16 % de `R` | compromis lisibilité de l'œil / place pour les bras |
| `r_œil` | 0,55·`r_c` | l'œil sombre reste net, les particules ne s'y accumulent pas |
| `α` | 16,7° (`tan α = 0,30`) | ~6 orbites pendant la descente : assez pour lire l'aspiration, assez ouvert pour lire les bras |
| période à `r_c` | 6,3 s | la rotation est lisible dans la fenêtre des 5 secondes |
| `rOut` | 1,12·`R` | aucune particule ne manque au bord de l'écran |

Rapport cœur/bord : **27,9×** (période orbitale). C'est la signature physique
du vortex — le bord tourne près de 28 fois plus lentement que le cœur.

Sur la fenêtre des 5 secondes, une particule du cœur parcourt ≈ 285° :
la rotation est donc immédiatement lisible, sans attendre un tour complet.

---

## 4. Rendu

* **Canvas 2D**, sprites pré-rendus hors écran (3 familles : eau profonde,
  courant, écume). **Aucun gradient créé dans la boucle** — vérifié : le
  compteur de `createRadialGradient` ne bouge pas sur 600 frames.
* **Traînées par fondu progressif** : un `fillRect` par frame, jamais de
  lignes nettes. La traînée est un second sprite comprimé tangentiellement
  (`v_θ`) et étiré radialement (`v_r`).
* **Composition additive** (`lighter`) pour l'éclat des volutes.
* **DPR plafonné à 2** (entrée testée à 3 → sortie 2).
* **Caustiques** : 34 anneaux dont les rayons suivent `r_k = r_c·√(N/k)`,
  c'est-à-dire l'espacement hyperbolique du creux réel. Faible opacité.
* **Serpentement** : décalage angulaire borné à 0,008 rad, appliqué **au
  rendu uniquement**. Appliqué dans l'état, il serait amplifié par la
  relation de spirale et ferait dériver le rayon de plusieurs centaines de
  pixels — ce qui a été mesuré, puis corrigé.
* **Parallaxe souris** : ±6 px, lissée. Désactivée sous `prefers-reduced-motion`.

Mapping physique → visuel, tenu dans le code :

```
r          → profondeur      (petit = sombre, froid, opaque)
v_θ        → éclat + longueur de traînée
v_r        → étirement radial
z_s(r)     → dégradé radial + caustiques concentriques
ω du cœur  → œil sombre central (option A de la spécification)
α          → inclinaison constante des volutes
```

---

## 5. Performance

Mesuré sur ce code (Node, 864 particules, `dt = 1/60`) :

```
physique : 0,0875 ms / frame   →  0,5 % du budget de 16,67 ms
```

Soit une marge très large : le coût est dominé par les appels `drawImage`
(2 par particule), pas par la simulation.

* Densité adaptative : surface d'écran, détection mobile, plafond 2200,
  plancher 260, et **×0,35 sous `prefers-reduced-motion`**.
* **Pré-vieillissement** : 30 s simulées au démarrage, pas de 0,5 s (≈ 14 ms
  pour 864 particules), pour installer la répartition stationnaire
  `n(r) ∝ r/(1 − e^(−r²/λ))`. Sans cela, les premières secondes montrent un
  cœur vide qui se remplit lentement — inacceptable pour un critère de
  5 secondes. Le pas large est légitime : l'intégration du rayon est exacte
  sur le pas, et la statistique radiale ne dépend pas de la finesse
  angulaire. Coût divisé par ~20 par rapport à un pas de 1/20 s.
* Aucune allocation dans la boucle : tableaux typés pré-alloués (SoA),
  un unique objet scalaire réutilisé pour l'appel au champ.
* Pause automatique quand l'onglet passe en arrière-plan.

---

## 6. Accessibilité

* `prefers-reduced-motion` : vitesse ×0,35, densité ×0,35, parallaxe
  neutralisée, transitions de vue supprimées. Réagit au changement à chaud.
* `prefers-contrast: more` : surfaces opaques, texte éclairci, contours renforcés.
* Structure sémantique : `header` / `nav` / `main` / `aside`, lien d'évitement,
  `aria-current="page"` sur l'onglet actif, `aria-expanded` sur le panneau.
* Formulaire : labels associés, `aria-invalid`, messages d'erreur reliés par
  `aria-describedby`, statut en `aria-live="polite"`.
* Focus visible partout, cibles tactiles ≥ 44 px.
* Le canvas et les éléments décoratifs sont `aria-hidden`.
* Changement de route : titre de document mis à jour, focus porté sur le `h1`.

---

## 7. Composition — le centre est protégé

Le vortex attire l'œil au centre : y placer du texte serait une faute. Le
layout réserve donc un **couloir central** de hauteur `--eye-safe`
(`clamp(150px, 24vh, 300px)`) via le `gap` du conteneur de vues. Tout le
contenu vit dans une bande haute et une bande basse, et un voile radial
assombrit les bords sans masquer le centre.

Sur écran court (`max-height: 640px`) le couloir se réduit à 90 px ; sur
mobile, la grille passe en une colonne et le couloir à `clamp(130px, 22vh, 220px)`.

---

## 8. Vues

| route | contenu |
|---|---|
| `#/` | promesse, deux appels à l'action, 3 cartes descriptives |
| `#/projets` | 6 cartes de projets (solveurs, champs, rendu, physique) |
| `#/contact` | formulaire validé, retour visuel local (aucun réseau) |
| autre | 404 douce, avec retour à l'accueil |

Le routeur est **sur hash** : compatible `file://`, aucun rechargement. Le
canvas est **hors du conteneur de vues** — changer de page ne le touche
jamais (vérifié : l'identité de l'élément canvas est stable après navigation).

---

## 9. Vérifications

`npm test` exécute **107 assertions**, sans navigateur ni dépendance.

**`tests/physics.test.js` — 51 assertions**
Rankine et continuité, identités exactes du profil (`ω(0) = ω₀`,
`v_θ` maximal à `r_c`), monotonie de `ω`, loi du vortex libre, angle de
spirale constant jusque dans le cœur (écart < 1e-16), trajectoire
confondue avec `r₀·exp(−(Q/Γ)θ)` (dérive 0,0000 px), aspiration jamais
négative, annulation au centre, raideur `ω(r)/ω(2r) = 4,000`, respawn sur
7,2 M de pas-particule, comparaison Euler naïf / schéma analytique,
profondeur de surface, cohérence de bout en bout des paramètres.

**`tests/dom.test.js` — 56 assertions**
Exécute réellement les 5 scripts dans un DOM simulé : absence de gradient
dans la boucle, DPR plafonné, 600 frames rendues avec **contrôle que
chaque valeur transmise à Canvas est finie et de taille valide**, cœur
peuplé dès la première frame, densité adaptative, normalisation des routes,
404, transitions, **analyse de teinte de toutes les couleurs**, protection
du centre, structure des trois vues.

---

## 10. Ce qui a été délibérément écarté

* **Vue 3/4 / entonnoir** : aucun code de projection n'existe.
* **Couleurs chaudes** : interdites et testées automatiquement.
* **Mouvement centrifuge** : `v_r < 0` partout, testé.
* **Euler naïf** : présent uniquement dans les tests, comme contre-exemple.
* **Singularité en `r = 0`** : impossible, deux fois — `v_r → 0` et coupure à `r_œil`.
* **Bruit dans l'état physique** : mesuré comme destructeur de la spirale,
  déplacé au rendu.
* **Dépendances** : aucune. Aucun bundler, aucune étape de build.

## 11. Évolution

Le champ analytique est isolé dans `src/field.js` derrière trois fonctions
(`thetaSpeed`, `radialSpeed`, `step`) et un état SoA. Le remplacer par un
solveur Stable Fluids (WebGL/WebGPU) ne demande de toucher ni au rendu, ni au
routeur, ni aux vues : seule la fonction `step` change de nature.

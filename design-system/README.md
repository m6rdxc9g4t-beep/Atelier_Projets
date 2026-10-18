# @atelier/design-system — Pilier 1

Variables CSS officielles et composants UI purs d'Atelier_Projets. CSS natif, aucune logique métier, aucune dépendance.

```text
design-system/
├── index.css                 # Point d'entrée : tokens + jetons dérivés + thèmes
├── tokens/colors.css         # 7 types (--type-*) + 8 statuts (--status-*) — codes hex officiels
├── tokens/ui.css             # Jetons dérivés (accent, surfaces, dégradés, rayons, polices) — sans nouveau code hex
├── themes/light.css          # Thème clair : 6 variables de fondation
├── themes/dark.css           # Thème sombre : 6 variables de fondation
├── components/index.css      # Point d'entrée des composants
├── components/semantic.css   # data-type / data-status / data-priority / data-balance → --kind-color, --kind-ink, --kind-soft
├── components/components.css # .ds-card, .ds-btn, .ds-badge, .ds-type-chip, .ds-diamond, .ds-progress, .ds-bar,
│                             # .ds-tabs, .ds-input / .ds-select / .ds-textarea, .ds-table, .ds-markdown
└── scripts/check-tokens.mjs
```

## Utilisation

```css
@import "@atelier/design-system";             /* tokens + thèmes */
@import "@atelier/design-system/components";  /* composants (facultatif) */
```

```html
<html data-theme="dark">   <!-- sans attribut : thème clair -->

<span class="ds-badge" data-status="IN_PROGRESS">En cours</span>
<span class="ds-type-chip" data-type="BUG"></span>
<div class="ds-progress" data-tone="budget"><div class="ds-progress__bar" style="inline-size: 63%"></div></div>
<span class="ds-bar" data-type="FEATURE"><span class="ds-bar__fill" style="width: 80%"></span></span>
<button class="ds-btn" data-variant="primary">Saisir temps</button>
```

Un élément qui porte `data-type`, `data-status`, `data-priority` ou `data-balance` reçoit :

| Variable | Rôle |
| :--- | :--- |
| `--kind-color` | Couleur officielle (type, statut…) |
| `--kind-ink` | Même teinte rapprochée de la couleur du texte : lisible en clair comme en sombre (`.ds-ink`) |
| `--kind-soft` | Fond teinté léger (badges) |

Les composants sont déclarés dans la couche `@layer components` : les utilitaires d'un framework (Tailwind…) ou les styles de la page peuvent les surcharger.

## Règles

- Les codes hex sont ceux de la spécification (`README.md` §2, `CLAUDE.md` §2) — ne pas les modifier.
- `themes/*.css` restent en CSS natif pur, sans `@import`, `url()`, `var()` ni variable métier : on peut les copier tels quels dans une autre application.
- `tokens/ui.css` et `components/*.css` n'introduisent aucune couleur littérale : tout dérive des variables officielles (`var()`, `color-mix()`).
- Le frontend n'utilise jamais de couleur en dur : uniquement ces variables.

## Contrôle

```bash
npm run check -w @atelier/design-system
```

Le script échoue si une variable manque, si un code hex diffère de la spécification, si un thème introduit une dépendance, ou si un jeton dérivé ou un composant contient une couleur littérale.

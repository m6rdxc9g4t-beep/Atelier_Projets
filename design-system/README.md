# @atelier/design-system — Pilier 1

Variables CSS officielles d'Atelier_Projets. Aucune logique métier, aucune dépendance.

```text
design-system/
├── index.css            # Point d'entrée : tokens + thèmes
├── tokens/colors.css    # 7 types (--type-*) + 8 statuts (--status-*)
├── themes/light.css     # Thème clair : 6 variables de fondation
├── themes/dark.css      # Thème sombre : 6 variables de fondation
└── scripts/check-tokens.mjs
```

## Utilisation

```css
@import "@atelier/design-system";               /* tout */
@import "@atelier/design-system/themes/dark.css"; /* ou un fichier précis */
```

```html
<html data-theme="dark">   <!-- sans attribut : thème clair -->
```

```css
.badge-bug { background: var(--type-bug); color: var(--bg-surface); }
.card      { background: var(--bg-surface); border: 1px solid var(--border-color); }
```

## Règles

- Les codes hex sont ceux de la spécification (`README.md` §2, `CLAUDE.md` §2) — ne pas les modifier.
- `themes/*.css` restent en CSS natif pur, sans `@import`, `url()`, `var()` ni variable métier : on peut les copier tels quels dans une autre application.
- Le frontend n'utilise jamais de couleur en dur : uniquement ces variables.

## Contrôle

```bash
npm run check -w @atelier/design-system
```

Le script échoue si une variable manque, si un code hex diffère de la spécification ou si un thème introduit une dépendance.

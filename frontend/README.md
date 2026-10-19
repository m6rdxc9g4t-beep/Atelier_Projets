# @atelier/frontend — Pilier 2

Interface web d'Atelier Projets : **React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + Zustand 5 + Lucide**.

```bash
npm run dev            # depuis la racine : API (3000) + interface (5174)
npm run dev:frontend   # interface seule ; /api est relayé vers http://127.0.0.1:3000 (ou ATELIER_API_URL)
npm run preview -w @atelier/frontend   # aperçu du build sur http://127.0.0.1:4174
```

```text
frontend/
├── index.html                 # Thème appliqué avant le premier rendu
├── vite.config.ts             # React, Tailwind, proxy /api, ports 5174 / 4174 (strictPort, Suite Atelier)
├── scripts/
│   ├── generate-api-types.mjs # backend/openapi.json → src/services/api.gen.ts (npm run api:types)
│   └── check-frontend.mjs     # aucune couleur en dur, types de l'API à jour (npm run check)
└── src/
    ├── index.css              # Tailwind relié aux variables du design system (palette Tailwind retirée)
    ├── App.tsx                # Choix du projet, cadre, vue courante, fiche élément, dialogues
    ├── views/                 # DashboardView (A), GanttView (B), TaskSlideOver (C), TimeSheetView (D), SettingsView
    ├── components/            # shell (en-tête, rail, onglets, notifications), SuiteSwitcher, HealthCard, Dialogs, AiDialogs, ImportTabDialog, ui
    ├── store/app.ts           # Zustand : thème, projet, vue, élément ouvert, dialogue, notifications
    ├── services/              # client.ts (openapi-fetch, erreurs), api.ts (une fonction par route), types.ts
    └── lib/                   # mise en forme, libellés FR, useApi / useAction, theme.ts, suite.ts (adresses de la Suite Atelier)
```

## Règles (CLAUDE.md §1)

- **Couleurs** : uniquement les variables du design system. Les utilitaires Tailwind disponibles sont `bg-surface`, `bg-elevated`, `text-fg`, `text-muted`, `border-line`, `text-accent-ink`, `bg-phase`, `bg-st-closed`… ; pour une teinte qui dépend d'une valeur, poser `data-type` / `data-status` / `data-priority` / `data-balance` et utiliser `bg-kind`, `text-kind-ink` ou les classes `ds-*`.
- **Aucun calcul métier** : jours, pourcentages, bilans, statuts des conteneurs et histogramme viennent de l'API.
- **Contrat** : après une modification de l'API, `npm run openapi` (racine) régénère `backend/openapi.json` puis `src/services/api.gen.ts` ; `tsc` signale alors tout écart dans le frontend.

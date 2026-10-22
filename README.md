# 🚀 Atelier Projets — Gestionnaire de Projets Agile, Git & IA Locale

> **Philosophie :** L'alliance de la rigueur d'**OpenProject** (Gantt, Budgets, Hiérarchie stricte, Phases & Milestones) et de l'esthétique moderne, colorée et fluide de **Linear / GitHub**, propulsée en local avec intégration native Git/GitHub et moteurs IA locaux (Ollama : Qwen, Gemma) + Claude CLI.

Ce fichier est la **spécification fonctionnelle et visuelle** de référence. Les règles d'architecture et les conventions de code sont dans [`CLAUDE.md`](./CLAUDE.md).

**Atelier Projets** fait partie de la **Suite Atelier** avec Atelier Viz (BI) et Atelier Tab (tableur) : son design system est la référence de la suite (voir [§8](#-8-suite-atelier) et [`docs/SUITE.md`](./docs/SUITE.md)). Le dépôt garde son nom technique `Atelier_Projets`.

---

## 🚦 État d'avancement

| Étape | Contenu | État |
| :--- | :--- | :--- |
| **Phase 1 — Socle** | Monorepo (npm workspaces), design system (tokens officiels + thèmes clair/sombre), backend Fastify + TypeScript + Prisma/SQLite, migration initiale, seed de démo « App E-Commerce v2 » | ✅ Validée |
| **Phase 2 — API REST métier** | CRUD de la hiérarchie, temps et jalons, journal d'avancement horodaté, vues calculées (dashboard, arborescence/Gantt, tableau des temps, fiche tâche), OpenAPI, tests | ✅ Validée |
| **Phase 3 — `git-engine`** | Analyse du dépôt local (`simple-git`, regex `#ID`), hook `post-commit`, synchronisation des Pull Requests GitHub (`@octokit/rest`), modèle `PullRequest` | ✅ Validée |
| **Phase 4 — Frontend** | Client React (Vite, Tailwind CSS, Zustand, Lucide) : tableau de bord, Gantt, tableau des temps, fiche tâche, paramètres et dépôts ; composants UI purs du design system ; types de l'API générés depuis le contrat OpenAPI | ✅ Validée |
| **Phase 5 — `ai-bridge`** | IA locale Ollama (Qwen, Gemma) : découpage d'une Story en Features / Tasks estimées, résumé des commits pour le journal d'avancement ; sessions Claude CLI dans le dépôt du projet ; API réservée aux requêtes locales | ✅ Terminée — en attente de validation |
| **IA : choix du moteur** | Mode hors ligne / en ligne (backend), « Moteur : Auto · Ollama · Claude », Claude par la CLI isolée (`claude -p`), pastilles d'état dans l'en-tête (`docs/SUITE.md` §5) | ✅ Terminée — en attente de validation |
| **Phase 6 — Planification & suivi** | Gantt interactif (glisser-déposer des barres, bords et jalons, dépendances « fin → début », conflits et replanification, chemin critique), impression PDF du Gantt, export CSV des temps, chronomètre, sauvegardes automatiques de la base, tests de navigateur (Playwright) | ✅ Terminée — en attente de validation |
| **Suite Atelier** | Ports 5174 / 4174, thème Clair / Sombre / Système, sélecteur d'applications, import DataFlow depuis Atelier Tab, jeux de données pour Atelier Viz (`docs/SUITE.md`) | ✅ Terminée — en attente de validation |
| **Nœud Atelier** | Manifeste `atelier-node/1`, actions en snake_case, tables `atelier-table/1`, journal d'événements, idempotence générale des écritures (`docs/SUITE.md` §7, pour Atelier Nexus) | ✅ Terminée — en attente de validation |

## ⚡ Démarrage rapide

**Prérequis :** Node.js `22.12+` ou `24+` (LTS conseillée : 24, voir `.nvmrc`), npm 11 conseillé (le `package-lock.json` est écrit avec npm 11), Git.

```bash
npm install            # installe les 3 workspaces
npm run setup          # génère le client Prisma, crée la base SQLite (migrations) et insère la démo
npm run dev            # API (port 3000) + interface (port 5174)
```

Puis ouvrir **http://127.0.0.1:5174** (interface) — documentation de l'API : http://127.0.0.1:3000/api/docs.
`npm run app` compile l'interface et la sert en aperçu sur **http://127.0.0.1:4174** : c'est l'adresse qu'ouvrent les sélecteurs d'Atelier Viz et d'Atelier Tab. Les ports sont fixes (`strictPort`) : s'ils sont pris, Vite s'arrête avec une erreur au lieu de changer de port.

**Application de bureau (macOS) :** `npm run app:install` crée `~/Applications/Atelier Projets.app` (Electron), à glisser dans le Dock. C'est une vraie application : sa propre fenêtre, son icône et son menu, sans navigateur.
- Au lancement, elle démarre l'API et l'interface compilée (sur `http://127.0.0.1:4174`, l'adresse « app » de la Suite Atelier). Cmd+Q ou la fermeture de la fenêtre arrête tout.
- Après un `git pull`, le lancement suivant réinstalle les dépendances si besoin, applique les migrations et recompile (une minute environ, écran « Compilation… ») ; sinon elle s'ouvre en 2 à 3 secondes.
- Si l'API tourne déjà dans un terminal (`npm run dev`), la fenêtre l'utilise sans la relancer.
- Liens externes (GitHub, documentation) : navigateur par défaut. Impression PDF du Gantt et téléchargements (CSV, sauvegardes) : boîtes de dialogue de macOS.
- Journal : `~/Library/Logs/Atelier_Projets/app.log` (menu Aide → Journal de l'application). À relancer après un déplacement du dépôt ou un changement d'installation de Node.
- L'ancien lanceur qui ouvrait le navigateur reste disponible : `npm run app:install:browser`.

**IA (facultatif) :** installer [Ollama](https://ollama.com), puis `ollama pull qwen2.5-coder` (ou `gemma3`) ; le bouton `🤖 IA` de l'en-tête affiche l'état des moteurs et permet de choisir les modèles. **Claude (facultatif) :** installer Claude Code puis `claude auth login` ; passer l'en-tête sur « En ligne » pour que Claude puisse répondre (moteur « Auto » ou « Claude »). Le bouton « Claude CLI » de la fiche d'un élément ouvre en plus une session interactive dans le dépôt du projet.

| Commande (racine) | Effet |
| :--- | :--- |
| `npm run setup` | `prisma generate` → `prisma migrate deploy` → seed de démo |
| `npm run dev` | API et interface ensemble (Ctrl+C arrête les deux) |
| `npm run dev:backend` | Serveur Fastify seul, en mode watch (`tsx`) |
| `npm run dev:frontend` | Interface seule (Vite, http://127.0.0.1:5174) ; `/api` est relayé vers le backend |
| `npm run app` | Compile l'interface puis lance l'API et l'aperçu (http://127.0.0.1:4174), adresse de la Suite Atelier |
| `npm run app:install` | macOS : crée l'application de bureau « Atelier Projets » (Electron) ; `-- ~/Desktop` pour la créer ailleurs |
| `npm run app:desktop` | Ouvre l'application de bureau depuis le terminal (sans l'installer) |
| `npm run build` | Compilation du backend (`backend/dist/`) et de l'interface (`frontend/dist/`) |
| `npm run openapi` | Après une modification de l'API : régénère `backend/openapi.json` puis les types du frontend |
| `npm test` | Tests du backend (domaine, CRUD, vues calculées sur la démo), sur une base SQLite temporaire, de la logique pure du frontend (`frontend/src/**/*.test.ts`, `node --test`) et de l'application de bureau |
| `npm run test:e2e` | Tests de navigateur (Playwright) : API sur une base temporaire (port 3100) et interface (port 5180), sans toucher à `npm run dev`. La première fois : `npm run test:e2e:install` (télécharge Chromium) |
| `npm run db:migrate -- --name <nom>` | Nouvelle migration après modification du schéma (`prisma migrate dev`), puis régénération du client |
| `npm run db:seed` | Réinsère le projet de démo « App E-Commerce v2 » (idempotent) |
| `npm run db:reset` | Réinitialise la base, rejoue les migrations puis le seed |
| `npm run db:studio` | Ouvre Prisma Studio sur la base locale |
| `npm run check` | Tokens du design system, `tsc --noEmit` du backend et du frontend, contrat OpenAPI à jour, aucune couleur en dur dans le frontend |

La configuration est facultative : sans fichier `.env`, la base est créée dans `backend/prisma/dev.db` et l'API écoute sur `127.0.0.1:3000`. Pour changer ces valeurs, copier `backend/.env.example` en `backend/.env`.

**Sauvegardes :** la base est copiée au démarrage puis toutes les 24 h dans `backend/prisma/backups/` (14 copies automatiques et 14 manuelles gardées) ; « Sauvegarder maintenant » et le téléchargement des copies sont dans **Paramètres du projet**. Pour restaurer : arrêter l'application, remplacer `backend/prisma/dev.db` par une copie, relancer.

**Après une mise à jour du dépôt :** `npm install` puis `npm run setup` (applique les nouvelles migrations de la base ; le projet de démo est réinséré, vos projets sont conservés).

---

## 🏛️ 1. Architecture du Dépôt (Monorepo Strict)

Le développement d'**Atelier Projets** est strictement découpé en **3 piliers isolés** pour garantir un code propre, modulaire et maintenable :

```text
Atelier_Projets/
├── 📁 design-system/          # PILIER 1 : UI/UX, Tokens CSS, Thèmes (Clair/Sombre), Composants isolés
│   ├── tokens/                # ✅ colors.css : 7 types + 8 statuts (codes hex officiels) · ui.css : jetons dérivés
│   ├── themes/                # ✅ light.css, dark.css (CSS natif pur, exportables vers toutes tes applications)
│   └── components/            # ✅ Boutons, Badges, Cartes, Barres de progression et de Gantt, Onglets, Champs, Tableaux, Markdown
│
├── 📁 frontend/               # PILIER 2 : Client Web (React + TypeScript + Vite + Tailwind CSS + Zustand + Lucide)
│   ├── src/views/             # ✅ DashboardView, GanttView, TimeSheetView, TaskSlideOver, SettingsView
│   ├── src/components/        # ✅ Cadre (en-tête, rail, onglets), carte Santé, dialogues, briques React des composants ds-*
│   ├── src/store/             # ✅ État d'interface (Zustand) : thème, projet, vue, élément ouvert
│   └── src/services/          # ✅ Client REST typé (openapi-fetch) : types générés depuis backend/openapi.json
│
├── 📁 backend/                # PILIER 3 : API & Logique Métier (Node.js + Fastify + TypeScript)
│   ├── prisma/                # ✅ Schéma SQLite (100% local), migrations, projet de démo et seed
│   ├── src/domain/            # ✅ Règles métier pures : durées j/h, avancement, statut dérivé, bilans, journal
│   ├── src/schemas/           # ✅ Contrat de l'API (TypeBox → validation, types, OpenAPI)
│   ├── src/services/          # ✅ Cas d'usage (Prisma) : CRUD et vues calculées
│   ├── src/routes/            # ✅ Routes REST Fastify sous /api (documentation : /api/docs)
│   ├── test/                  # ✅ Tests node:test (domaine, CRUD, vues sur la démo)
│   ├── src/git-engine/        # ✅ Lecture du dépôt (simple-git), regex #ID, hook post-commit, client GitHub (Octokit)
│   └── src/ai-bridge/         # ✅ Client Ollama (Qwen / Gemma), prompts IA, lancement de Claude CLI
│
├── 📁 desktop/                # Emballage (hors piliers) : application de bureau Electron — fenêtre native qui
│                              #   lance l'API compilée et sert l'interface compilée ; aucune logique métier ni style
├── 📁 e2e/                    # Tests de navigateur (Playwright)
├── CLAUDE.md                  # Règles d'architecture et conventions de code pour Claude CLI
└── README.md                  # Spécification fonctionnelle et visuelle d'Atelier_Projets
```

---

## 🎨 2. Design System : Thèmes, Types & Statuts

Le système de design repose sur des variables CSS strictes réutilisables dans toutes tes applications (`design-system/themes/`).

### A. Fondations des Thèmes (Clair & Sombre)

| Variable CSS | ☀️ Mode Clair | 🌙 Mode Sombre | Usage |
| :--- | :--- | :--- | :--- |
| `--bg-main` | `#F8FAFC` | `#0A0A0D` | Fond principal de l'application |
| `--bg-surface` | `#FFFFFF` | `#111116` | Cartes, Tableaux, Panneaux latéraux |
| `--bg-elevated` | `#F1F5F9` | `#191A21` | Modales, Menus déroulants, Survols |
| `--text-primary` | `#0F172A` | `#F4F5F7` | Texte principal |
| `--text-muted` | `#64748B` | `#A1A6B2` | Texte secondaire, métadonnées |
| `--border-color` | `#E2E8F0` | `#262833` | Bordures fines et séparateurs |

Ces deux thèmes sont des bases **neutres**, en CSS pur et copiables. Dans l'application, la charte **« néon monochrome »**
([`docs/SUITE.md`](./docs/SUITE.md) §1.7) teinte toute l'interface de la couleur signature d'Atelier Projets, **vert citron `#94D82D`**
(`data-atelier-app="projets"` sur `<html>`), en clair comme en sombre : fond teinté avec fine grille et lueur, barre latérale,
cartes cerclées d'un trait vert citron avec halo, textes, bouton principal (plein en clair, contour néon en sombre), navigation active.
Les jetons `--atelier-*` de `design-system/brand/atelier-brand.css` sont branchés sur les variables `--app-*` de `tokens/ui.css`.
La couleur signature ne remplace aucune couleur de type ou de statut (Gantt, badges, histogramme inchangés).

### B. Couleurs Officielles des Types d'Éléments (Work Items & Gantt)

| Type (EN) | Libellé (FR) | Code Hex | Variable CSS | Rôle dans l'application |
| :--- | :--- | :--- | :--- | :--- |
| **Phase** | Phase du projet | `#FF8F2B` 🟧 | `--type-phase` | Découpage macroscopique sur le Gantt |
| **Milestone** | Jalon important | `#2A9A30` 🟩 | `--type-milestone` | Point de contrôle clé (`◆` sur le Gantt) |
| **Epic** | Grand ensemble fonctionnel | `#8250DF` 🟪 | `--type-epic` | Conteneur de haut niveau (Groupe de Stories) |
| **Story / User story**| Récit utilisateur | `#6F42C1` 🟣 | `--type-story` | Besoin fonctionnel regroupant les tâches |
| **Feature** | Fonctionnalité | `#2A9A30` 🟢 | `--type-feature` | Nouvelle fonctionnalité à développer |
| **Task** | Tâche classique | `#1B66A3` 🔵 | `--type-task` | Action technique ou de configuration |
| **Bug** | Anomalie à corriger | `#D64545` 🔴 | `--type-bug` | Erreur ou régression à corriger |

### C. Couleurs Officielles des Statuts (Workflow)

| Statut (EN) | Libellé (FR) | Code Hex | Variable CSS | Signification |
| :--- | :--- | :--- | :--- | :--- |
| **Open / New** | À faire | `#64748B` ⚪ | `--status-open` | Créé, en attente de prise en charge |
| **In progress** | En cours | `#2563EB` 🔵 | `--status-progress` | Développement actif en cours |
| **In review** | En revue | `#8B5CF6` 🟣 | `--status-review` | Pull Request ouverte / Relecture de code |
| **On hold** | En attente | `#F59E0B` 🟡 | `--status-hold` | Mis en pause volontairement |
| **Blocked** | Bloquée | `#EA580C` 🟠 | `--status-blocked` | Bloqué par une dépendance ou un problème |
| **Resolved** | Résolue | `#0D9488` 🩵 | `--status-resolved` | Développé et validé, prêt à être clôturé |
| **Closed / Done** | Terminée | `#16A34A` 🟢 | `--status-closed` | Mergé et définitivement terminé |
| **Rejected** | Rejetée | `#DC2626` 🔴 | `--status-rejected` | Annulé, hors périmètre ou doublon |

### D. Utilisation

```css
/* Tout le design system (tokens + thèmes) */
@import "@atelier/design-system";
```

```html
<!-- Thème clair par défaut ; en sombre, l'interface pose data-theme="dark" ET la classe « dark » (Suite Atelier) -->
<html data-theme="dark" class="dark">
```

Les fichiers `themes/light.css` et `themes/dark.css` ne contiennent que les 6 variables de fondation (aucune dépendance métier) et se copient tels quels dans une autre application. Les couleurs de types et de statuts vivent dans `tokens/colors.css`. `npm run check` vérifie que chaque code hex correspond exactement à cette spécification.

---

## 🗂️ 3. Hiérarchie des Projets

Chaque projet est lié à un dépôt Git local et un dépôt GitHub distant :

```text
📁 PROJET (Lié au Repo Git/GitHub)
 └── 🟧 PHASE (Phase du projet - #FF8F2B)
      ├── 🟪 EPIC (Grand ensemble fonctionnel - #8250DF)
      │    └── 🟣 STORY (Récit utilisateur - #6F42C1)
      │         ├── 🟢 FEATURE (Fonctionnalité - #2A9A30)
      │         ├── 🔵 TASK (Tâche classique - #1B66A3)
      │         └── 🔴 BUG (Anomalie à corriger - #D64545)
      └── ♦️ MILESTONE (Jalon important - #2A9A30)
```

### Modèle de données (`backend/prisma/schema.prisma`)

| Modèle | Rôle | Champs clés |
| :--- | :--- | :--- |
| `Project` | Projet lié à un dépôt Git local et GitHub | `name`, `slug`, `localRepoPath`, `githubOwner` / `githubRepo`, `hoursPerDay` (défaut 8), `budgetHours` |
| `Phase` | Découpage macroscopique (Gantt) | `position`, `startDate`, `dueDate` |
| `Milestone` | Jalon ◆ — toujours rattaché au projet, et optionnellement à une phase | `date`, `reachedAt` (null = non atteint) |
| `Epic` | Grand ensemble fonctionnel d'une phase | `position`, `startDate`, `dueDate` |
| `Story` | Récit utilisateur d'un epic | `position`, `startDate`, `dueDate` |
| `WorkItem` | `FEATURE` \| `TASK` \| `BUG` — son `id` est le `#ID` public cité dans les commits | `status` (8 statuts), `priority`, `description`, `implementationLog`, `estimatedHours`, `progress` |
| `TimeEntry` | Saisie de temps sur un WorkItem | `spentOn`, `hours`, `comment` |
| `GitCommit` | Commit détecté dans le dépôt du projet | `hash`, `authorName`, `authorEmail`, `committedAt`, `message`, `branch` |
| `GitCommitLink` | Liaison commit ↔ WorkItem (un commit peut citer plusieurs `#ID`) | `keyword` (`feature`, `task`, `bug`, `fix`, `feat`, `ref`) |
| `PullRequest` | Pull Request GitHub du dépôt du projet | `number`, `title`, `state` (`OPEN` · `MERGED` · `CLOSED`), `draft`, `headBranch`, `url` |
| `PullRequestLink` | Liaison Pull Request ↔ WorkItem | `source` (`title`, `body`, `branch`) |

- **Unités :** toutes les durées sont stockées en **heures** ; la conversion en jours utilise `Project.hoursPerDay` (1 jour = 8 h par défaut).
- **Statuts et types** sont des enums Prisma (`WorkItemStatus`, `WorkItemType`) dont les valeurs correspondent exactement à `CLAUDE.md`.
- **Suppression :** en cascade le long de la hiérarchie ; un jalon dont la phase est supprimée reste rattaché au projet.
- **Agrégats :** Phases, Epics et Stories ne stockent ni statut ni avancement ; le backend les calcule à partir de leurs WorkItems (budget, temps réalisé, avancement).

---

## 🖥️ 4. Maquettes Visuelles des Interfaces

> **Implémentation :** onglets « Tableau de bord » (A), « Gantt & Avancement du projet » (B), « Tableau des temps » (D) et fiche élément à droite (C), plus « Paramètres du projet » (dépôts Git/GitHub). Fonctions IA : voir §5.
>
> Le seed de démo (`npm run db:seed`) reproduit les données de ces maquettes : budget 45.0 j (360 h), réalisé 28.5 j (228 h), Gantt (phases de 15 j et 20 j, jalons du 15 oct. et du 2 nov.), tableau des temps (#101, #102, #103, #12345, #205 : 12 j budgétés, 72 h réalisées) et fiche #12345 avec ses deux commits et la Pull Request #42 « En revue ».
>
> Indicateurs du tableau de bord, tels que le seed les reproduit :
> - **Progression budget** = temps réalisé / budget initial du projet → 228 h / 360 h = **63 %** ;
> - **Avancement réel** = Σ (estimation × avancement) / Σ estimations, éléments rejetés exclus → 198 h / 280 h = **71 %** ;
> - **En avance ✨** lorsque l'avancement réel dépasse la progression budget.

### A. Vue Dashboard : Santé du Budget & Histogramme des 8 Statuts

```text
+----------------------------------------------------------------------------------------------------------+
| 🚀 ATELIER_PROJETS  [Projet : App E-Commerce v2 ▾]               🔗 github.com/user/ecom   [☀️/🌙] [🤖 IA] |
+----------------------------------------------------------------------------------------------------------+
| 📊 SANTÉ DU PROJET & BUDGET                                                                              |
|                                                                                                          |
|  Budget Initial : 45.0 Jours (360h)      Temps Réalisé : 28.5 Jours (228h)             Reste : 16.5 Jours |
|  Progression Budget : [████████████████████████████░░░░░░░░░░░░░░░░] 63% consommé                        |
|  Avancement Réel    : [████████████████████████████████░░░░░░░░░░░░] 71% terminé (En avance ✨)          |
+----------------------------------------------------------------------------------------------------------+
| 📈 HISTOGRAMME DES ÉLÉMENTS PAR STATUT (Feature #2A9A30, Task #1B66A3, Bug #D64545)                      |
|                                                                                                          |
|   25 |                ███                                                   ███                          |
|   20 |                ███                                                   ███   ▒▒▒                    |
|   15 |    ███         ███   ▒▒▒                                             ███   ▒▒▒                    |
|   10 |    ███   ▒▒▒   ███   ▒▒▒   ███                           ███         ███   ▒▒▒                    |
|    5 |    ▒▒▒   ░░░   ▒▒▒   ░░░   ▒▒▒   ▒▒▒   ░░░     ░░░       ▒▒▒   ░░░   ▒▒▒   ░░░     ░░░            |
|    0 +------------------------------------------------------------------------------------------         |
|          OPEN        IN PROG      IN REVIEW     ON HOLD     BLOCKED     RESOLVED    CLOSED    REJECTED   |
|        À faire      En cours      En revue    En attente    Bloquée     Résolue    Terminée   Rejetée    |
|        #64748B       #2563EB       #8B5CF6      #F59E0B     #EA580C     #0D9488     #16A34A   #DC2626    |
+----------------------------------------------------------------------------------------------------------+
```

---

### B. Vue Diagramme de Gantt (Phases, Epics, Stories, Tâches & Milestones)

```text
+----------------------------------------------------------------------------------------------------------+
| 📅 DIAGRAMME DE GANTT & MILESTONES                                 [Zoom: Semaine ▾] [Exporter] [+ Jalon]|
+-----------------------------------------+--------+----------+----------+----------+----------+-----------+
| HIÉRARCHIE DU PROJET                    | BUDGET | OCT S1   | OCT S2   | OCT S3   | OCT S4   | NOV S1    |
+-----------------------------------------+--------+----------+----------+----------+----------+-----------+
| ▼ 🟧 PHASE 1 : Socle Technique (#FF8F2B)| 15.0 j | ██████████████████████████████                        |
|   ▼ 🟪 EPIC 1 : Architecture (#8250DF)  | 15.0 j | ██████████████████████████████                        |
|     ▼ 🟣 STORY 1.1 : Auth (#6F42C1)     |  6.0 j | ████████████                                          |
|       🟢 #101 Feature: OAuth (#2A9A30)  |  3.0 j | ██████ (Closed #16A34A)                               |
|       🔵 #102 Task: Config JWT (#1B66A3)|  2.0 j |     ████ (Resolved #0D9488)                           |
|       🔴 #103 Bug: Fix CORS (#D64545)   |  1.0 j |         ██ (In Review #8B5CF6)                        |
|   ♦️ MILESTONE 1 : API Prête (#2A9A30)  |  0.0 j |            ◆ (15 Oct - Atteint ✅)                    |
|                                         |        |                                                       |
| ▼ 🟧 PHASE 2 : Expérience UI (#FF8F2B)  | 20.0 j |              ████████████████████████████████         |
|   ▼ 🟪 EPIC 2 : Design System (#8250DF) | 20.0 j |              ████████████████████████████████         |
|     ▼ 🟣 STORY 2.1 : Thèmes (#6F42C1)   |  8.0 j |              ████████████████                         |
|       🟢 #204 Feature: Dark Mode        |  5.0 j |              ████████░░ (80% - In Progress #2563EB)   |
|       🔵 #205 Task: Tokens CSS          |  3.0 j |                    ░░░░░░ (0% - Blocked #EA580C)      |
|   ♦️ MILESTONE 2 : Beta UI (#2A9A30)    |  0.0 j |                                              ◆ 02 Nov |
+-----------------------------------------+--------+----------+----------+----------+----------+-----------+
```

---

**Interactions du Gantt :**

- **Glisser une barre** pour la déplacer au jour près ; **glisser un bord** d'un élément pour changer son début ou sa fin ; **glisser un jalon** pour changer sa date. Une phase, un epic ou une story se déplace **avec tout son contenu** (et les jalons de la phase). Au clavier : `Alt` + `←`/`→` (un jour), `Alt` + `Maj` + `←`/`→` (la fin seulement).
- **Dépendances « fin → début »** : tirer le rond au bout d'une barre jusqu'à un autre élément (ou « Prédécesseur » dans la fiche). Flèche grise : marge respectée ; flèche rouge en pointillés : conflit (le successeur commence avant la fin de son prédécesseur). Les boucles sont refusées.
- **« N conflits · Replanifier »** décale les successeurs en conflit, en cascade, en conservant leur durée.
- **Chemin critique** : surligne les éléments dont tout retard repousse la fin du projet.
- **PDF** : imprime le Gantt affiché en A4 paysage, réduit à la largeur de la page (choisir « Enregistrer au format PDF »). Les stories repliées restent repliées.

### C. Fiche de Tâche (Double Onglet + Liaison Git/GitHub)

Chaque élément (`#12345`) dispose de deux onglets :
1. **Description (À faire)** : Spécifications et critères d'acceptation.
2. **Journal d'avancement (Réalisation)** : Explication technique de comment la tâche a été réalisée.
Les commits contenant `feature #12345`, `task #12345` ou `bug #12345` sont automatiquement rattachés.

```text
+----------------------------------------------------------------------------------------------------------+
| 🟢 FEATURE #12345 (#2A9A30) — Implémenter le moteur de synchronisation Git Local / GitHub          [✕]   |
| Parent : 🟧 PHASE 1 > 🟪 EPIC 1 > 🟣 STORY 1.2   |   Statut : [ 🔵 En cours (#2563EB) ▾ ]                |
+----------------------------------------------------------------------------------------------------------+
| ⏱️ BUDGET & TEMPS : Estimé : [ 3.0 j (24h) ]   |   Réalisé : [ 2.25 j (18h) ]   |   [+ Saisir Temps]      |
+----------------------------------------------------------------------------------------------------------+
|  [ 📝 1. DESCRIPTION (À faire) ]   [ 🛠️ 2. JOURNAL D'AVANCEMENT (Comment c'est réalisé) ]               |
|  ======================================================================================================  |
|  ### Objectif de la Feature                                                                              |
|  Permettre au backend de scanner les commits locaux et de lier automatiquement tout commit               |
|  contenant `#ID` à la tâche correspondante.                                                              |
|                                                                                                          |
|  ### Critères d'acceptation                                                                              |
|  - [x] Parser les messages de commit via `simple-git`                                                    |
|  - [x] Extraire les patterns `feature #12345`, `fix #12345`, `task #12345`                               |
|  - [ ] Synchroniser le statut avec les Pull Requests GitHub                                              |
|                                                                                                          |
|  ------------------------------------------------------------------------------------------------------  |
|  *(Contenu de l'Onglet 2 : Journal d'avancement)*                                                        |
|  > **18 Oct 2026 - 16h30 (4.5h passées) :** Mise en place d'un hook `post-commit` couplé à               |
|  > une table SQLite `git_commits`. J'ai utilisé Qwen-2.5-Coder en local pour générer la Regex            |
|  > d'extraction multi-références. Fonctionne parfaitement en local.                                      |
+----------------------------------------------------------------------------------------------------------+
| 🌿 COMMITS GIT & GITHUB ASSOCIÉS (Détectés automatiquement via #12345)                                   |
|  • `a8f4d21` - "feat: add regex parser for feature #12345 in git-engine" (Il y a 2h)                     |
|  • `c3e91b0` - "wip: database schema for git links feature #12345" (Hier)                                |
|  • 🔀 PR #42 : "Feature/12345 git sync engine" — [Statut : 🟣 En revue (#8B5CF6)]                        |
+----------------------------------------------------------------------------------------------------------+
```

---

### D. Vue Tableau des Temps (Timesheet)

```text
+----------------------------------------------------------------------------------------------------------+
| ⏱️ TABLEAU DES TEMPS (TIMESHEET)                         [Filtre: Tous les Epics ▾] [1 Jour = 8 Heures ▾]|
+---------+-----------------------------------+--------------------+------------+------------+-------------+
| ID      | ÉLÉMENT & TYPE                    | STATUT             | BUDGET (J) | RÉALISÉ    | BILAN       |
+---------+-----------------------------------+--------------------+------------+------------+-------------+
| #101    | 🟢 Feature: OAuth2 GitHub         | 🟢 Terminée        | 3.00 j     | 2.50j (20h)| -0.50 j (🟢)|
| #102    | 🔵 Task: Config JWT               | 🩵 Résolue         | 2.00 j     | 2.00j (16h)|  0.00 j (⚪)|
| #103    | 🔴 Bug: Fix CORS Header           | 🟣 En revue        | 1.00 j     | 1.75j (14h)| +0.75 j (🔴)|
| #12345  | 🟢 Feature: Moteur Sync Git       | 🔵 En cours        | 3.00 j     | 2.25j (18h)|  0.75 j rest|
| #205    | 🔵 Task: Tokens CSS               | 🟠 Bloquée         | 3.00 j     | 0.50j (4h) |  2.50 j rest|
+---------+-----------------------------------+--------------------+------------+------------+-------------+
| TOTAL   | 5 Éléments affichés               | 40% Terminé/Résolu | 12.00 j    | 9.00j (72h)|  3.00 j rest|
+---------+-----------------------------------+--------------------+------------+------------+-------------+
```

---

## 🤖 5. Fonctionnalités IA : Ollama (local) ou Claude, et sessions Claude CLI

1. **Découpage Agile assisté (Gemma / Qwen) :** Bouton `[✨ Générer les sous-tâches]` dans une Story pour proposer automatiquement les Features (`#2A9A30`) et Tasks (`#1B66A3`) avec estimation du budget en jours.
2. **Auto-Rédaction du Journal d'Avancement :** Bouton `[🤖 Résumer mes commits]` dans l'onglet 2 d'une tâche qui lit les `git diff` des commits liés à `#12345` et rédige automatiquement l'explication technique du travail réalisé.
3. **Exécution Claude CLI :** Bouton d'action rapide sur une tâche permettant de lancer Claude CLI dans le dépôt Git du projet avec la description de la tâche `#12345` directement injectée en prompt.

**Choix du moteur (contrat commun de la Suite Atelier, [`docs/SUITE.md`](./docs/SUITE.md) §5) :**

- **Hors ligne / En ligne** : interrupteur de l'en-tête, **hors ligne par défaut**, gardé par le backend (`GET` / `PATCH /api/settings`, table `AppSetting`). Hors ligne, **rien ne part vers Claude** : « Claude » est grisé avec l'explication (un choix « Claude » mémorisé devient « Auto »), et une requête qui le demande quand même est refusée (`403 CLAUDE_OFFLINE`). En ligne, un « Claude » choisi mais indisponible reste « Claude » : la requête est refusée avec la raison (`502 CLAUDE_UNAVAILABLE`), jamais servie en silence par Ollama. Le réglage n'accepte que l'interface locale (`Host` et `Origin` de bouclage).
- **« Moteur : Auto · Ollama · Claude »** dans chaque action IA (découpage, résumé des commits) et dans le panneau `🤖 IA` : **Auto** = Claude si l'application est en ligne **et** Claude disponible, sinon Ollama. Modèle Ollama (modèles installés) ou Claude (`Sonnet` par défaut, `Opus`, `Haiku`) ; choix mémorisés dans le navigateur (valeurs relues validées : une valeur inconnue reprend Auto, Sonnet ou le modèle du serveur). Le résultat affiche le moteur effectivement utilisé (« 4 propositions · Claude · Sonnet »).
- **Ligne bouclier** sous le choix : ce qui part vers Claude — pour le découpage, le titre et la description de la story (et de son epic et de sa phase), les titres des éléments existants et les consignes ; pour le journal, le texte de l'élément, les messages et les diffs des commits liés (tronqués à `AI_MAX_DIFF_CHARS` **au total**).
- **Données, jamais instructions** (`docs/SUITE.md` §5.4) : dans les prompts du découpage et du journal, le texte des stories, des éléments et des commits (messages, auteurs, diffs) est transmis dans des blocs `<donnees type="…">…</donnees>` (balises imitées neutralisées), et le prompt système dit qu'ils ne contiennent jamais d'instructions ; seules les consignes de l'utilisateur sont hors des blocs.
- **Pastilles « Ollama » et « Claude »** dans l'en-tête : vert = disponible, gris = indisponible ou hors ligne ; le détail est dans l'info-bulle, un clic ouvre le panneau IA.
- **Appel de Claude** (`ai-bridge/claude-print.ts`) : la CLI Claude Code de la machine (ton abonnement), lancée **isolée** — `claude -p --safe-mode --output-format json --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence --max-turns <n> --model <alias> --system-prompt <prompt>` (+ `--json-schema` pour le découpage, même schéma de sortie qu'avec Ollama), conversation sur l'entrée standard (le prompt système ne contient que des consignes : aucune donnée en argument, visible par `ps`), dossier temporaire vide, délai `CLAUDE_TIMEOUT_MS` (180 s). **Environnement en liste blanche** : `HOME`, `USER`, `LOGNAME`, `PATH` (dossier de l'exécutable en tête, sans entrée relative ni `node_modules/.bin`), `SHELL`, `LANG`, `LC_*`, `TMPDIR`, `TZ`, `CLAUDE_CONFIG_DIR`, plus `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` — ni `ANTHROPIC_*`, ni `CLAUDE_CODE_USE_BEDROCK/VERTEX`, ni secret de l'application. **Aucun outil** : Claude ne fait que répondre. Disponible = exécutable trouvé (`CLAUDE_CLI` en chemin absolu — un chemin relatif est refusé —, sinon `PATH` sans entrée relative ni `node_modules/.bin`, puis `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) **et** `claude auth status` connecté (cache 60 s, revérification forcée au plus toutes les 10 s, non vérifié hors ligne).

**Implémentation (`backend/src/ai-bridge/`) :**

| Fonction | Où | Fonctionnement |
| :--- | :--- | :--- |
| `Hors ligne / En ligne`, pastilles | En-tête | Mode de l'application (backend) ; état d'Ollama et de Claude |
| `🤖 IA` | En-tête | Panneau « Intelligence artificielle » : moteur par défaut, Ollama (modèles installés, choix du modèle), **Claude** (état du moteur : CLI, version, connexion, modèle Sonnet / Opus / Haiku) et la **session interactive dans le Terminal** |
| `✨ Générer les sous-tâches` | Ligne STORY du Gantt (survol) | Choix du moteur en tête du dialogue. Le modèle reçoit la story, ses parents et ses éléments existants (+ consignes facultatives) et répond en JSON structuré : 3 à 8 Features / Tasks avec critères d'acceptation et estimation en jours (bornée, au quart de jour). Les propositions sont **éditables** (titre, type, estimation, sélection) puis créées en une transaction (`POST /stories/:storyId/work-items/batch`) |
| `🤖 Résumer mes commits` | Onglet « Journal d'avancement » | Choix du moteur dans le bloc « Résumé des commits ». Le modèle reçoit la tâche, la fin du journal et les commits liés au `#ID` avec leur `git diff` (fichiers générés exclus, budget `AI_MAX_DIFF_CHARS` partagé entre les commits puis réparti par fichier : le total envoyé ne le dépasse jamais). Le texte proposé arrive dans le formulaire d'entrée, **modifiable**, et n'est ajouté au journal qu'après validation |
| `Claude CLI` | En-tête de la fiche élément, panneau IA (section Claude) | **Un clic** ouvre Claude dans le dépôt du projet (macOS : Terminal, `CLAUDE_TERMINAL_APP`), avec la tâche en prompt depuis la fiche, sans prompt depuis le panneau ; sans dépôt local, son chemin est demandé une fois. Le bouton ⚙ voisin permet de modifier le prompt (tâche, contexte, description, journal, commits, convention `feat(scope): description #ID`) et le mode de permissions (manuel, plan d'abord, accepter les modifications) ; ailleurs que sur macOS, la commande est copiée |

- Hors ligne, aucune donnée ne quitte la machine : Ollama tourne en local. En ligne, seul le contenu annoncé par la ligne bouclier part vers Claude. La session Claude CLI (terminal) est une fonction distincte, indépendante du moteur : elle utilise ton compte Claude Code, dans un terminal où tu valides chaque action.
- Les générations sont annulées si le dialogue est fermé (Ollama est libéré, la CLI Claude est arrêtée) ; la réponse d'Ollama est lue en flux, sans limite de 5 min sur l'attente du premier octet.
- Le prompt de Claude CLI est écrit dans un fichier temporaire (droits `0600`, dossier propre à l'utilisateur) et passé après `--` : son contenu ne peut être interprété ni par le shell ni comme option de la CLI.

---

## 🧾 6. Notes techniques & conventions

- **Règles d'architecture :** voir [`CLAUDE.md`](./CLAUDE.md) (séparation des 3 piliers, couleurs officielles, hiérarchie, méthode de travail).
- **Commits :** `feat(scope): description #ID` ou `chore(setup): initial architecture`.
- **Versions épinglées :** Prisma `7.10.1` (CLI, client et adaptateur alignés), Fastify 5, TypeScript 7.
- **Prisma 7 :**
  - la configuration du CLI est dans `backend/prisma.config.ts` (URL de la base, chemin des migrations, commande de seed) ;
  - `.env` n'est plus chargé automatiquement : `backend/src/config.ts` le lit s'il existe (les variables du shell restent prioritaires) ;
  - `migrate dev` ne lance plus `generate` ni le seed : les scripts `db:*` enchaînent les commandes explicitement ;
  - le client est généré dans `backend/src/generated/prisma/` (ignoré par Git) et utilise l'adaptateur `@prisma/adapter-better-sqlite3`.
- **Imports TypeScript :** extensions `.ts` explicites (comme le client Prisma généré) ; `tsc` les réécrit en `.js` au build.
- **Sécurité locale :** l'API écoute par défaut sur `127.0.0.1` uniquement.
- **Jeu de démo :** IDs fixes `#101` → `#211` et `#12345`, conformes aux maquettes. Les nouveaux éléments créés ensuite continuent la numérotation après `#12345`.
- **Contrat d'API :** schémas TypeBox 1.3 (`backend/src/schemas/`) → validation des requêtes, types des handlers (`@fastify/type-provider-typebox`) et OpenAPI 3.1 (`@fastify/swagger`, interface sur `/api/docs`, JSON sur `/api/docs/json`).
- **Tests :** `node:test` + `tsx`, chaque fichier sur sa propre base SQLite temporaire construite en appliquant le SQL des migrations versionnées (aucun moteur Prisma requis), puis le projet de démo.
- **Fuseau horaire :** les entrées du journal et la date du jour par défaut d'une saisie utilisent `APP_TIMEZONE` (défaut : fuseau du système).
- **Frontend :**
  - React 19, Vite 8, Tailwind CSS 4, Zustand 5, Lucide ; `/api` est relayé par Vite vers `http://127.0.0.1:3000` (variable `ATELIER_API_URL` pour un autre port) : même origine, aucune configuration CORS ;
  - **couleurs** : la palette par défaut de Tailwind est retirée (`--color-*: initial`) ; les seules couleurs utilisables sont les variables du design system (`bg-surface`, `text-muted`, `bg-phase`…). Un composant porte `data-type`, `data-status`, `data-priority` ou `data-balance` et le design system lui donne sa teinte (`--kind-color`, `--kind-ink` lisible en clair comme en sombre) ;
  - **contrat d'API** : `backend/openapi.json` (exporté par `npm run openapi`) → `frontend/src/services/api.gen.ts` (openapi-typescript, exécuté via `npx` car il dépend de TypeScript 5). `npm run check` signale un contrat ou des types périmés ;
  - **aucun calcul métier** côté client : jours, pourcentages, bilans, histogramme et statuts des conteneurs viennent de l'API ; le frontend ne fait que de la mise en forme (et la mise en page du calendrier du Gantt) ;
  - préférences (thème, projet, vue) mémorisées dans le navigateur (`localStorage`, facultatif) ;
  - **thème** : Clair, Sombre ou Système (suit l'OS) ; sur `<html>`, `data-theme="light|dark"` et la classe `dark` en sombre (contrat de la Suite Atelier).
- **API locale protégée :** l'API n'accepte que les en-têtes `Host` locaux (`127.0.0.1`, `localhost`, `::1`, plus `ALLOWED_HOSTS`) et refuse les écritures dont l'en-tête `Origin` désigne un autre site : un site web visité ne peut pas piloter l'API (DNS rebinding, requêtes intersites). Le `curl` du hook post-commit, sans `Origin`, reste accepté.
- **IA locale :** `OLLAMA_URL` (défaut `http://localhost:11434`), `OLLAMA_MODEL` (`qwen2.5-coder` ; une seule étiquette installée comme `qwen2.5-coder:7b` est reconnue), `OLLAMA_NUM_CTX` (16384 : fenêtre de contexte demandée, pour que les diffs ne soient pas tronqués), `OLLAMA_TIMEOUT_MS` (180000), `AI_MAX_DIFF_CHARS` (24000) ; `CLAUDE_CLI` (`claude` ; sinon cherchée dans le `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), `CLAUDE_TIMEOUT_MS` (180000) et `CLAUDE_TERMINAL_APP` (`Terminal`, ou `iTerm`). Voir `backend/.env.example`.
- **Scripts d'installation (npm 11.16+ / 12) :** `allowScripts` (package.json racine) autorise uniquement les dépendances qui en ont besoin : `better-sqlite3` (module natif SQLite), `prisma` et `@prisma/engines` (moteurs Prisma), `esbuild` (utilisé par `tsx`) et `fsevents` (surveillance des fichiers sous macOS). Toute nouvelle dépendance à script d'installation devra y être ajoutée (`npm install-scripts ls` les liste).

---

## 🔌 7. API REST du backend

Base : `http://127.0.0.1:3000/api` — documentation interactive : **`/api/docs`**. Routes de la Suite Atelier (import Atelier Tab, jeux de données pour Atelier Viz, nœud Atelier pour Atelier Nexus sous `/api/atelier`) : voir [§8](#-8-suite-atelier). Le frontend affiche ces réponses telles quelles : les conversions, agrégats et bilans sont calculés ici.

### Conventions

- **Durées** : stockées en heures, toujours renvoyées sous la forme `{ "hours": 24, "days": 3 }` (1 jour = `hoursPerDay` du projet, 8 h par défaut). En écriture, une estimation ou un budget se saisit soit en heures (`estimatedHours`, `budgetHours`), soit en jours (`estimatedDays`, `budgetDays`) ; les saisies de temps se font en heures.
- **Dates** : dates calendaires en `AAAA-MM-JJ` ; horodatages en ISO 8601 (UTC).
- **Écriture** : `POST` → `201` avec la ressource créée, `PATCH` partiel → `200`, `DELETE` → `204`. Les corps JSON sont typés strictement : un champ inconnu, `"50"` à la place de `50` ou `null` sur un champ obligatoire sont refusés ; `null` efface un champ facultatif (dates, estimation, budget, dépôt…).
- **Erreurs** : `{ "statusCode", "error", "code", "message" }` — `VALIDATION_ERROR` / `BAD_REQUEST` (400), `NOT_FOUND` (404), `CONFLICT` (409). Seules les routes `/api/atelier/*` (nœud Atelier, §8) répondent `{ "detail", "code" }`.
- **Événements** : toute écriture d'un élément, d'une saisie de temps ou d'un jalon (par ces routes, l'import ou le chronomètre) alimente le journal du nœud Atelier (`GET /api/atelier/events`, §8).

### Ressources

| Domaine | Routes |
| :--- | :--- |
| Projets | `GET·POST /projects` · `GET·PATCH·DELETE /projects/:projectId` |
| Hiérarchie | `GET·POST /projects/:projectId/phases` · `GET·PATCH·DELETE /phases/:phaseId` · `GET·POST /phases/:phaseId/epics` · `GET·PATCH·DELETE /epics/:epicId` · `GET·POST /epics/:epicId/stories` · `GET·PATCH·DELETE /stories/:storyId` |
| Éléments | `GET /projects/:projectId/work-items?type=&status=&phaseId=&epicId=&storyId=&q=` (`q` : titre sans tenir compte de la casse ni des accents, ou `#ID`) · `GET·POST /stories/:storyId/work-items` · `GET·PATCH·DELETE /work-items/:workItemId` · `POST /work-items/:workItemId/log-entries` |
| Temps | `GET·POST /work-items/:workItemId/time-entries` · `PATCH·DELETE /time-entries/:timeEntryId` |
| Jalons | `GET·POST /projects/:projectId/milestones` · `GET·PATCH·DELETE /milestones/:milestoneId` (`reachedAt` : date d'atteinte, jamais dans le futur ; `null` = non atteint) |
| Planification | `POST /work-items/:workItemId/dependencies` `{ predecessorId }` · `DELETE /work-items/:workItemId/dependencies/:predecessorId` · `POST /phases\|epics\|stories/:id/shift` `{ days }` (conteneur, contenu daté et jalons de la phase, tout ou rien) · `POST /projects/:projectId/schedule/resolve` (replanifie les conflits) |
| Chronomètre | `GET /timer` · `POST /timer/start` `{ workItemId }` (arrête et saisit le chronomètre en cours ailleurs) · `POST /timer/stop` `{ comment? }` (crée la saisie : durée arrondie au centième d'heure, plafonnée à 24 h, jour du démarrage) · `DELETE /timer` (abandon) |
| Export & sauvegardes | `GET /projects/:projectId/timesheet.csv` (mêmes filtres que le tableau des temps ; `;`, virgule décimale, UTF-8 avec BOM pour Excel) · `GET·POST /backups` · `GET /backups/:name` (fichier SQLite) |

### Vues calculées

| Vue du frontend | Route | Contenu |
| :--- | :--- | :--- |
| DashboardView | `GET /projects/:projectId/dashboard` | Budget initial / réalisé / reste, solde (`balance` : `REMAINING` ou `OVER`), % consommé, avancement réel, tendance (`AHEAD` « En avance ✨ », `ON_TRACK`, `BEHIND`), histogramme des 8 statuts × 3 types |
| GanttView | `GET /projects/:projectId/tree` | Phase > Epic > Story > Élément avec numérotation (`1`, `2`, `2.1`, affichée `PHASE 1`, `EPIC 2`, `STORY 2.1`), agrégats, plages de dates des barres, jalons de phase et de projet, plage globale du Gantt ; dépendances (`slackDays`, `conflict`) et chemin critique (`criticalPath`) |
| TimeSheetView | `GET /projects/:projectId/timesheet?epicId=&phaseId=&storyId=&type=&status=` | Par élément : budget, réalisé, bilan ; totaux (nombre, % terminé/résolu, budget, réalisé, reste et solde `balance`) |
| TaskSlideOver | `GET /work-items/:workItemId` | Parent, statut, budget et temps, onglets Description et Journal, saisies de temps, commits liés au `#ID`, prédécesseurs et successeurs avec leur marge |

Les trois vues et la fiche élément acceptent `?hoursPerDay=` pour afficher les jours avec une autre conversion (sélecteur « 1 Jour = 8 Heures ▾ »), sans modifier les heures stockées.

### Règles métier appliquées

- **Avancement** : un élément `RESOLVED` / `CLOSED` est toujours à 100 % (passer à ce statut le fixe à 100 %, une autre valeur est refusée) ; le rouvrir conserve son avancement, à ajuster ensuite. Un élément `REJECTED` sort du budget et de l'avancement, mais son temps passé reste compté dans le réalisé.
- **Statut d'un conteneur** (Phase, Epic, Story) : `OPEN` sans élément ou si tous sont à faire, `REJECTED` si tous sont rejetés, `CLOSED` / `RESOLVED` si tous les éléments retenus sont terminés, sinon `IN_PROGRESS` ; la répartition exacte est fournie dans `statusCounts`.
- **Bilan** (colonne BILAN) : élément terminé → `UNDER` / `ON_BUDGET` / `OVER` selon réalisé − estimé ; élément en cours → `OVER` si l'estimation est déjà dépassée, sinon `REMAINING` (reste à consommer) ; pas de bilan sans estimation ni pour un rejeté.
- **Journal d'avancement** : `POST /work-items/:id/log-entries` avec `{ "text", "at"?, "hours"? }` ajoute `> **18 Oct 2026 - 16h30 (4.5h passées) :** …` en fin de journal, de façon atomique (deux ajouts simultanés ne s'écrasent pas), dans la limite de 100 000 caractères. L'en-tête est informatif : le temps se saisit à part.
- **Dépendances** : « fin → début » entre éléments d'un même projet, sans boucle. Marge = jours libres entre la fin du prédécesseur et le début du successeur (0 = enchaînement serré, négative = conflit). Chemin critique : les éléments qui finissent le plus tard, puis, en remontant, leurs prédécesseurs sans marge. Les éléments rejetés et non planifiés sont ignorés.
- **Déplacements** : un élément, une story ou un epic ne change de parent qu'à l'intérieur de son projet ; il est placé en fin de liste sauf `position` fournie. Supprimer une phase supprime son contenu mais garde ses jalons, rattachés au projet.

### Git & GitHub (`git-engine`)

| Route | Effet |
| :--- | :--- |
| `POST /projects/:projectId/git/scan` | Lit les commits des branches locales du dépôt `localRepoPath` (merges exclus) et rattache ceux qui citent un `#ID` du projet ; renvoie les branches lues, les commits et liens créés, et les `#ID` inconnus |
| `GET /projects/:projectId/commits?workItemId=&limit=` | Commits détectés, les plus récents d'abord |
| `GET · PUT · DELETE /projects/:projectId/git/hook` | État, installation ou retrait du hook `post-commit` qui relance l'analyse après chaque commit |
| `POST /projects/:projectId/github/sync` | Importe les Pull Requests de `githubOwner/githubRepo` et les relie aux éléments |
| `GET /projects/:projectId/pull-requests?state=` | Pull Requests synchronisées |

- **Détection** : regex de `CLAUDE.md` `(feature|task|bug|fix|feat|ref)?\s*#(\d+)`, insensible à la casse ; seuls les éléments du projet sont rattachés. Le suffixe « (#57) » que GitHub ajoute au titre d'un squash désigne la PR #57 et est ignoré. Une analyse est idempotente, ne lit en détail que les nouveaux commits, complète les liens d'un élément créé après coup et retire les commits disparus (amend, rebase, branche supprimée) ; `GIT_SCAN_MAX_COMMITS` (5000 par branche) limite la lecture (`truncated: true`).
- **Branche d'un commit** : la ligne directe (`--first-parent`) de la branche principale (`defaultBranch`, sinon la branche courante), puis celle des autres branches, sinon la première branche qui le contient ; un commit garde la branche où il a été vu en premier (d'où l'intérêt du hook). Une HEAD détachée (rebase, bisect) est sans effet ; worktrees et sous-modules sont acceptés.
- **Hook** : bloc balisé par projet, placé juste après le shebang du `post-commit` existant (il s'exécute même si le script se termine par `exit`), qui appelle `POST …/git/scan` en arrière-plan avec `curl` ; le commit n'est jamais bloqué, même API arrêtée. Par sécurité, l'installation est refusée si les hooks du dépôt sont hors de son dossier Git (`core.hooksPath` global ou versionné, ex. `.husky`), si `post-commit` est un lien symbolique ou un script non shell : dans ces cas, ajouter la ligne `curl` à la main.
- **Pull Requests** : liées par `#ID` dans le titre, puis le corps, puis un numéro en tête de branche (`feature/12345-git-sync-engine`). Statut affiché : brouillon → `IN_PROGRESS`, ouverte → `IN_REVIEW`, fusionnée → `CLOSED`, fermée → `REJECTED`. La synchronisation ne modifie pas le statut des éléments.
- **GitHub** : dépôts publics sans configuration ; pour un dépôt privé ou un quota plus large, `GITHUB_TOKEN` dans `backend/.env` (jeton en lecture des Pull Requests). Une erreur GitHub renvoie `502 GITHUB_ERROR` avec la cause (jeton refusé, quota, dépôt introuvable, réseau).

### IA locale & Claude CLI (`ai-bridge`)

| Route | Effet |
| :--- | :--- |
| `GET /settings` · `PATCH /settings` | `{ onlineMode }` : mode hors ligne (défaut) / en ligne |
| `GET /ai/status?refresh=` | `onlineMode`, `auto` (moteur que retiendrait Auto), `maxDiffChars`, Ollama (joignable, modèles installés, modèle par défaut) et Claude (`available`, `installed`, `loggedIn`, `error`, modèles, version, ouverture de terminal possible) ; `refresh=true` revérifie la connexion de Claude (au plus toutes les 10 s) |
| `POST /ai/breakdown-story` | `{ storyId, engine?: auto / ollama / claude, model?, claudeModel?: sonnet / opus / haiku, instructions? }` → `{ engine, model, items: [{ type, title, description, estimate }] }` ; rien n'est enregistré |
| `POST /stories/:storyId/work-items/batch` | `{ items: [...] }` (1 à 50) : création groupée en fin de story, tout ou rien |
| `POST /ai/summarize-commits` | `{ workItemId, engine?, model?, claudeModel? }` → `{ engine, model, text, commits: [{ shortHash, subject, diff: full / truncated / missing }], warnings }` ; rien n'est enregistré (ajout au journal par `POST /work-items/:id/log-entries`) |
| `GET /ai/claude/prompt?workItemId=` | Prompt proposé et dossier de la session (dépôt local du projet) |
| `POST /ai/claude/launch` | `{ workItemId \| projectId, permissionMode?: default / plan / acceptEdits, prompt? }` → `{ launched, command, promptFile }` (avec `projectId` : session sans prompt) |

Erreurs IA : `403 CLAUDE_OFFLINE` (Claude demandé hors ligne), `502 AI_UNAVAILABLE` (Ollama arrêté ou délai dépassé), `CLAUDE_UNAVAILABLE` (CLI absente ou non connectée : `claude auth login`), `AI_MODEL_MISSING` (`ollama pull <modèle>`), `AI_INVALID_RESPONSE` (réponse inexploitable : réessayer ou changer de modèle), `AI_ERROR`, `504 AI_TIMEOUT` (Claude au-delà de `CLAUDE_TIMEOUT_MS`) ; `400` sans commit lié ou sans dépôt local pour Claude CLI.

---

## 🧩 8. Suite Atelier

Atelier Projets, **Atelier Viz** (BI locale) et **Atelier Tab** (tableur + base typée) partagent un contrat commun : [`docs/SUITE.md`](./docs/SUITE.md) (identique dans les trois dépôts). Le design system d'Atelier Projets en est la référence : Viz et Tab copient `themes/light.css`, `themes/dark.css` et `tokens/colors.css` sans les modifier.

| Application | Interface (dev) | Interface (aperçu / app) | API |
| :--- | :--- | :--- | :--- |
| Atelier Viz | http://127.0.0.1:5173 | http://127.0.0.1:8000 | http://127.0.0.1:8000/api |
| **Atelier Projets** | **http://127.0.0.1:5174** | **http://127.0.0.1:4174** | **http://127.0.0.1:3000/api** |
| Atelier Tab | http://127.0.0.1:5175 | http://127.0.0.1:4175 · app Electron | santé seulement : `:4175/api/health` (app, aperçu), `:5175/api/health` (dev) |

### Sélecteur « Suite Atelier »

L'icône grille à gauche du nom de l'application ouvre le menu des applications de la suite — Atelier Viz, Atelier Tab, Atelier Projets et Atelier Cuisine (l'application courante est cochée) ; un clic ouvre l'application dans un nouvel onglet. Au clavier : `↓` ou `Entrée` ouvre, `↑` `↓` `Début` `Fin` naviguent, `Échap` ferme et rend le focus ; un clic à l'extérieur ferme aussi.

- **Adresses** : constantes de `frontend/src/lib/suite.ts`, surchargeables au build ou au lancement de Vite par `VITE_ATELIER_VIZ_URL`, `VITE_ATELIER_TAB_URL`, `VITE_ATELIER_PROJETS_URL`, `VITE_ATELIER_CUISINE_URL` (ex. `VITE_ATELIER_VIZ_URL=http://127.0.0.1:8001 npm run dev`).
- **En marche / arrêtée** : à chaque ouverture du menu, `GET <app>/api/health` (Viz : http://127.0.0.1:8000/api/health), délai de 1,5 s, sans bloquer le menu. L'application courante (Projets) est toujours « en marche », sans être sondée. Atelier Tab n'a pas d'API de données mais expose une route de santé : `http://127.0.0.1:4175/api/health` (app de bureau, aperçu) et `http://127.0.0.1:5175/api/health` (dev) sont sondées en parallèle, Tab est « en marche » si l'une répond.
- **Atelier Cuisine** (stock, repas, courses et budget du foyer) : app en ligne, `https://atelier-cuisine-iota.vercel.app` (PWA, données Supabase). Pas d'API locale : jamais sondée, marquée « En ligne ». Dans l'app de bureau, `setWindowOpenHandler` → `desktop/lib/suite-launch.cjs` reconnaît cette adresse exacte (https) et ouvre l'app Mac installée (`open -b fr.ateliercuisine.app`), sinon le navigateur par défaut.
- **Pourquoi `no-cors`** : l'API de Viz est sur une autre origine et n'autorise pas forcément CORS ; un `fetch` classique serait bloqué par le navigateur et Viz paraîtrait arrêtée. La sonde utilise donc `mode: 'no-cors'` : une réponse (opaque, statut illisible) signifie « en marche », une erreur réseau ou le délai dépassé « arrêtée ». Limite : une API qui répondrait 500 apparaît « en marche ». Une erreur `ERR_CONNECTION_REFUSED` dans la console du navigateur est normale quand Viz est arrêtée.

### Import depuis Atelier Tab (DataFlow v2.1.0)

Deux façons d'importer une table d'Atelier Tab :

1. **Fichier** : menu des projets › « Importer depuis Atelier Tab… » (ou **Paramètres du projet › Suite Atelier**). Choisir le fichier JSON exporté par Atelier Tab, le projet cible (par défaut le projet du même nom, créé au besoin) et le type des nouveaux éléments ; l'aperçu (calculé par l'API, rien n'est écrit) liste les créations, mises à jour, lignes inchangées ou ignorées et les avertissements ; « Importer » écrit puis affiche le résumé.
2. **Webhook** : dans Atelier Tab, préréglage « Atelier Projets (local) » → `http://127.0.0.1:3000/api/imports/atelier-tab`.

| Route | Effet |
| :--- | :--- |
| `POST /imports/atelier-tab/preview` | Aperçu de l'import (ne modifie rien) : destination, compteurs, avertissements, action prévue par ligne |
| `POST /imports/atelier-tab` | Crée ou met à jour → `{ projectId, storyId, created, updated, unchanged, skipped, warnings, items: [{ recordId, workItemId, action, … }] }` |

- **Paramètres** : `?projectId=` (sinon projet nommé comme `project.name`, créé s'il n'existe pas), `?type=TASK|FEATURE|BUG` (`TASK` par défaut).
- **Rangement** : Phase « Imports Atelier Tab » › Epic `<workspace.name>` › Story `<source_table.name ?? project.name>`, retrouvés par leur titre et créés au besoin. Une table **déjà importée** garde sa story : les nouvelles lignes rejoignent celle qui regroupe le plus de ses éléments existants (dans le projet `?projectId=` s'il est donné), même si le projet, la story ou la table ont été renommés ou les éléments déplacés (avertissement « Nouveaux éléments rangés avec ceux déjà importés… » si le chemin diffère de l'enveloppe). Aucun conteneur n'est créé quand toutes les lignes existent déjà ; la réponse désigne alors le projet et la story de ces éléments.
- **Colonnes** (`atelier_mapping`) : `entity_title` → titre (ligne ignorée avec avertissement s'il est vide), `workflow_state` → statut (codes, libellés et synonymes « Ouvert », « Nouveau », « Fait », « Terminé », « Clos », « Bloqué », « Résolu », « Rejeté », « Annulé », sans tenir compte de la casse ni des accents ; inconnu → « À faire » + avertissement), `start_date` / `due_date` → dates, `description` → début de la description ; les autres colonnes (montants HT/TTC, responsable, quantité, case à cocher, `custom`) forment le tableau Markdown « Données Atelier Tab » de la description. Les erreurs de formule (`#DIV/0!`…) sont ignorées avec un avertissement.
- **Réimport** : chaque élément garde `externalRef = "atelier-tab:<source_table.id ?? project.id>:<record_id>"` (colonne unique de `WorkItem`) ; un nouvel import met à jour l'élément au lieu d'en créer un autre (`updated`, ou `unchanged` si rien n'a changé). Seuls titre, statut, dates et description sont mis à jour : estimation, temps, journal et position restent ceux d'Atelier Projets.
- **`Idempotency-Key`** : la réponse d'un import est enregistrée (table SQLite `IdempotencyRecord`, portée `imports.atelier_tab`, dans la même transaction que l'import, conservée 30 jours) ; la même clé rejouée renvoie la même réponse (en-tête `Idempotency-Replayed: true`) sans réimporter, même après un redémarrage de l'API. Réutilisée pour un autre contenu : `409 IDEMPOTENCY_KEY_REUSED`.
- **`X-Atelier-Schema-Version`** : s'il est présent et différent de `2.1.0` → `422 UNSUPPORTED_SCHEMA_VERSION` (de même pour `schema_version` dans le corps).
- **Jeton** : `ATELIER_IMPORT_TOKEN` dans `backend/.env` ; défini, l'en-tête `Authorization: Bearer <jeton>` est exigé (`401` sinon) des **appels externes** : sans en-tête `Origin` (webhook, relais de l'app de bureau Tab, `curl`) ou d'une autre origine (Atelier Tab dans le navigateur) — à renseigner dans le webhook d'Atelier Tab. L'interface d'Atelier Projets n'en a pas besoin : règle « même origine » = `Origin` égale exactement à `http(s)://<Host>` (schéma, nom et port ; le relais `/api` de Vite garde le `Host` du navigateur). Le jeton est vérifié dès la réception (hook `onRequest`), avant la lecture du corps ; comparaison des empreintes SHA-256 à temps constant. Sans jeton configuré, l'en-tête est ignoré.
- **CORS** : seules ces deux routes répondent aux autres origines `http://127.0.0.1:<port>` et `http://localhost:<port>` (Atelier Tab dans le navigateur), méthodes `POST, OPTIONS`, en-têtes `Content-Type, Authorization, Idempotency-Key, X-Atelier-Schema-Version`. L'app de bureau Atelier Tab relaie ses envois depuis son processus principal, **sans en-tête `Origin`** : c'est un appel local ordinaire. L'origine `null` est **refusée** partout (`403`, sans en-tête CORS) : n'importe quelle page web peut l'envoyer (iframe sandbox, URL `data:`, fichier local). Le garde « API locale » reste actif : l'en-tête `Host` doit être local et un autre site (`Origin` étranger) est refusé (`403`).

```bash
curl -X POST 'http://127.0.0.1:3000/api/imports/atelier-tab' \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: 2f1c…' -H 'X-Atelier-Schema-Version: 2.1.0' \
  --data @planning-lots.json
```

### Jeux de données pour Atelier Viz

Lecture seule, calculés par le backend (Atelier Viz les importe avec son connecteur « Atelier Projets », adresse `http://127.0.0.1:3000`) :

| Route | Contenu |
| :--- | :--- |
| `GET /exports/datasets` | `[{ name, label, description, rowCount }]` |
| `GET /exports/datasets/:name?projectId=` | `{ name, label, generatedAt, columns: [{ key, label, type }], rows }` — tous les projets, ou un seul avec `projectId` |

| Jeu | Colonnes (`key`) |
| :--- | :--- |
| `work-items` | `id`, `projet`, `phase`, `epic`, `story`, `type`, `statut` (libellé), `statut_code`, `priorite`, `titre`, `heures_estimees`, `heures_passees` (somme des saisies de temps), `ecart_heures` (passées − estimées, vide sans estimation), `avancement`, `debut`, `echeance`, `cree_le`, `maj_le` |
| `time-entries` | `id`, `element_id`, `element`, `type`, `projet`, `date`, `heures`, `commentaire` |
| `milestones` | `id`, `projet`, `phase` (vide pour un jalon de projet), `nom`, `date`, `atteint` |

Types : `string`, `number`, `date` (`AAAA-MM-JJ`), `datetime` (ISO 8601), `boolean` ; les clés sont en `snake_case` sans accent, les libellés en français.

### Nœud Atelier (Atelier Nexus, contrat `atelier-node/1`)

Atelier Nexus enchaîne les applications de la suite dans des workflows ([`docs/SUITE.md`](./docs/SUITE.md) §7) : Projets y est un **nœud HTTP** qui décrit ses actions, échange des tables `atelier-table/1` et publie ses événements. Tout reste local (garde « API locale » inchangée) ; aucune action ne touche au mode en ligne.

| Route | Effet |
| :--- | :--- |
| `GET /atelier/manifest` | `{ contract: "atelier-node/1", app: "projets", transport: "http", actions, events }` : schémas d'entrée et de sortie (JSON Schema 2020-12) dérivés des schémas TypeBox des routes |
| `GET /atelier/events?since=&limit=&types=` | `{ events: [{ seq, type, at, subject: { kind, id, label }, data }], next, oldest, gap }` — `since` exclusif (sans `since` : les plus récents), `limit` ≤ 500 (100), `types=a,b` |

| Action (`id`) | Type | Route | Sortie | Idempotence |
| :--- | :--- | :--- | :--- | :--- |
| `projects.list` | lecture | `GET /atelier/projects` | json | — |
| `projects.tree` | lecture | `GET /atelier/projects/{project_id}/tree` | json | — |
| `work_items.list` | lecture | `GET /atelier/projects/{project_id}/work-items?status=&type=&story_id=&q=&updated_since=` | `atelier-table/1` (colonnes du jeu `work-items`) | — |
| `work_items.get` | lecture | `GET /atelier/work-items/{work_item_id}` | json | — |
| `work_items.create` | écriture | `POST /atelier/stories/{story_id}/work-items` `{ type, title, status?, priority?, description?, estimated_hours?, due_date?, start_date? }` | json (`{ id, … }`) | `header` |
| `work_items.update` | écriture | `PATCH /atelier/work-items/{work_item_id}` `{ status?, progress?, priority?, due_date?, title? }` | json | `natural` |
| `work_items.log` | écriture | `POST /atelier/work-items/{work_item_id}/log-entries` `{ text, at?, hours? }` | `{ work_item_id, at, entry }` | `header` |
| `time_entries.create` | écriture | `POST /atelier/work-items/{work_item_id}/time-entries` `{ hours, spent_on?, comment? }` | json | `header` |
| `milestones.list` | lecture | `GET /atelier/projects/{project_id}/milestones` | `atelier-table/1` | — |
| `milestones.reach` | écriture | `POST /atelier/milestones/{milestone_id}/reach` `{ reached_at? }` (sans effet si déjà atteint) | json | `natural` |
| `tables.get` | lecture | `GET /atelier/tables/{name}?project_id=` (`work-items`, `time-entries`, `milestones`) | `atelier-table/1` | — |
| `imports.atelier_tab` | écriture | `POST /imports/atelier-tab` (route existante, corps DataFlow) | json (camelCase) | `header` |

- **Format** : entrées et sorties en `snake_case` ; les actions délèguent aux services existants (mêmes règles métier, mêmes validations) et convertissent leurs réponses. Les routes existantes ne changent pas.
- **Événements** (émis par les services, dans la transaction de l'écriture) : `projets.work_item.created` (aussi un par élément d'une création par lot), `projets.work_item.updated` (`fields` : champs changés), `projets.work_item.status_changed` (avec `updated`), `projets.work_item.deleted` (aussi pour les éléments emportés par la suppression d'une story, d'un epic, d'une phase ou d'un projet), `projets.time_entry.created` (saisie ou arrêt du chronomètre), `projets.milestone.reached` (`reachedAt` posé), `projets.import.completed` (un seul par import). `data` ne contient que des identifiants (chaînes), statuts, dates et nombres. Table `AtelierEvent` : `seq` jamais réutilisé ; conservés : les 1 000 derniers, et tous ceux de moins de 30 jours ; `gap: true` si des événements postérieurs à `since` ont été purgés.
- **`Idempotency-Key`** (actions `header`) : même mécanisme que l'import (table `IdempotencyRecord`, une portée par action, dans la transaction de l'écriture, 30 jours) — même clé et même contenu (chemin, requête, corps) → même réponse avec `Idempotency-Replayed: true`, sans écriture ni événement ; autre contenu → `409 IDEMPOTENCY_KEY_REUSED`. Nexus envoie `nexus:<run>:<step>`.
- **Erreurs** : `{ "detail": "message", "code": "NOT_FOUND | VALIDATION | CONFLICT | IDEMPOTENCY_KEY_REUSED | FORBIDDEN_HOST | FORBIDDEN_ORIGIN | …" }`.

```bash
curl -s http://127.0.0.1:3000/api/atelier/manifest | jq '.actions[].id'
curl -s -X POST http://127.0.0.1:3000/api/atelier/stories/1/work-items \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: nexus:run-1:step-2' \
  -d '{"type":"TASK","title":"Relire le contrat","estimated_hours":2}'
curl -s 'http://127.0.0.1:3000/api/atelier/events?since=0&types=projets.work_item.status_changed'
```

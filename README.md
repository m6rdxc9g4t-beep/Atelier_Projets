# 🚀 Atelier_Projets — Gestionnaire de Projets Agile, Git & IA Locale

> **Philosophie :** L'alliance de la rigueur d'**OpenProject** (Gantt, Budgets, Hiérarchie stricte, Phases & Milestones) et de l'esthétique moderne, colorée et fluide de **Linear / GitHub**, propulsée en local avec intégration native Git/GitHub et moteurs IA locaux (Ollama : Qwen, Gemma) + Claude CLI.

Ce fichier est la **spécification fonctionnelle et visuelle** de référence. Les règles d'architecture et les conventions de code sont dans [`CLAUDE.md`](./CLAUDE.md).

---

## 🚦 État d'avancement

| Étape | Contenu | État |
| :--- | :--- | :--- |
| **Phase 1 — Socle** | Monorepo (npm workspaces), design system (tokens officiels + thèmes clair/sombre), backend Fastify + TypeScript + Prisma/SQLite, migration initiale, seed de démo « App E-Commerce v2 » | ✅ Validée |
| **Phase 2 — API REST métier** | CRUD de la hiérarchie, temps et jalons, journal d'avancement horodaté, vues calculées (dashboard, arborescence/Gantt, tableau des temps, fiche tâche), OpenAPI, tests | ✅ Terminée — en attente de validation |
| Phases suivantes | `git-engine` (commits & Pull Requests), `ai-bridge` (Ollama, Claude CLI), frontend React | ⏳ À venir |

## ⚡ Démarrage rapide

**Prérequis :** Node.js `22.12+` ou `24+` (LTS conseillée : 24, voir `.nvmrc`), npm 10+, Git.

```bash
npm install            # installe les 3 workspaces
npm run setup          # génère le client Prisma, crée la base SQLite (migrations) et insère la démo
npm run dev:backend    # API Fastify sur http://127.0.0.1:3000 — documentation : http://127.0.0.1:3000/api/docs
```

| Commande (racine) | Effet |
| :--- | :--- |
| `npm run setup` | `prisma generate` → `prisma migrate deploy` → seed de démo |
| `npm run dev:backend` | Serveur Fastify en mode watch (`tsx`) |
| `npm run build:backend` | Compilation TypeScript → `backend/dist/` (`npm start -w @atelier/backend` pour lancer) |
| `npm test` | Tests du backend (domaine, CRUD, vues calculées sur la démo), sur une base SQLite temporaire |
| `npm run db:migrate -- --name <nom>` | Nouvelle migration après modification du schéma (`prisma migrate dev`), puis régénération du client |
| `npm run db:seed` | Réinsère le projet de démo « App E-Commerce v2 » (idempotent) |
| `npm run db:reset` | Réinitialise la base, rejoue les migrations puis le seed |
| `npm run db:studio` | Ouvre Prisma Studio sur la base locale |
| `npm run check` | Contrôle des tokens du design system + `tsc --noEmit` du backend |

La configuration est facultative : sans fichier `.env`, la base est créée dans `backend/prisma/dev.db` et l'API écoute sur `127.0.0.1:3000`. Pour changer ces valeurs, copier `backend/.env.example` en `backend/.env`.

---

## 🏛️ 1. Architecture du Dépôt (Monorepo Strict)

Le développement d'**Atelier_Projets** est strictement découpé en **3 piliers isolés** pour garantir un code propre, modulaire et maintenable :

```text
Atelier_Projets/
├── 📁 design-system/          # PILIER 1 : UI/UX, Tokens CSS, Thèmes (Clair/Sombre), Composants isolés
│   ├── tokens/                # ✅ colors.css : 7 types + 8 statuts (codes hex officiels)
│   ├── themes/                # ✅ light.css, dark.css (CSS natif pur, exportables vers toutes tes applications)
│   └── components/            # ⏳ Boutons, Badges, Modales, Cartes, Barres de progression, Tableaux
│
├── 📁 frontend/               # PILIER 2 : Client Web (React + TypeScript + Vite + Tailwind CSS) — ⏳
│   ├── src/views/             # DashboardView, GanttView, HierarchyView, TimeSheetView, TaskSlideOver
│   ├── src/store/             # Gestion d'état (Zustand)
│   └── src/services/          # Client API REST/WebSocket vers le backend
│
├── 📁 backend/                # PILIER 3 : API & Logique Métier (Node.js + Fastify + TypeScript)
│   ├── prisma/                # ✅ Schéma SQLite (100% local), migrations, projet de démo et seed
│   ├── src/domain/            # ✅ Règles métier pures : durées j/h, avancement, statut dérivé, bilans, journal
│   ├── src/schemas/           # ✅ Contrat de l'API (TypeBox → validation, types, OpenAPI)
│   ├── src/services/          # ✅ Cas d'usage (Prisma) : CRUD et vues calculées
│   ├── src/routes/            # ✅ Routes REST Fastify sous /api (documentation : /api/docs)
│   ├── test/                  # ✅ Tests node:test (domaine, CRUD, vues sur la démo)
│   ├── src/git-engine/        # ⏳ Hooks Git locaux, parsing des commits (#ID), Sync GitHub API
│   └── src/ai-bridge/         # ⏳ Connecteur Ollama (Qwen / Gemma) & exécution Claude CLI
│
├── CLAUDE.md                  # Règles d'architecture et conventions de code pour Claude CLI
└── README.md                  # Spécification fonctionnelle et visuelle d'Atelier_Projets
```

---

## 🎨 2. Design System : Thèmes, Types & Statuts

Le système de design repose sur des variables CSS strictes réutilisables dans toutes tes applications (`design-system/themes/`).

### A. Fondations des Thèmes (Clair & Sombre)

| Variable CSS | ☀️ Mode Clair | 🌙 Mode Sombre | Usage |
| :--- | :--- | :--- | :--- |
| `--bg-main` | `#F8FAFC` | `#0B0F19` | Fond principal de l'application |
| `--bg-surface` | `#FFFFFF` | `#111827` | Cartes, Tableaux, Panneaux latéraux |
| `--bg-elevated` | `#F1F5F9` | `#1E293B` | Modales, Menus déroulants, Survols |
| `--text-primary` | `#0F172A` | `#F8FAFC` | Texte principal |
| `--text-muted` | `#64748B` | `#94A3B8` | Texte secondaire, métadonnées |
| `--border-color` | `#E2E8F0` | `#1E293B` | Bordures fines et séparateurs |

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
<!-- Thème clair par défaut ; bascule en sombre via l'attribut data-theme -->
<html data-theme="dark">
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

- **Unités :** toutes les durées sont stockées en **heures** ; la conversion en jours utilise `Project.hoursPerDay` (1 jour = 8 h par défaut).
- **Statuts et types** sont des enums Prisma (`WorkItemStatus`, `WorkItemType`) dont les valeurs correspondent exactement à `CLAUDE.md`.
- **Suppression :** en cascade le long de la hiérarchie ; un jalon dont la phase est supprimée reste rattaché au projet.
- **Agrégats :** Phases, Epics et Stories ne stockent ni statut ni avancement ; le backend les calcule à partir de leurs WorkItems (budget, temps réalisé, avancement).

---

## 🖥️ 4. Maquettes Visuelles des Interfaces

> Le seed de démo (`npm run db:seed`) reproduit les données de ces maquettes : budget 45.0 j (360 h), réalisé 28.5 j (228 h), Gantt (phases de 15 j et 20 j, jalons du 15 oct. et du 2 nov.), tableau des temps (#101, #102, #103, #12345, #205 : 12 j budgétés, 72 h réalisées) et fiche #12345 avec ses deux commits. La Pull Request #42 de la fiche arrivera avec la synchronisation GitHub (modèle à ajouter dans la phase `git-engine`).
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

## 🤖 5. Fonctionnalités IA Locale (Ollama : Qwen / Gemma) & Claude CLI

1. **Découpage Agile assisté (Gemma / Qwen) :** Bouton `[✨ Générer les sous-tâches]` dans une Story pour proposer automatiquement les Features (`#2A9A30`) et Tasks (`#1B66A3`) avec estimation du budget en jours.
2. **Auto-Rédaction du Journal d'Avancement :** Bouton `[🤖 Résumer mes commits]` dans l'onglet 2 d'une tâche qui lit les `git diff` des commits liés à `#12345` et rédige automatiquement l'explication technique du travail réalisé.
3. **Exécution Claude CLI :** Bouton d'action rapide sur une tâche permettant de lancer Claude CLI dans le dépôt Git du projet avec la description de la tâche `#12345` directement injectée en prompt.

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

---

## 🔌 7. API REST du backend

Base : `http://127.0.0.1:3000/api` — documentation interactive : **`/api/docs`**. Le frontend affiche ces réponses telles quelles : les conversions, agrégats et bilans sont calculés ici.

### Conventions

- **Durées** : stockées en heures, toujours renvoyées sous la forme `{ "hours": 24, "days": 3 }` (1 jour = `hoursPerDay` du projet, 8 h par défaut). En écriture, une estimation ou un budget se saisit soit en heures (`estimatedHours`, `budgetHours`), soit en jours (`estimatedDays`, `budgetDays`) ; les saisies de temps se font en heures.
- **Dates** : dates calendaires en `AAAA-MM-JJ` ; horodatages en ISO 8601 (UTC).
- **Écriture** : `POST` → `201` avec la ressource créée, `PATCH` partiel → `200`, `DELETE` → `204`. Les corps JSON sont typés strictement : un champ inconnu, `"50"` à la place de `50` ou `null` sur un champ obligatoire sont refusés ; `null` efface un champ facultatif (dates, estimation, budget, dépôt…).
- **Erreurs** : `{ "statusCode", "error", "code", "message" }` — `VALIDATION_ERROR` / `BAD_REQUEST` (400), `NOT_FOUND` (404), `CONFLICT` (409).

### Ressources

| Domaine | Routes |
| :--- | :--- |
| Projets | `GET·POST /projects` · `GET·PATCH·DELETE /projects/:projectId` |
| Hiérarchie | `GET·POST /projects/:projectId/phases` · `GET·PATCH·DELETE /phases/:phaseId` · `GET·POST /phases/:phaseId/epics` · `GET·PATCH·DELETE /epics/:epicId` · `GET·POST /epics/:epicId/stories` · `GET·PATCH·DELETE /stories/:storyId` |
| Éléments | `GET /projects/:projectId/work-items?type=&status=&phaseId=&epicId=&storyId=&q=` (`q` : titre sans tenir compte de la casse ni des accents, ou `#ID`) · `GET·POST /stories/:storyId/work-items` · `GET·PATCH·DELETE /work-items/:workItemId` · `POST /work-items/:workItemId/log-entries` |
| Temps | `GET·POST /work-items/:workItemId/time-entries` · `PATCH·DELETE /time-entries/:timeEntryId` |
| Jalons | `GET·POST /projects/:projectId/milestones` · `GET·PATCH·DELETE /milestones/:milestoneId` (`reachedAt` : date d'atteinte, jamais dans le futur ; `null` = non atteint) |

### Vues calculées

| Vue du frontend | Route | Contenu |
| :--- | :--- | :--- |
| DashboardView | `GET /projects/:projectId/dashboard` | Budget initial / réalisé / reste, % consommé, avancement réel, tendance (`AHEAD` « En avance ✨ », `ON_TRACK`, `BEHIND`), histogramme des 8 statuts × 3 types |
| GanttView, HierarchyView | `GET /projects/:projectId/tree` | Phase > Epic > Story > Élément avec codes (`PHASE 1`, `EPIC 2`, `STORY 2.1`), agrégats, plages de dates des barres, jalons de phase et de projet, plage globale du Gantt |
| TimeSheetView | `GET /projects/:projectId/timesheet?epicId=&phaseId=&storyId=&type=&status=` | Par élément : budget, réalisé, bilan ; totaux (nombre, % terminé/résolu, budget, réalisé, reste) |
| TaskSlideOver | `GET /work-items/:workItemId` | Parent, statut, budget et temps, onglets Description et Journal, saisies de temps, commits liés au `#ID` |

Les trois vues acceptent `?hoursPerDay=` pour afficher les jours avec une autre conversion (sélecteur « 1 Jour = 8 Heures ▾ »), sans modifier les heures stockées.

### Règles métier appliquées

- **Avancement** : un élément `RESOLVED` / `CLOSED` est toujours à 100 % (passer à ce statut le fixe à 100 %, une autre valeur est refusée) ; le rouvrir conserve son avancement, à ajuster ensuite. Un élément `REJECTED` sort du budget et de l'avancement, mais son temps passé reste compté dans le réalisé.
- **Statut d'un conteneur** (Phase, Epic, Story) : `OPEN` sans élément ou si tous sont à faire, `REJECTED` si tous sont rejetés, `CLOSED` / `RESOLVED` si tous les éléments retenus sont terminés, sinon `IN_PROGRESS` ; la répartition exacte est fournie dans `statusCounts`.
- **Bilan** (colonne BILAN) : élément terminé → `UNDER` / `ON_BUDGET` / `OVER` selon réalisé − estimé ; élément en cours → `OVER` si l'estimation est déjà dépassée, sinon `REMAINING` (reste à consommer) ; pas de bilan sans estimation ni pour un rejeté.
- **Journal d'avancement** : `POST /work-items/:id/log-entries` avec `{ "text", "at"?, "hours"? }` ajoute `> **18 Oct 2026 - 16h30 (4.5h passées) :** …` en fin de journal, de façon atomique (deux ajouts simultanés ne s'écrasent pas), dans la limite de 100 000 caractères. L'en-tête est informatif : le temps se saisit à part.
- **Déplacements** : un élément, une story ou un epic ne change de parent qu'à l'intérieur de son projet ; il est placé en fin de liste sauf `position` fournie. Supprimer une phase supprime son contenu mais garde ses jalons, rattachés au projet.

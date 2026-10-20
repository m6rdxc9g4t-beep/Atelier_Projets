# 🧠 Instruction_Atelier_Projets.md — Règles d'Architecture & Directives pour Atelier_Projets

Tu es l'architecte principal du projet **Atelier_Projets**. Tu dois systématiquement consulter `README.md` pour les spécifications fonctionnelles et visuelles, et respecter **strictement** les règles ci-dessous à chaque modification de code.

---

## 🏛️ 1. Séparation Stricte des 3 Piliers (Règle d'Or)

Le dépôt est un Monorepo divisé en 3 espaces hermétiques. **Ne mélange jamais les responsabilités** :

1. **`/design-system`** :
   - Contient UNIQUEMENT les variables CSS (`tokens/`), les thèmes (`themes/light.css`, `themes/dark.css`) et les composants UI purs.
   - **Règle d'exportabilité :** Les fichiers de thèmes (`light.css` et `dark.css`) doivent être écrits en CSS natif pur (Custom Properties `--var`), sans dépendance métier, afin de pouvoir être copiés-collés et réutilisés tels quels dans d'autres applications externes.
   - Aucune couleur en dur (`#hex`) n'est autorisée dans `/frontend` : tout doit passer par les variables CSS de `/design-system`.

2. **`/backend`** :
   - Stack : **Node.js + Fastify + TypeScript + Prisma (SQLite)**.
   - Gère toute la logique métier, les calculs de budget (1 jour = X heures paramétrables, défaut 8h), l'analyse Git locale (`simple-git`), la synchronisation GitHub API (`@octokit/rest`) et le pont IA local (`ollama` pour Qwen/Gemma).
   - Aucune logique d'affichage ici. Expose une API REST propre et typée.

3. **`/frontend`** :
   - Stack : **React + TypeScript + Vite + Tailwind CSS + Zustand + Lucide Icons**.
   - Consomme le `/design-system` pour le style et appelle `/backend` via des services dédiés (`src/services/`).
   - Ne fait aucun calcul métier complexe (les agrégations de temps, d'écarts de budget et d'histogrammes viennent du backend).

---

## 🎨 2. Respect Absolu des Couleurs & Statuts

Tu dois utiliser **exactement** ces codes hexadécimaux dans `design-system/tokens/colors.css` :

### Types d'éléments (Hiérarchie & Gantt)
- `PHASE` : `#FF8F2B` (`--type-phase`)
- `MILESTONE` : `#2A9A30` (`--type-milestone`)
- `EPIC` : `#8250DF` (`--type-epic`)
- `STORY` : `#6F42C1` (`--type-story`)
- `FEATURE` : `#2A9A30` (`--type-feature`)
- `TASK` : `#1B66A3` (`--type-task`)
- `BUG` : `#D64545` (`--type-bug`)

### Statuts du Workflow (8 statuts obligatoires)
- `OPEN` (À faire) : `#64748B` (`--status-open`)
- `IN_PROGRESS` (En cours) : `#2563EB` (`--status-progress`)
- `IN_REVIEW` (En revue) : `#8B5CF6` (`--status-review`)
- `ON_HOLD` (En attente) : `#F59E0B` (`--status-hold`)
- `BLOCKED` (Bloquée) : `#EA580C` (`--status-blocked`)
- `RESOLVED` (Résolue) : `#0D9488` (`--status-resolved`)
- `CLOSED` (Terminée) : `#16A34A` (`--status-closed`)
- `REJECTED` (Rejetée) : `#DC2626` (`--status-rejected`)

---

## 🔗 3. Spécificités Métier Obligatoires

1. **Hiérarchie stricte :** `Project` > `Phase` > `Epic` > `Story` > `WorkItem` (`FEATURE` | `TASK` | `BUG`). Les `Milestone` sont rattachés à une `Phase` ou un `Project`.
2. **Double onglet sur chaque WorkItem :**
   - Champ `description` (Markdown) : Ce qu'il faut faire + critères d'acceptation.
   - Champ `implementationLog` (Markdown + entrées horodatées) : Comment la tâche a été réalisée techniquement.
3. **Moteur Git & GitHub (`git-engine`) :**
   - Scanner les commits du dépôt local lié au projet.
   - Détecter par Regex les patterns `(feature|task|bug|fix|feat|ref)?\s*#(\d+)` (insensible à la casse) pour lier automatiquement le commit (hash, auteur, date, message, branche) au `WorkItem` `#ID`.
4. **Pont IA Locale (`ai-bridge`) :**
   - Connexion par défaut sur `http://localhost:11434` (Ollama) avec support des modèles configurables (ex: `qwen2.5-coder`, `gemma3`).
   - 2 endpoints IA : `/api/ai/breakdown-story` (découpe une Story en Features/Tasks avec budget en jours) et `/api/ai/summarize-commits` (génère le texte de l'onglet "Journal d'avancement" à partir des `git diff` des commits liés au `#ID`).
   - **Deux moteurs** (`docs/SUITE.md` §5) : Ollama (local) et **Claude** par la CLI Claude Code (`ai-bridge/claude-print.ts`). Requêtes : `engine: 'auto' | 'ollama' | 'claude'`, `claudeModel: 'sonnet' | 'opus' | 'haiku'` ; **Auto** = Claude si en ligne et disponible, sinon Ollama ; la réponse indique `engine` et `model`. Routage dans `services/ai.ts` (`resolveEngine`), jamais dans le frontend.
   - **Mode hors ligne / en ligne** : réglage `onlineMode` du backend (`services/settings.ts`, table `AppSetting`), **hors ligne par défaut**. Hors ligne, rien ne part vers Claude : `engine: 'claude'` → **403 `CLAUDE_OFFLINE`**, Auto → Ollama, et `claude auth status` n'est même pas lancé.
   - **Isolation de Claude** (à ne jamais assouplir) : `claude -p --safe-mode --output-format json --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence --max-turns <n> --model <alias> --system-prompt <prompt>` (+ `--json-schema` pour une sortie structurée), conversation sur l'entrée standard (jamais en argument), dossier temporaire vide, `ANTHROPIC_API_KEY` retirée, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, délai `CLAUDE_TIMEOUT_MS`. **Jamais d'outil** pour la CLI. Exécutable : `CLAUDE_CLI`, `PATH`, puis `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` ; disponibilité = exécutable + `claude auth status` (cache 60 s). Exécutant injectable : les tests n'appellent jamais la vraie CLI.
   - Seul le contenu annoncé par la ligne bouclier part vers Claude (story ou élément ; messages et diffs des commits liés, tronqués à `AI_MAX_DIFF_CHARS`). Toute nouvelle donnée envoyée doit être ajoutée à cette ligne (`SENDS` dans `components/AiDialogs.tsx`).
   - La **session interactive** dans un terminal (`ai-bridge/claude-cli.ts`, `POST /api/ai/claude/launch`) est une fonction distincte, indépendante du moteur et du mode.

---

## 🛠️ 4. Méthode de Travail de Claude CLI

- **Procède toujours par étapes validées.** Ne génère pas tout le projet d'un seul coup sans tester.
- Après chaque étape, vérifie que le code compile (`tsc --noEmit`) et qu'il n'y a aucune erreur.
- Écris des commits Git propres en suivant la convention : `feat(scope): description #ID` ou `chore(setup): initial architecture`.

---

## 🧩 5. Suite Atelier

Atelier Projets fait partie de la **Suite Atelier** (avec Atelier Viz et Atelier Tab). Le contrat commun — design system de référence, ports (interface 5174, aperçu 4174, API 3000, `strictPort`), thème (`data-theme` **et** classe `dark` sur `<html>`), sélecteur « Suite Atelier », import DataFlow depuis Atelier Tab et jeux de données pour Atelier Viz — est dans [`docs/SUITE.md`](./docs/SUITE.md), identique dans les trois dépôts : toute modification s'y fait dans les trois à la fois, avec un test côté producteur et côté consommateur.

- `design-system/themes/*.css` et `tokens/colors.css` sont copiés tels quels par Viz et Tab : toute modification se répercute dans leurs copies.
- Frontend : adresses de la suite dans `frontend/src/lib/suite.ts` (surcharges `VITE_ATELIER_*_URL`), thème dans `frontend/src/lib/theme.ts`.
- Backend : `routes/suite.ts` (mince) → `services/atelier-tab-import.ts`, `services/exports.ts` ; règles pures dans `domain/atelier-tab.ts` ; CORS limité aux deux routes d'import (`http/suite-cors.ts`, `config: { suiteCors: true }`), origine `null` **refusée** (l'app de bureau Tab relaie sans `Origin`) ; jeton `ATELIER_IMPORT_TOKEN` vérifié en `onRequest` (avant le corps), exigé des appels externes seulement (`isSameOriginRequest`).

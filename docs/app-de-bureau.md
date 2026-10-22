# Application de bureau (macOS et Windows) — architecture

L'application de bureau d'Atelier Projets est une **enveloppe Electron** (`desktop/`) : une fenêtre native qui met le dépôt
à jour si besoin, démarre l'API compilée (`backend/dist`, Node du système) et sert l'interface compilée (`frontend/dist`)
sur l'adresse « app » de la Suite Atelier, `http://127.0.0.1:4174`. Elle ne contient aucune logique métier ni aucun style.
Contrat commun : [`docs/SUITE.md`](./SUITE.md) §8 (mise à jour au lancement) et §9 (Windows, ouverture des apps entre elles).

## Modules

| Fichier | Rôle | Testé par |
|---|---|---|
| `desktop/main.cjs` | Processus principal : fenêtre, écran de démarrage, mise à jour, API, serveur de l'interface, menu ; mode `--mise-a-jour-seulement` | — (Electron) |
| `desktop/lib/environment.cjs` | Variables héritées ignorées au lancement ; environnement minimal transmis à une autre app (§9.4) | `test/environment.test.cjs` |
| `desktop/lib/paths.cjs` | Emplacements par système : journaux, données hors dépôt (§9.2) | `test/environment.test.cjs` |
| `desktop/lib/prepare.cjs` | Mise à jour (§8) : plan, `npm ci`, Prisma, sauvegarde + migrations, compilation à part, verrou, journal | `test/prepare.test.cjs` (npm simulé) |
| `desktop/lib/node-path.cjs` | Recherche de Node.js / npm (Finder, menu Démarrer), commande npm sans shell | `test/node-path.test.cjs` |
| `desktop/lib/suite-launch.cjs` | Ouverture d'une autre app de la suite (macOS `open -b`, Windows registre) | `test/suite-launch.test.cjs` |
| `desktop/lib/backend.cjs`, `ui-server.cjs` | Lancement de l'API, serveur de `frontend/dist` avec relais `/api` | `test/desktop.test.cjs` |
| `desktop/prepare.cjs` | Même mise à jour depuis un terminal (scripts d'installation) | — |
| `scripts/macos/install-desktop.sh` | macOS : crée `~/Applications/Atelier Projets.app` | — |
| `scripts/windows/install.ps1` | Windows : lanceur, raccourcis, première mise à jour, enregistrement | CI `windows` |

## Lanceur : une copie d'Electron qui lit le code du dépôt

L'app installée est un **lanceur** (§8.1) : une copie de l'Electron du dépôt (`node_modules/electron/dist`) dont
`resources/app/main.cjs` fixe `ATELIER_REPO` puis charge `desktop/main.cjs` **dans le dépôt**. Un `git pull` suffit donc à
changer le code exécuté ; le lanceur n'est refait (script d'installation relancé) qu'après un déplacement du dépôt ou un
changement de version d'Electron (signalé dans `app.log`).

| | macOS | Windows |
|---|---|---|
| Lanceur | `~/Applications/Atelier Projets.app` (`Electron.app` copiée, Info.plist, signature ad hoc) | `%LOCALAPPDATA%\Programs\Atelier_Projets\Atelier Projets.exe` (`electron.exe` copié et renommé) |
| Ouverture | Finder, Dock | Menu Démarrer › Atelier › Atelier Projets ; Bureau (sauf `-SansBureau`) |
| Icône | `AppIcon.icns` (depuis `scripts/macos/AppIcon.png`) | `scripts/windows/atelier-projets.ico` (même image, 16 à 256 px) : raccourcis et fenêtre |
| Console | aucune | aucune : `electron.exe` est une application graphique ; API, npm, git et reg.exe lancés avec `windowsHide` |

**Pourquoi une copie hors du dépôt, et non l'Electron de `node_modules` ?** La mise à jour remplace `node_modules`
(`npm ci`, après l'avoir mis de côté). Sous Windows, le dossier d'un exécutable en cours d'exécution ne peut être ni
renommé ni supprimé : un lanceur qui tournerait depuis `node_modules\electron` ferait échouer chaque mise à jour des
dépendances. La copie (comme le `.app` sur macOS) survit à `npm ci`. Les autres choix possibles — `wscript.exe` + `.vbs`
qui lancerait `npm run app:desktop`, ou un petit exécutable compilé — ajoutaient une étape sans rien apporter : Electron est
déjà une application graphique sans console, avec sa fenêtre et son icône.

## Lancement

1. **Environnement** (`lib/environment.cjs`) : les variables héritées d'une autre app sont retirées avant tout et leurs
   noms (jamais leurs valeurs) journalisés : `DATABASE_URL`, `HOST`, `PORT`, `ALLOWED_HOSTS`, `ATELIER_IMPORT_TOKEN`,
   `BACKUP_DIR`, `BACKUP_KEEP`, `LOG_LEVEL`, `NODE_ENV` (raison de chacune dans le module). La configuration vient de
   `backend/.env` ou des valeurs par défaut. Cas réel : ouverte depuis Atelier Nexus, l'app héritait de
   `DATABASE_URL=sqlite+aiosqlite:///…/nexus.db`, refusée par `loadConfig` pendant `npm run db:deploy`.
2. **Node.js et npm** (`lib/node-path.cjs`) : macOS — PATH du shell de connexion zsh, PATH du lanceur, Homebrew, nvm ;
   Windows — PATH de la session lu dans le registre (machine puis utilisateur : celui du menu Démarrer, même si une autre
   app a lancé celle-ci avec un environnement minimal), PATH reçu, `%ProgramFiles%\nodejs`, nvm-windows (`%NVM_SYMLINK%`,
   versions de `%NVM_HOME%`), Volta, fnm, `%LOCALAPPDATA%\Programs\nodejs` ; Git for Windows ajouté en fin de PATH.
3. **Mise à jour** (`lib/prepare.cjs`, §8) : état du dépôt (`git rev-parse HEAD` + contenu des fichiers listés par
   `git status --porcelain`, nouveaux fichiers non ignorés compris) et empreinte de `package-lock.json`, comparés au tampon
   `desktop/.build-stamp.json`. Étapes, seulement si nécessaire : `npm ci` (sans tampon, lockfile changé ou dépendances
   absentes ; `node_modules` mis de côté et remis en place en cas d'échec), `prisma generate`, copie de la base puis
   migrations (`db:deploy`, toujours vérifiées), compilation dans `dist.maj` puis échange avec `dist`. Verrou
   `desktop/.update.lock`, journal `mise-a-jour.log`, tampon écrit après une réussite complète seulement.
4. **API et interface** : `node backend/dist/server.js` (attente de `/api/health`), puis serveur de `frontend/dist` sur
   `127.0.0.1:4174` ; si l'une ou l'autre tourne déjà (`npm run dev`), elle est utilisée telle quelle.

En cas d'échec de la mise à jour, l'écran de démarrage (`desktop/splash.html`) propose « Ouvrir quand même avec la version
précédente », « Réessayer », « Ouvrir le journal » ou « Quitter ».

### Mode « mise à jour seulement »

`<lanceur> --mise-a-jour-seulement` fait les étapes 1 à 3 sans fenêtre puis s'arrête : code 0 (rien à faire ou mise à jour
faite), 1 (échec de la mise à jour), 2 (autre erreur : Node introuvable, dépôt absent), 3 (application déjà ouverte : la
mise à jour se fera à son prochain lancement). Utilisé par `install.ps1` pour vérifier le lanceur et par la CI (§9.5).

## Particularités de Windows (§9.3)

- **npm sans shell** : depuis Node 20.12, un `.cmd` ne se lance plus sans `shell: true`. `npmCommand` lance donc
  `node.exe` avec le `node_modules\npm\bin\npm-cli.js` installé à côté (installation officielle, nvm-windows, fnm), sinon
  `npm.exe` (Volta). Les arguments sont des constantes passées en tableau : aucune chaîne de commande pour `cmd.exe`,
  chemins avec espaces et accents intacts.
- **Fichiers verrouillés** : un fichier ouvert (antivirus, indexation, `npm run dev` qui a chargé le module natif
  `better-sqlite3`) empêche de renommer son dossier. Les renommages sont réessayés quelques secondes (`renameRetry`) ;
  ensuite l'étape échoue avec un message qui le dit et la version précédente reste en place. Les suppressions sont
  réessayées, et une suppression en échec (`*.a-supprimer`) est reprise au lancement suivant. L'Electron du lanceur, hors
  du dépôt, n'est jamais concerné.
- **Fins de ligne** : `.gitattributes` (`* text=auto eol=lf`, scripts `.ps1`/`.cmd`/`.bat`/`.vbs` en CRLF, binaires) : un
  clone Windows ne paraît jamais modifié, sinon chaque lancement recompilerait.
- **Moteurs Prisma et `better-sqlite3`** : téléchargés par `npm ci` / `prisma generate` depuis leurs hôtes officiels (§8.4) ;
  `better-sqlite3` installe un binaire précompilé pour Windows x64 (vérifié par la CI) ; sur ARM64, non vérifié : sans
  binaire précompilé, `npm ci` le compilerait et exigerait les outils de compilation de Visual Studio.
- **Hook Git post-commit** (`backend/src/git-engine/hook.ts`) : script `#!/bin/sh` qui appelle `curl` en arrière-plan.
  Git for Windows l'exécute avec son propre `sh` (un fichier qui commence par `#!` y est exécutable, sans bit `x`) et
  fournit `curl` ; Windows 10+ a aussi `curl.exe`.
- **Session Claude CLI** (`backend/src/ai-bridge/claude-cli.ts`) : pas d'ouverture automatique d'un terminal ; la commande
  (syntaxe sh) est à coller dans **Git Bash**, qui garde chaque argument intact.
- **Arrêt de l'API** : `SIGTERM` n'existe pas sous Windows ; le processus est arrêté directement (SQLite reste cohérent).

## Emplacements (§9.2)

| Usage | macOS | Windows |
|---|---|---|
| Base, sauvegardes | `backend/prisma/dev.db`, `backend/prisma/backups/` (dépôt, ignorés par git) | identiques |
| Journaux `app.log`, `mise-a-jour.log` | `~/Library/Logs/Atelier_Projets/` | `%LOCALAPPDATA%\Atelier_Projets\Logs\` |
| Données propres à l'app (taille de la fenêtre) | `~/Library/Application Support/Atelier Projets/` | `%APPDATA%\Atelier_Projets\` |
| Lanceur | `~/Applications/Atelier Projets.app` | `%LOCALAPPDATA%\Programs\Atelier_Projets\` |
| Enregistrement (§9.4) | identifiant `local.atelier-projets.desktop` | `HKCU\Software\Atelier\Apps\projets` (`Lanceur`, `Nom`, `Depot`) |

`ATELIER_LOG_DIR` remplace le dossier des journaux (tests).

## Ouvrir une autre app de la suite (§3, §9.4)

`setWindowOpenHandler` → `lib/suite-launch.cjs` reconnaît l'adresse d'une app de la suite (hôte de bouclage + port, ou
Atelier Cuisine en https) et ouvre l'app installée : macOS `open -b <identifiant>` ; Windows, lanceur lu dans
`HKCU\Software\Atelier\Apps\<viz|tab|projets>` par `reg.exe` (chemin absolu, sans shell) et démarré détaché (`.exe`
directement, `.vbs` par `wscript.exe`, `.lnk` par l'Explorateur). Sinon, navigateur par défaut. L'app ouverte reçoit un
environnement minimal (utilisateur, dossiers personnels et système, langue, fuseau, dossiers temporaires, PATH système
— Windows : PATH de la session) : aucune variable d'Atelier Projets (`DATABASE_URL`, `PORT`, `ATELIER_*`, `ELECTRON_*`…).

## Vérification

`npm test --workspace=@atelier/desktop` (logique pure, Windows simulé sur tous les systèmes). CI
(`.github/workflows/ci.yml`) : travail `linux` (tests, vérifications, compilation) et travail `windows` : tests, puis
`install.ps1 -SansBureau` dans un profil temporaire avec un dépôt dans un chemin à espaces et accents, lanceur en mode
mise à jour seule après un commit (met à jour) puis une seconde fois (ne refait rien), avec un `DATABASE_URL` de Nexus
hérité, puis désinstallation (la base reste).

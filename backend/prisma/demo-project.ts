// =============================================================================
// Projet de démonstration « App E-Commerce v2 » — données et insertion
//
// Reproduit les maquettes du README (§4) : budget initial 45 j (360 h), temps réalisé
// 28.5 j (228 h), éléments #101 → #211 et fiche #12345 avec ses commits Git et la PR #42.
// Couvre les 3 types de WorkItem, les 8 statuts, et les jalons de phase et de projet.
//
// Idempotent : le projet de démo (slug « app-ecommerce-v2 ») est supprimé puis recréé.
// Les WorkItems gardent leurs #ID fixes, référencés par les messages de commit.
// Utilisé par le seed (prisma/seed.ts → npm run db:seed) et par les tests de l'API.
// =============================================================================
import type { PrismaClient } from '../src/db/client.ts'
import { Priority, PullRequestState, WorkItemStatus, WorkItemType } from '../src/generated/prisma/client.ts'

export const DEMO_PROJECT_SLUG = 'app-ecommerce-v2'
const HOURS_PER_DAY = 8

/** Date calendaire, stockée à 00:00 UTC. */
const day = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`)
/** Horodatage précis avec fuseau horaire (ex. « 2026-10-18T16:30:00+02:00 »). */
const at = (isoDateTime: string): Date => new Date(isoDateTime)

interface TimeSeed {
  on: string
  hours: number
  comment: string
}

interface WorkItemSeed {
  id: number
  type: WorkItemType
  status: WorkItemStatus
  priority?: Priority
  title: string
  /** Budget en jours (converti en heures) ; null = non estimé. */
  estimateDays: number | null
  progress: number
  start?: string
  due?: string
  description: string
  log?: string
  time?: TimeSeed[]
}

interface StorySeed {
  title: string
  description: string
  start: string
  due: string
  items: WorkItemSeed[]
}

interface EpicSeed {
  title: string
  description: string
  start: string
  due: string
  stories: StorySeed[]
}

interface MilestoneSeed {
  title: string
  description: string
  date: string
  reachedAt?: string
}

interface PhaseSeed {
  title: string
  description: string
  start: string
  due: string
  epics: EpicSeed[]
  milestones: MilestoneSeed[]
}

interface CommitSeed {
  hash: string
  author: { name: string; email: string }
  committedAt: string
  branch: string
  message: string
  /** Références détectées : [#ID, mot-clé capturé par la regex du git-engine]. */
  refs: Array<[workItemId: number, keyword: string | null]>
}

const t = (on: string, hours: number, comment: string): TimeSeed => ({ on, hours, comment })

const AUTHORS = {
  camille: { name: 'Camille Martin', email: 'camille.martin@example.com' },
  yanis: { name: 'Yanis Lefèvre', email: 'yanis.lefevre@example.com' },
}

// -----------------------------------------------------------------------------
// Hiérarchie : Phases > Epics > Stories > WorkItems
// -----------------------------------------------------------------------------

const PHASES: PhaseSeed[] = [
  {
    title: 'Socle Technique',
    description: 'Fondations techniques : authentification, API et synchronisation Git.',
    start: '2026-10-01',
    due: '2026-10-21',
    milestones: [
      {
        title: 'API Prête',
        description: 'Authentification et API principale opérationnelles.',
        date: '2026-10-15',
        reachedAt: '2026-10-15T17:30:00+02:00',
      },
    ],
    epics: [
      {
        title: 'Architecture',
        description: 'Architecture backend, authentification et intégration Git / GitHub.',
        start: '2026-10-01',
        due: '2026-10-21',
        stories: [
          {
            title: 'Auth',
            description:
              'En tant que client, je veux me connecter avec mon compte GitHub afin d’accéder à mon espace sans créer de mot de passe.',
            start: '2026-10-01',
            due: '2026-10-09',
            items: [
              {
                id: 101,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.CLOSED,
                title: 'OAuth2 GitHub',
                estimateDays: 3,
                progress: 100,
                start: '2026-10-01',
                due: '2026-10-06',
                description: [
                  '### Objectif',
                  'Permettre la connexion des clients via GitHub (OAuth2).',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Bouton « Se connecter avec GitHub » sur la page de connexion',
                  '- [x] Callback OAuth2 et création du compte au premier login',
                  '- [x] Déconnexion avec révocation de la session',
                ].join('\n'),
                log: '> **05 Oct 2026 - 18h00 (7h passées) :** Flux OAuth2 complet (redirection, callback, échange du code) ; le compte client est créé au premier login à partir du profil GitHub. Déconnexion avec révocation de la session, mergé dans `main`.',
                time: [
                  t('2026-10-01', 6, 'Application OAuth GitHub et redirection'),
                  t('2026-10-02', 7, 'Callback et création du compte'),
                  t('2026-10-05', 7, 'Déconnexion, tests et revue'),
                ],
              },
              {
                id: 102,
                type: WorkItemType.TASK,
                status: WorkItemStatus.RESOLVED,
                title: 'Config JWT',
                estimateDays: 2,
                progress: 100,
                start: '2026-10-05',
                due: '2026-10-07',
                description: [
                  '### Objectif',
                  'Signer les sessions de l’API avec des jetons JWT courts et un refresh token.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Clés de signature chargées depuis l’environnement',
                  '- [x] Expiration 15 min, refresh token 7 jours',
                  '- [x] Middleware de vérification sur les routes protégées',
                ].join('\n'),
                log: '> **07 Oct 2026 - 17h30 (6h passées) :** Middleware de vérification JWT branché sur les routes `/api/account/*`, rotation du refresh token à chaque renouvellement. Tests verts, prêt à être clôturé.',
                time: [
                  t('2026-10-05', 4, 'Choix des algorithmes et des durées de vie'),
                  t('2026-10-06', 6, 'Émission et rotation des jetons'),
                  t('2026-10-07', 6, 'Middleware et tests'),
                ],
              },
              {
                id: 103,
                type: WorkItemType.BUG,
                status: WorkItemStatus.IN_REVIEW,
                priority: Priority.HIGH,
                title: 'Fix CORS Header',
                estimateDays: 1,
                progress: 90,
                start: '2026-10-08',
                due: '2026-10-09',
                description: [
                  '### Constat',
                  'Le navigateur bloque les appels authentifiés du front : l’en-tête `Access-Control-Allow-Credentials` est absent de la réponse au preflight.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Preflight `OPTIONS` avec les bons en-têtes',
                  '- [x] Origines autorisées configurables',
                  '- [ ] Relecture de la Pull Request',
                ].join('\n'),
                log: '> **12 Oct 2026 - 11h00 (3h passées) :** Correctif plus long que prévu : le preflight était intercepté avant le plugin CORS. Ordre d’enregistrement des plugins corrigé et test de non-régression ajouté ; Pull Request en revue.',
                time: [
                  t('2026-10-08', 6, 'Reproduction et analyse du preflight'),
                  t('2026-10-09', 5, 'Correctif de l’ordre des plugins'),
                  t('2026-10-12', 3, 'Test de non-régression et Pull Request'),
                ],
              },
            ],
          },
          {
            title: 'Synchronisation Git',
            description:
              'En tant que chef de projet, je veux que chaque commit citant `#ID` soit rattaché automatiquement à sa tâche afin de suivre la réalisation sans saisie manuelle.',
            start: '2026-10-09',
            due: '2026-10-21',
            items: [
              {
                id: 104,
                type: WorkItemType.TASK,
                status: WorkItemStatus.CLOSED,
                title: 'Client GitHub API (@octokit/rest)',
                estimateDays: 2,
                progress: 100,
                start: '2026-10-09',
                due: '2026-10-13',
                description: [
                  '### Objectif',
                  'Initialiser le client `@octokit/rest` authentifié par un token personnel.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Token lu depuis l’environnement, jamais journalisé',
                  '- [x] Gestion du rate limit (attente puis reprise)',
                  '- [x] Connexion validée sur le dépôt `user/ecom`',
                ].join('\n'),
                log: '> **13 Oct 2026 - 18h00 (8h passées) :** Client Octokit avec reprise automatique sur rate limit ; le token est masqué dans les logs. Connexion au dépôt `user/ecom` validée.',
                time: [
                  t('2026-10-09', 3, 'Création du token et configuration'),
                  t('2026-10-12', 8, 'Client Octokit et gestion du rate limit'),
                  t('2026-10-13', 8, 'Tests sur le dépôt user/ecom'),
                ],
              },
              {
                id: 105,
                type: WorkItemType.TASK,
                status: WorkItemStatus.RESOLVED,
                title: 'Tests du parseur de références #ID',
                estimateDays: 1,
                progress: 100,
                start: '2026-10-13',
                due: '2026-10-14',
                description: [
                  '### Objectif',
                  'Couvrir par des tests unitaires l’extraction des références `(feature|task|bug|fix|feat|ref)? #ID`.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Insensible à la casse',
                  '- [x] Plusieurs références dans un même message',
                  '- [x] `#ID` seul (sans mot-clé) reconnu',
                ].join('\n'),
                log: '> **14 Oct 2026 - 17h00 (6h passées) :** 24 cas de test (casse, multi-références, `#ID` seul, référence en fin de ligne). Tous verts.',
                time: [
                  t('2026-10-13', 4, 'Jeux de messages de commit'),
                  t('2026-10-14', 6, 'Tests unitaires et cas limites'),
                ],
              },
              {
                id: 107,
                type: WorkItemType.BUG,
                status: WorkItemStatus.CLOSED,
                title: 'Accents corrompus dans les messages de commit',
                estimateDays: 1,
                progress: 100,
                start: '2026-10-14',
                due: '2026-10-15',
                description: [
                  '### Constat',
                  'Les messages de commit contenant des accents (« Résolution ») apparaissent corrompus après import.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Lecture de `git log` forcée en UTF-8',
                  '- [x] Test avec des messages accentués et des emojis',
                ].join('\n'),
                log: '> **15 Oct 2026 - 16h00 (6h passées) :** `git log` est désormais lu avec `--encoding=UTF-8` ; les anciens commits ont été réimportés.',
                time: [
                  t('2026-10-14', 5, 'Reproduction et diagnostic de l’encodage'),
                  t('2026-10-15', 6, 'Correctif et réimport des commits'),
                ],
              },
              {
                id: 12345,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.IN_PROGRESS,
                priority: Priority.HIGH,
                title: 'Implémenter le moteur de synchronisation Git Local / GitHub',
                estimateDays: 3,
                progress: 75,
                start: '2026-10-12',
                due: '2026-10-21',
                description: [
                  '### Objectif de la Feature',
                  'Permettre au backend de scanner les commits locaux et de lier automatiquement tout commit contenant `#ID` à la tâche correspondante.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Parser les messages de commit via `simple-git`',
                  '- [x] Extraire les patterns `feature #12345`, `fix #12345`, `task #12345`',
                  '- [ ] Synchroniser le statut avec les Pull Requests GitHub',
                ].join('\n'),
                log: [
                  '> **16 Oct 2026 - 18h00 (3h passées) :** Lecture de l’historique avec `simple-git` (`git log --all`) et stockage des commits par projet ; les messages multi-lignes sont normalisés avant analyse.',
                  '',
                  "> **18 Oct 2026 - 16h30 (4.5h passées) :** Mise en place d'un hook `post-commit` couplé à une table SQLite `git_commits`. J'ai utilisé Qwen-2.5-Coder en local pour générer la Regex d'extraction multi-références. Fonctionne parfaitement en local.",
                ].join('\n'),
                time: [
                  t('2026-10-12', 3.5, 'Analyse de simple-git et du format des logs'),
                  t('2026-10-14', 4, 'Lecture de l’historique et stockage par projet'),
                  t('2026-10-16', 3, 'Normalisation des messages multi-lignes'),
                  t('2026-10-17', 3, 'Schéma des liens commit ↔ tâche'),
                  t('2026-10-18', 4.5, 'Hook post-commit et regex multi-références'),
                ],
              },
              {
                id: 106,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.ON_HOLD,
                title: 'Synchronisation des Pull Requests GitHub',
                estimateDays: 2,
                progress: 25,
                start: '2026-10-15',
                due: '2026-10-20',
                description: [
                  '### Objectif',
                  'Afficher les Pull Requests liées à une tâche et refléter leur état (ouverte → En revue, mergée → Terminée).',
                  '',
                  '### Critères d’acceptation',
                  '- [ ] Récupération des Pull Requests via l’API GitHub',
                  '- [ ] Liaison par nom de branche (`feature/12345-…`) ou par `#ID` dans le titre',
                  '- [ ] Mise à jour du statut de la tâche',
                  '',
                  '> ⏸️ En attente : reprise une fois le moteur de synchronisation #12345 terminé.',
                ].join('\n'),
                log: '> **16 Oct 2026 - 12h00 (3h passées) :** Prototype de récupération des Pull Requests via `@octokit/rest`. Mis en pause volontairement en attendant la fin de #12345.',
                time: [
                  t('2026-10-15', 4, 'Exploration de l’API Pull Requests'),
                  t('2026-10-16', 3, 'Prototype de récupération'),
                ],
              },
              {
                id: 108,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.REJECTED,
                priority: Priority.LOW,
                title: 'Support des dépôts Mercurial',
                estimateDays: null,
                progress: 0,
                description: [
                  '### Demande',
                  'Permettre la synchronisation de dépôts Mercurial (hg).',
                  '',
                  '> ❌ Rejetée : hors périmètre, Atelier_Projets cible uniquement Git / GitHub.',
                ].join('\n'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    title: 'Expérience UI',
    description: 'Nouvelle interface : thèmes clair / sombre et composants partagés.',
    start: '2026-10-12',
    due: '2026-11-02',
    milestones: [
      {
        title: 'Beta UI',
        description: 'Interface complète (thèmes, composants, vues principales) ouverte aux testeurs.',
        date: '2026-11-02',
      },
    ],
    epics: [
      {
        title: 'Design System',
        description: 'Tokens, thèmes et composants réutilisables.',
        start: '2026-10-12',
        due: '2026-11-02',
        stories: [
          {
            title: 'Thèmes',
            description:
              'En tant qu’utilisateur, je veux basculer entre un thème clair et un thème sombre afin de travailler confortablement de jour comme de nuit.',
            start: '2026-10-12',
            due: '2026-10-23',
            items: [
              {
                id: 204,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.IN_PROGRESS,
                title: 'Dark Mode',
                estimateDays: 5,
                progress: 80,
                start: '2026-10-12',
                due: '2026-10-23',
                description: [
                  '### Objectif',
                  'Bascule ☀️ / 🌙 dans l’en-tête, mémorisée entre deux sessions.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Attribut `data-theme` piloté par la bascule',
                  '- [x] Préférence système appliquée au premier lancement',
                  '- [x] Choix mémorisé entre deux sessions',
                  '- [ ] Contraste vérifié sur toutes les vues',
                ].join('\n'),
                log: '> **17 Oct 2026 - 18h00 (6h passées) :** Bascule branchée sur `data-theme` avec mémorisation du choix. Reste la passe de contraste sur le Gantt et le tableau des temps.',
                time: [
                  t('2026-10-12', 6, 'Structure de la bascule de thème'),
                  t('2026-10-13', 7, 'Thème sombre des vues principales'),
                  t('2026-10-14', 6, 'Préférence système et mémorisation'),
                  t('2026-10-15', 6, 'Thème sombre du Gantt'),
                  t('2026-10-16', 5, 'Thème sombre de la fiche tâche'),
                  t('2026-10-17', 6, 'Corrections visuelles'),
                ],
              },
              {
                id: 205,
                type: WorkItemType.TASK,
                status: WorkItemStatus.BLOCKED,
                title: 'Tokens CSS',
                estimateDays: 3,
                progress: 0,
                start: '2026-10-16',
                due: '2026-10-23',
                description: [
                  '### Objectif',
                  'Remplacer toutes les couleurs codées en dur par les variables du design system.',
                  '',
                  '### Critères d’acceptation',
                  '- [ ] Aucune couleur `#hex` en dur dans le front',
                  '- [ ] Couleurs de types et de statuts issues des tokens officiels',
                  '',
                  '> 🚧 Bloquée : en attente de la charte graphique définitive (couleurs de marque).',
                ].join('\n'),
                log: '> **16 Oct 2026 - 17h00 (4h passées) :** Inventaire des couleurs codées en dur dans les composants existants. Remplacement suspendu en attendant la charte définitive.',
                time: [t('2026-10-16', 4, 'Inventaire des couleurs codées en dur')],
              },
            ],
          },
          {
            title: 'Composants UI',
            description:
              'En tant que développeur front, je veux une bibliothèque de composants partagés afin de construire les vues sans dupliquer le style.',
            start: '2026-10-12',
            due: '2026-10-30',
            items: [
              {
                id: 206,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.CLOSED,
                title: 'Badges de type et de statut',
                estimateDays: 3,
                progress: 100,
                start: '2026-10-12',
                due: '2026-10-15',
                description: [
                  '### Objectif',
                  'Composants `TypeBadge` et `StatusBadge` reprenant les 7 couleurs de types et les 8 couleurs de statuts.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Libellés FR / EN',
                  '- [x] Couleurs issues exclusivement des tokens',
                  '- [x] Rendu vérifié en thème clair et sombre',
                ].join('\n'),
                log: '> **15 Oct 2026 - 18h00 (7h passées) :** Badges livrés et utilisés dans la liste des tâches. Léger dépassement dû à la gestion des libellés bilingues.',
                time: [
                  t('2026-10-12', 7, 'Badge de type'),
                  t('2026-10-13', 7, 'Badge de statut'),
                  t('2026-10-14', 7, 'Libellés bilingues'),
                  t('2026-10-15', 7, 'Intégration et revue'),
                ],
              },
              {
                id: 207,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.RESOLVED,
                title: 'Barres de progression Budget / Avancement',
                estimateDays: 2,
                progress: 100,
                start: '2026-10-14',
                due: '2026-10-16',
                description: [
                  '### Objectif',
                  'Barres « Progression Budget » et « Avancement Réel » du tableau de bord.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Pourcentage et libellé accessibles',
                  '- [x] Indicateur « En avance » / « En retard » fourni par le backend',
                ].join('\n'),
                log: '> **16 Oct 2026 - 18h30 (6h passées) :** Composant `ProgressBar` générique (valeur, maximum, variante) ; l’indicateur d’écart est calculé par le backend et seulement affiché.',
                time: [
                  t('2026-10-14', 5, 'Composant ProgressBar'),
                  t('2026-10-15', 6, 'Variantes Budget et Avancement'),
                  t('2026-10-16', 6, 'Accessibilité et tests'),
                ],
              },
              {
                id: 209,
                type: WorkItemType.BUG,
                status: WorkItemStatus.RESOLVED,
                title: 'Contraste insuffisant des badges en mode sombre',
                estimateDays: 1,
                progress: 100,
                start: '2026-10-15',
                due: '2026-10-16',
                description: [
                  '### Constat',
                  'Le texte des badges « En attente » et « À faire » est peu lisible sur fond sombre.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Contraste AA sur `--bg-surface` en thème sombre',
                ].join('\n'),
                log: '> **16 Oct 2026 - 15h00 (3h passées) :** Couleur du texte des badges ajustée selon la luminance du fond ; contraste AA vérifié dans les deux thèmes.',
                time: [
                  t('2026-10-15', 3, 'Mesure des contrastes'),
                  t('2026-10-16', 3, 'Correctif et vérification'),
                ],
              },
              {
                id: 208,
                type: WorkItemType.TASK,
                status: WorkItemStatus.IN_PROGRESS,
                title: 'Tableau réutilisable (Timesheet)',
                estimateDays: 3,
                progress: 70,
                start: '2026-10-16',
                due: '2026-10-22',
                description: [
                  '### Objectif',
                  'Composant de tableau générique (colonnes, totaux, tri) pour la vue Tableau des temps.',
                  '',
                  '### Critères d’acceptation',
                  '- [x] Colonnes configurables',
                  '- [x] Ligne de total',
                  '- [ ] Tri par colonne',
                  '- [ ] Filtre par Epic',
                ].join('\n'),
                log: '> **17 Oct 2026 - 18h00 (8h passées) :** Colonnes configurables et ligne de total en place ; le tri et le filtre restent à faire.',
                time: [
                  t('2026-10-16', 6, 'Structure du tableau'),
                  t('2026-10-17', 8, 'Colonnes configurables et totaux'),
                  t('2026-10-18', 8, 'Préparation du tri'),
                ],
              },
              {
                id: 210,
                type: WorkItemType.FEATURE,
                status: WorkItemStatus.OPEN,
                title: 'Slide-over de fiche tâche',
                estimateDays: 2,
                progress: 0,
                start: '2026-10-26',
                due: '2026-10-28',
                description: [
                  '### Objectif',
                  'Panneau latéral de fiche tâche avec les onglets « Description » et « Journal d’avancement ».',
                  '',
                  '### Critères d’acceptation',
                  '- [ ] Ouverture depuis le Gantt et la liste',
                  '- [ ] Rendu Markdown des deux onglets',
                  '- [ ] Liste des commits associés',
                ].join('\n'),
              },
              {
                id: 211,
                type: WorkItemType.TASK,
                status: WorkItemStatus.OPEN,
                priority: Priority.LOW,
                title: 'Documentation des composants',
                estimateDays: 1,
                progress: 0,
                start: '2026-10-29',
                due: '2026-10-30',
                description: [
                  '### Objectif',
                  'Documenter chaque composant (props, variantes, accessibilité).',
                  '',
                  '### Critères d’acceptation',
                  '- [ ] Une page par composant',
                  '- [ ] Exemples en thème clair et sombre',
                ].join('\n'),
              },
            ],
          },
        ],
      },
    ],
  },
]

/** Jalons de niveau projet (sans phase). */
const PROJECT_MILESTONES: MilestoneSeed[] = [
  {
    title: 'Mise en production v2',
    description: 'Bascule de la boutique en ligne sur la v2.',
    date: '2026-11-16',
  },
]

// -----------------------------------------------------------------------------
// Commits Git détectés (messages compatibles avec la regex du git-engine)
// -----------------------------------------------------------------------------

const COMMITS: CommitSeed[] = [
  {
    hash: '4b1e9f08ac2d126f40ad227a3794cfcc5d096dbd',
    author: AUTHORS.camille,
    committedAt: '2026-10-02T18:05:00+02:00',
    branch: 'feature/101-oauth-github',
    message: 'feat(auth): GitHub OAuth2 callback feature #101',
    refs: [[101, 'feature']],
  },
  {
    hash: 'e07c3a203572de1367c67b3c4af6b033136a3fc4',
    author: AUTHORS.yanis,
    committedAt: '2026-10-09T16:40:00+02:00',
    branch: 'fix/103-cors-header',
    message: 'fix(api): allow credentials in CORS preflight bug #103 ref #102',
    refs: [
      [103, 'bug'],
      [102, 'ref'],
    ],
  },
  {
    hash: 'f5d2b88b09ac6dd5a239344d92e91e3dc90a6d47',
    author: AUTHORS.yanis,
    committedAt: '2026-10-16T11:20:00+02:00',
    branch: 'feature/204-dark-mode',
    message: 'feat(ui): dark theme toggle feature #204',
    refs: [[204, 'feature']],
  },
  {
    hash: 'c3e91b025f43bd306af0eccd0e12d509c9d6d3c8',
    author: AUTHORS.camille,
    committedAt: '2026-10-17T15:10:00+02:00',
    branch: 'feature/12345-git-sync-engine',
    message: 'wip: database schema for git links feature #12345',
    refs: [[12345, 'feature']],
  },
  {
    hash: 'a8f4d21d8a8e233b3fd2309ce759bf99c72e2c28',
    author: AUTHORS.camille,
    committedAt: '2026-10-18T14:25:00+02:00',
    branch: 'feature/12345-git-sync-engine',
    message: 'feat: add regex parser for feature #12345 in git-engine',
    refs: [[12345, 'feature']],
  },
]

// -----------------------------------------------------------------------------
// Pull Requests GitHub (fiche #12345 : « PR #42 … — En revue »)
// -----------------------------------------------------------------------------

const PULL_REQUESTS = [
  {
    number: 42,
    title: 'Feature/12345 git sync engine',
    body: 'Moteur de synchronisation Git local / GitHub : parseur des références `#ID` et table des liens commit ↔ tâche.',
    state: PullRequestState.OPEN,
    draft: false,
    headBranch: 'feature/12345-git-sync-engine',
    baseBranch: 'main',
    authorLogin: 'camille-martin',
    openedAt: '2026-10-18T10:00:00+02:00',
    links: [[12345, 'branch']] as Array<[workItemId: number, source: string]>,
  },
]

// -----------------------------------------------------------------------------
// Insertion
// -----------------------------------------------------------------------------

/** (Ré)insère le projet de démo dans une transaction et renvoie son id. */
export async function seedDemoProject(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      await tx.project.deleteMany({ where: { slug: DEMO_PROJECT_SLUG } })

      const project = await tx.project.create({
        data: {
          name: 'App E-Commerce v2',
          slug: DEMO_PROJECT_SLUG,
          description:
            'Refonte de la boutique en ligne : authentification GitHub, synchronisation Git / GitHub et nouvelle interface (thèmes clair et sombre).',
          githubOwner: 'user',
          githubRepo: 'ecom',
          defaultBranch: 'main',
          hoursPerDay: HOURS_PER_DAY,
          budgetHours: 45 * HOURS_PER_DAY,
          startDate: day('2026-10-01'),
          dueDate: day('2026-11-16'),
        },
      })

      for (const [phaseIndex, phaseSeed] of PHASES.entries()) {
        const phase = await tx.phase.create({
          data: {
            projectId: project.id,
            title: phaseSeed.title,
            description: phaseSeed.description,
            position: phaseIndex + 1,
            startDate: day(phaseSeed.start),
            dueDate: day(phaseSeed.due),
          },
        })

        for (const milestone of phaseSeed.milestones) {
          await tx.milestone.create({
            data: {
              projectId: project.id,
              phaseId: phase.id,
              title: milestone.title,
              description: milestone.description,
              date: day(milestone.date),
              reachedAt: milestone.reachedAt ? at(milestone.reachedAt) : null,
            },
          })
        }

        for (const [epicIndex, epicSeed] of phaseSeed.epics.entries()) {
          const epic = await tx.epic.create({
            data: {
              phaseId: phase.id,
              title: epicSeed.title,
              description: epicSeed.description,
              position: epicIndex + 1,
              startDate: day(epicSeed.start),
              dueDate: day(epicSeed.due),
            },
          })

          for (const [storyIndex, storySeed] of epicSeed.stories.entries()) {
            const story = await tx.story.create({
              data: {
                epicId: epic.id,
                title: storySeed.title,
                description: storySeed.description,
                position: storyIndex + 1,
                startDate: day(storySeed.start),
                dueDate: day(storySeed.due),
              },
            })

            for (const [itemIndex, item] of storySeed.items.entries()) {
              await tx.workItem.create({
                data: {
                  id: item.id,
                  projectId: project.id,
                  storyId: story.id,
                  type: item.type,
                  status: item.status,
                  priority: item.priority ?? Priority.NORMAL,
                  title: item.title,
                  description: item.description,
                  implementationLog: item.log ?? '',
                  estimatedHours: item.estimateDays === null ? null : item.estimateDays * HOURS_PER_DAY,
                  progress: item.progress,
                  position: itemIndex + 1,
                  startDate: item.start ? day(item.start) : null,
                  dueDate: item.due ? day(item.due) : null,
                  timeEntries: {
                    create: (item.time ?? []).map((entry) => ({
                      spentOn: day(entry.on),
                      hours: entry.hours,
                      comment: entry.comment,
                    })),
                  },
                },
              })
            }
          }
        }
      }

      for (const milestone of PROJECT_MILESTONES) {
        await tx.milestone.create({
          data: {
            projectId: project.id,
            title: milestone.title,
            description: milestone.description,
            date: day(milestone.date),
            reachedAt: milestone.reachedAt ? at(milestone.reachedAt) : null,
          },
        })
      }

      for (const commit of COMMITS) {
        await tx.gitCommit.create({
          data: {
            projectId: project.id,
            hash: commit.hash,
            authorName: commit.author.name,
            authorEmail: commit.author.email,
            committedAt: at(commit.committedAt),
            message: commit.message,
            branch: commit.branch,
            links: {
              create: commit.refs.map(([workItemId, keyword]) => ({ workItemId, keyword })),
            },
          },
        })
      }

      for (const pr of PULL_REQUESTS) {
        await tx.pullRequest.create({
          data: {
            projectId: project.id,
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            draft: pr.draft,
            url: `https://github.com/user/ecom/pull/${pr.number}`,
            headBranch: pr.headBranch,
            baseBranch: pr.baseBranch,
            authorLogin: pr.authorLogin,
            openedAt: at(pr.openedAt),
            links: { create: pr.links.map(([workItemId, source]) => ({ workItemId, source })) },
          },
        })
      }

      return project.id
    },
    { timeout: 30_000 },
  )
}

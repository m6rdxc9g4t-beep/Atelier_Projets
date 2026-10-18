// Paramètres du projet : identité, budget et « 1 jour = X heures », dépôt Git local (analyse, hook
// post-commit) et dépôt GitHub (synchronisation des Pull Requests).
import { FolderGit2, GitPullRequest, RefreshCw, Save, Trash2, Webhook } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Card, Eyebrow, Field } from '../components/ui.tsx'
import { dateTime, parseNumber } from '../lib/format.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { gitService, projectService } from '../services/api.ts'
import type { GitHubSyncResult, GitScanResult, Project, ProjectUpdate } from '../services/types.ts'
import { useApp } from '../store/app.ts'

interface Form {
  name: string
  description: string
  hoursPerDay: string
  budgetDays: string
  startDate: string
  dueDate: string
  localRepoPath: string
  defaultBranch: string
  githubOwner: string
  githubRepo: string
}

function toForm(project: Project): Form {
  return {
    name: project.name,
    description: project.description,
    hoursPerDay: String(project.hoursPerDay),
    budgetDays: project.budget ? String(Number(project.budget.days.toFixed(2))) : '',
    startDate: project.startDate ?? '',
    dueDate: project.dueDate ?? '',
    localRepoPath: project.localRepoPath ?? '',
    defaultBranch: project.defaultBranch,
    githubOwner: project.github?.owner ?? '',
    githubRepo: project.github?.repo ?? '',
  }
}

/** Champs modifiés uniquement (le backend valide chacun). */
function changes(project: Project, form: Form): ProjectUpdate | string {
  const initial = toForm(project)
  const body: ProjectUpdate = {}
  const text = (value: string) => (value.trim() === '' ? null : value.trim())
  if (form.name !== initial.name) body.name = form.name.trim()
  if (form.description !== initial.description) body.description = form.description
  if (form.hoursPerDay !== initial.hoursPerDay) {
    const value = parseNumber(form.hoursPerDay)
    if (value === null || value <= 0 || value > 24) return '« 1 jour = X heures » doit être compris entre 0 et 24.'
    body.hoursPerDay = value
  }
  if (form.budgetDays !== initial.budgetDays) {
    const value = parseNumber(form.budgetDays)
    if (form.budgetDays.trim() !== '' && (value === null || value < 0)) return 'Budget initial invalide.'
    body.budgetDays = value
  }
  if (form.startDate !== initial.startDate) body.startDate = text(form.startDate)
  if (form.dueDate !== initial.dueDate) body.dueDate = text(form.dueDate)
  if (form.localRepoPath !== initial.localRepoPath) body.localRepoPath = text(form.localRepoPath)
  if (form.defaultBranch !== initial.defaultBranch) body.defaultBranch = form.defaultBranch.trim()
  if (form.githubOwner !== initial.githubOwner) body.githubOwner = text(form.githubOwner)
  if (form.githubRepo !== initial.githubRepo) body.githubRepo = text(form.githubRepo)
  return body
}

export function SettingsView({ project }: { project: Project }) {
  const [form, setForm] = useState<Form>(() => toForm(project))
  const { busy, run } = useAction()
  // Le brouillon n'est réinitialisé qu'au changement de projet (la vue est remontée) ou après son propre
  // enregistrement : une autre modification (fiche élément, analyse Git…) ne l'efface pas.
  const set = (field: keyof Form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const pending = changes(project, form)
  const dirty = typeof pending === 'string' || Object.keys(pending).length > 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (typeof pending === 'string') return useApp.getState().notify('error', pending)
    if (Object.keys(pending).length === 0) return
    const result = await run('save', () => projectService.update(project.id, pending), 'Paramètres enregistrés')
    if (result.ok) setForm(toForm(result.value))
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
      <form onSubmit={submit} className="space-y-5">
        <Card className="space-y-4 p-5">
          <Eyebrow>Projet</Eyebrow>
          <Field label="Nom">
            <input className="ds-input" value={form.name} onChange={set('name')} required maxLength={200} />
          </Field>
          <Field label="Description">
            <textarea className="ds-textarea min-h-20 font-sans text-sm" value={form.description} onChange={set('description')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="1 jour = X heures" hint="Conversion des heures en jours dans toutes les vues">
              <input className="ds-input" inputMode="decimal" value={form.hoursPerDay} onChange={set('hoursPerDay')} required />
            </Field>
            <Field label="Budget initial (jours)" hint="Vide = pas de budget">
              <input className="ds-input" inputMode="decimal" value={form.budgetDays} onChange={set('budgetDays')} />
            </Field>
            <Field label="Début">
              <input className="ds-input" type="date" value={form.startDate} onChange={set('startDate')} />
            </Field>
            <Field label="Fin prévue">
              <input className="ds-input" type="date" value={form.dueDate} onChange={set('dueDate')} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <Eyebrow>Dépôts</Eyebrow>
          <Field label="Dépôt Git local (chemin absolu)" hint="Racine du dépôt, par exemple /Users/moi/dev/mon-projet">
            <input className="ds-input font-mono" value={form.localRepoPath} onChange={set('localRepoPath')} placeholder="/Users/…/mon-projet" spellCheck={false} />
          </Field>
          <Field label="Branche par défaut">
            <input className="ds-input font-mono" value={form.defaultBranch} onChange={set('defaultBranch')} required spellCheck={false} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Propriétaire GitHub">
              <input className="ds-input font-mono" value={form.githubOwner} onChange={set('githubOwner')} placeholder="user" spellCheck={false} />
            </Field>
            <Field label="Dépôt GitHub">
              <input className="ds-input font-mono" value={form.githubRepo} onChange={set('githubRepo')} placeholder="ecom" spellCheck={false} />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button disabled={!dirty} onClick={() => setForm(toForm(project))}>
            Annuler les modifications
          </Button>
          <Button type="submit" variant="primary" icon={<Save className="size-4" />} busy={busy === 'save'} disabled={!dirty}>
            Enregistrer
          </Button>
        </div>
      </form>

      <div className="space-y-5">
        <GitCard project={project} />
        <GitHubCard project={project} />
        <DeleteProject project={project} />
      </div>
    </div>
  )
}

function ActionCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </Card>
  )
}

function GitCard({ project }: { project: Project }) {
  const { busy, run } = useAction()
  const [result, setResult] = useState<GitScanResult | null>(null)
  const linked = project.localRepoPath !== null
  const hook = useApi(linked ? () => gitService.hook(project.id) : null, [project.id, project.localRepoPath])

  return (
    <ActionCard icon={<FolderGit2 className="size-4 text-accent-ink" aria-hidden />} title="Dépôt Git local">
      {!linked ? (
        <p className="text-sm text-muted">Renseignez le chemin du dépôt local puis enregistrez pour analyser ses commits.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Les commits qui citent un <span className="font-mono">#ID</span> (feature, task, bug, fix, feat, ref) sont rattachés aux éléments.
            Dernière analyse : {project.gitScannedAt ? dateTime(project.gitScannedAt) : 'jamais'}.
          </p>
          <Button
            variant="primary"
            icon={<RefreshCw className="size-4" />}
            busy={busy === 'scan'}
            onClick={async () => {
              const outcome = await run('scan', () => gitService.scan(project.id), 'Dépôt analysé')
              if (outcome.ok) setResult(outcome.value)
            }}
          >
            Analyser le dépôt
          </Button>
          {result && (
            <ul className="rounded-lg bg-sunken p-3 text-sm">
              <li>{result.commitsRead} commit(s) lu(s) sur {result.branches.length} branche(s)</li>
              <li>{result.commitsCreated} nouveau(x) commit(s), {result.linksCreated} nouveau(x) lien(s)</li>
              {result.commitsRemoved > 0 && <li>{result.commitsRemoved} commit(s) disparu(s) retiré(s)</li>}
              {result.unknownReferences.length > 0 && (
                <li className="text-muted">#ID sans élément : {result.unknownReferences.map((id) => `#${id}`).join(', ')}</li>
              )}
              {result.truncated && <li className="text-muted">Historique tronqué (GIT_SCAN_MAX_COMMITS)</li>}
            </ul>
          )}

          <div className="space-y-2 border-t border-line pt-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Webhook className="size-4 text-muted" aria-hidden /> Hook post-commit
              {hook.data && (
                <span className="ds-badge" data-status={hook.data.installed ? 'CLOSED' : 'OPEN'}>
                  {hook.data.installed ? 'Installé' : 'Non installé'}
                </span>
              )}
            </p>
            <p className="text-xs text-muted">Relance l’analyse en arrière-plan après chaque commit, sans jamais bloquer le commit.</p>
            {hook.error && <p className="text-xs text-muted">{hook.error.message}</p>}
            {hook.data && <p className="break-all font-mono text-xs text-muted">{hook.data.path}</p>}
            {hook.data &&
              (hook.data.installed ? (
                <Button size="sm" busy={busy === 'hook'} onClick={() => run('hook', () => gitService.removeHook(project.id), 'Hook retiré')}>
                  Retirer le hook
                </Button>
              ) : (
                <Button size="sm" variant="primary" busy={busy === 'hook'} onClick={() => run('hook', () => gitService.installHook(project.id), 'Hook installé')}>
                  Installer le hook
                </Button>
              ))}
          </div>
        </>
      )}
    </ActionCard>
  )
}

function GitHubCard({ project }: { project: Project }) {
  const { busy, run } = useAction()
  const [result, setResult] = useState<GitHubSyncResult | null>(null)

  return (
    <ActionCard icon={<GitPullRequest className="size-4 text-accent-ink" aria-hidden />} title="Pull Requests GitHub">
      {!project.github ? (
        <p className="text-sm text-muted">Renseignez le propriétaire et le dépôt GitHub puis enregistrez.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Importe les Pull Requests de{' '}
            <a className="text-accent-ink hover:underline" href={project.github.url} target="_blank" rel="noreferrer">
              {project.github.owner}/{project.github.repo}
            </a>{' '}
            et les relie aux éléments (#ID dans le titre, la description ou la branche). Dernière synchronisation :{' '}
            {project.githubSyncedAt ? dateTime(project.githubSyncedAt) : 'jamais'}. Dépôt privé : GITHUB_TOKEN dans backend/.env.
          </p>
          <Button
            variant="primary"
            icon={<RefreshCw className="size-4" />}
            busy={busy === 'sync'}
            onClick={async () => {
              const outcome = await run('sync', () => gitService.syncGitHub(project.id), 'Pull Requests synchronisées')
              if (outcome.ok) setResult(outcome.value)
            }}
          >
            Synchroniser
          </Button>
          {result && <SyncSummary result={result} />}
        </>
      )}
    </ActionCard>
  )
}

function SyncSummary({ result }: { result: GitHubSyncResult }) {
  return (
    <ul className="rounded-lg bg-sunken p-3 text-sm">
      <li>{result.pullRequests} Pull Request(s) reçue(s) de GitHub</li>
      <li>
        {result.created} nouvelle(s), {result.updated} mise(s) à jour
      </li>
      <li>{result.linkedWorkItems} lien(s) Pull Request ↔ élément</li>
    </ul>
  )
}

function DeleteProject({ project }: { project: Project }) {
  const [confirm, setConfirm] = useState('')
  const { busy, run } = useAction()
  return (
    <ActionCard icon={<Trash2 className="size-4 text-st-rejected" aria-hidden />} title="Supprimer le projet">
      <p className="text-sm text-muted">
        Supprime définitivement le projet, ses phases, éléments, temps et liens Git. Pour confirmer, saisir son nom :{' '}
        <span className="font-semibold text-fg">{project.name}</span>
      </p>
      <input className="ds-input" value={confirm} onChange={(event) => setConfirm(event.target.value)} aria-label="Nom du projet à supprimer" />
      <Button
        variant="danger"
        disabled={confirm !== project.name}
        busy={busy === 'delete'}
        onClick={() =>
          run(
            'delete',
            async () => {
              await projectService.remove(project.id)
              useApp.getState().setProject(null)
            },
            `Projet « ${project.name} » supprimé`,
          )
        }
      >
        Supprimer définitivement
      </Button>
    </ActionCard>
  )
}

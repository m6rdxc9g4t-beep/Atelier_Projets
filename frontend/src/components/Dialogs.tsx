// Dialogues de création et de modification : projet, phase, epic, story, élément, jalon.
import { Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { parseNumber, today } from '../lib/format.ts'
import { levelCode, PRIORITIES, PRIORITY_LABEL, TYPE_LABEL, TYPE_NAME, WORK_ITEM_TYPES } from '../lib/labels.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { hierarchyService, milestoneService, projectService, reportService, workItemService } from '../services/api.ts'
import type { Priority, Project, WorkItemType } from '../services/types.ts'
import { useApp, type DialogRequest } from '../store/app.ts'
import { AiPanel, BreakdownDialog, ClaudeDialog, LinkRepoDialog } from './AiDialogs.tsx'
import { ImportTabDialog } from './ImportTabDialog.tsx'
import { Button, Field, Modal, TypeChip } from './ui.tsx'

export function Dialogs({ project, projects }: { project: Project | undefined; projects: Project[] }) {
  const dialog = useApp((state) => state.dialog)
  if (!dialog) return null
  if (dialog.kind === 'project') return <ProjectDialog />
  if (dialog.kind === 'importTab') return <ImportTabDialog projects={projects} current={project} />
  if (dialog.kind === 'ai') return <AiPanel project={project} />
  if (dialog.kind === 'breakdown') return <BreakdownDialog request={dialog} />
  if (dialog.kind === 'claude') return <ClaudeDialog request={dialog} />
  if (!project) return null
  if (dialog.kind === 'linkRepo') return <LinkRepoDialog project={project} request={dialog} />
  switch (dialog.kind) {
    case 'phase':
    case 'epic':
    case 'story':
      return <ContainerDialog project={project} request={dialog} />
    case 'editContainer':
      return <ContainerDialog project={project} request={dialog} />
    case 'workItem':
      return <WorkItemDialog request={dialog} />
    case 'milestone':
    case 'editMilestone':
      return <MilestoneDialog project={project} request={dialog} />
  }
}

const close = () => useApp.getState().openDialog(null)
const fail = (message: string) => useApp.getState().notify('error', message)

function Footer({ busy, submitLabel, extra }: { busy: boolean; submitLabel: string; extra?: ReactNode }) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <div>{extra}</div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={close}>
          Annuler
        </Button>
        <Button type="submit" form="dialog-form" variant="primary" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

function DateFields({ start, due, onStart, onDue }: { start: string; due: string; onStart: (value: string) => void; onDue: (value: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Début">
        <input className="ds-input" type="date" value={start} onChange={(event) => onStart(event.target.value)} />
      </Field>
      <Field label="Échéance">
        <input className="ds-input" type="date" value={due} min={start || undefined} onChange={(event) => onDue(event.target.value)} />
      </Field>
    </div>
  )
}

// --- Projet ----------------------------------------------------------------------------------------

function ProjectDialog() {
  const [form, setForm] = useState({ name: '', hoursPerDay: '8', budgetDays: '', localRepoPath: '', githubOwner: '', githubRepo: '' })
  const { busy, run } = useAction()
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const hoursPerDay = parseNumber(form.hoursPerDay)
    const budgetDays = parseNumber(form.budgetDays)
    if (hoursPerDay === null || hoursPerDay <= 0 || hoursPerDay > 24) return fail('« 1 jour = X heures » doit être compris entre 0 et 24.')
    if (form.budgetDays.trim() !== '' && (budgetDays === null || budgetDays < 0)) return fail('Budget initial invalide.')
    const result = await run(
      'create',
      () =>
        projectService.create({
          name: form.name.trim(),
          hoursPerDay,
          ...(budgetDays !== null && { budgetDays }),
          ...(form.localRepoPath.trim() && { localRepoPath: form.localRepoPath.trim() }),
          ...(form.githubOwner.trim() && { githubOwner: form.githubOwner.trim() }),
          ...(form.githubRepo.trim() && { githubRepo: form.githubRepo.trim() }),
        }),
      'Projet créé',
    )
    if (result.ok) {
      const { setProject, setView } = useApp.getState()
      setProject(result.value.id)
      setView('gantt')
      close()
    }
  }

  return (
    <Modal title="Nouveau projet" onClose={close} footer={<Footer busy={busy === 'create'} submitLabel="Créer le projet" />}>
      <form id="dialog-form" onSubmit={submit} className="space-y-4">
        <Field label="Nom">
          <input className="ds-input" value={form.name} onChange={set('name')} required maxLength={200} placeholder="App E-Commerce v3" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="1 jour = X heures">
            <input className="ds-input" inputMode="decimal" value={form.hoursPerDay} onChange={set('hoursPerDay')} required />
          </Field>
          <Field label="Budget initial (jours)">
            <input className="ds-input" inputMode="decimal" value={form.budgetDays} onChange={set('budgetDays')} placeholder="45" />
          </Field>
        </div>
        <Field label="Dépôt Git local (facultatif)" hint="Chemin absolu de la racine du dépôt">
          <input className="ds-input font-mono" value={form.localRepoPath} onChange={set('localRepoPath')} placeholder="/Users/…/mon-projet" spellCheck={false} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Propriétaire GitHub">
            <input className="ds-input font-mono" value={form.githubOwner} onChange={set('githubOwner')} spellCheck={false} />
          </Field>
          <Field label="Dépôt GitHub">
            <input className="ds-input font-mono" value={form.githubRepo} onChange={set('githubRepo')} spellCheck={false} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

// --- Phase, Epic, Story -----------------------------------------------------------------------------

type ContainerRequest = Extract<DialogRequest, { kind: 'phase' | 'epic' | 'story' | 'editContainer' }>
const LEVEL_TEXT = {
  phase: { create: 'Nouvelle phase', edit: 'Modifier la phase', created: 'Phase créée' },
  epic: { create: 'Nouvel epic', edit: 'Modifier l’epic', created: 'Epic créé' },
  story: { create: 'Nouvelle story', edit: 'Modifier la story', created: 'Story créée' },
} as const
const LEVEL_TYPE = { phase: 'PHASE', epic: 'EPIC', story: 'STORY' } as const

function ContainerDialog({ project, request }: { project: Project; request: ContainerRequest }) {
  const editing = request.kind === 'editContainer'
  const level = editing ? request.level : request.kind
  const [title, setTitle] = useState(editing ? request.title : '')
  const [start, setStart] = useState(editing ? (request.startDate ?? '') : '')
  const [due, setDue] = useState(editing ? (request.dueDate ?? '') : '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { busy, run } = useAction()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const body = { title: title.trim(), startDate: start || null, dueDate: due || null }
    const action = (): Promise<unknown> => {
      if (request.kind === 'editContainer') {
        if (request.level === 'phase') return hierarchyService.updatePhase(request.id, body)
        if (request.level === 'epic') return hierarchyService.updateEpic(request.id, body)
        return hierarchyService.updateStory(request.id, body)
      }
      if (request.kind === 'phase') return hierarchyService.createPhase(project.id, body)
      if (request.kind === 'epic') return hierarchyService.createEpic(request.phaseId, body)
      return hierarchyService.createStory(request.epicId, body)
    }
    const result = await run('save', action, editing ? 'Modifications enregistrées' : LEVEL_TEXT[level].created)
    if (result.ok) close()
  }

  const remove = async () => {
    if (request.kind !== 'editContainer') return
    const action = () =>
      request.level === 'phase'
        ? hierarchyService.removePhase(request.id)
        : request.level === 'epic'
          ? hierarchyService.removeEpic(request.id)
          : hierarchyService.removeStory(request.id)
    const result = await run('delete', action, 'Supprimé')
    if (result.ok) close()
  }

  const heading = (
    <span className="flex items-center gap-2">
      <TypeChip type={LEVEL_TYPE[level]} />
      {editing ? LEVEL_TEXT[level].edit : LEVEL_TEXT[level].create}
    </span>
  )

  return (
    <Modal
      title={heading}
      onClose={close}
      footer={
        <Footer
          busy={busy === 'save'}
          submitLabel={editing ? 'Enregistrer' : 'Créer'}
          extra={
            editing &&
            (confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                Supprimer avec son contenu ?
                <Button size="sm" variant="danger" busy={busy === 'delete'} onClick={remove}>
                  Oui
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                Supprimer
              </Button>
            ))
          }
        />
      }
    >
      <form id="dialog-form" onSubmit={submit} className="space-y-4">
        <Field label="Titre">
          <input className="ds-input" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </Field>
        <DateFields start={start} due={due} onStart={setStart} onDue={setDue} />
        <p className="text-xs text-muted">Sans dates, la barre du Gantt couvre les dates de son contenu.</p>
      </form>
    </Modal>
  )
}

// --- Élément (FEATURE, TASK, BUG) -------------------------------------------------------------------

function WorkItemDialog({ request }: { request: Extract<DialogRequest, { kind: 'workItem' }> }) {
  const [type, setType] = useState<WorkItemType>(request.type ?? 'FEATURE')
  const [title, setTitle] = useState('')
  const [estimate, setEstimate] = useState('')
  const [priority, setPriority] = useState<Priority>('NORMAL')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const { busy, run } = useAction()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const estimatedDays = parseNumber(estimate)
    if (estimate.trim() !== '' && (estimatedDays === null || estimatedDays < 0)) return fail('Estimation invalide.')
    const result = await run(
      'create',
      () =>
        workItemService.create(request.storyId, {
          type,
          title: title.trim(),
          priority,
          ...(estimatedDays !== null && { estimatedDays }),
          ...(start && { startDate: start }),
          ...(due && { dueDate: due }),
        }),
      `${TYPE_LABEL[type]} créée`,
    )
    if (result.ok) {
      close()
      useApp.getState().openWorkItem(result.value.id)
    }
  }

  return (
    <Modal title="Nouvel élément" onClose={close} footer={<Footer busy={busy === 'create'} submitLabel="Créer" />}>
      <form id="dialog-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
          {WORK_ITEM_TYPES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={type === candidate}
              data-type={candidate}
              onClick={() => setType(candidate)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                type === candidate ? 'border-kind bg-kind-soft font-semibold text-kind-ink' : 'border-line text-muted hover:bg-hover'
              }`}
            >
              <TypeChip type={candidate} />
              {TYPE_LABEL[candidate]}
            </button>
          ))}
        </div>
        <Field label={`Titre (${TYPE_NAME[type].toLowerCase()})`}>
          <input className="ds-input" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimation (jours)">
            <input className="ds-input" inputMode="decimal" value={estimate} onChange={(event) => setEstimate(event.target.value)} placeholder="3" />
          </Field>
          <Field label="Priorité">
            <select className="ds-select" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DateFields start={start} due={due} onStart={setStart} onDue={setDue} />
      </form>
    </Modal>
  )
}

// --- Jalon ---------------------------------------------------------------------------------------------

function MilestoneDialog({ project, request }: { project: Project; request: Extract<DialogRequest, { kind: 'milestone' | 'editMilestone' }> }) {
  const editing = request.kind === 'editMilestone'
  const tree = useApi(() => reportService.tree(project.id), [project.id])
  const existing = useApi(editing ? () => milestoneService.get(request.id) : null, [editing ? request.id : null])
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today())
  const [phaseId, setPhaseId] = useState<number | null>(request.kind === 'milestone' ? (request.phaseId ?? null) : null)
  const [reached, setReached] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { busy, run } = useAction()

  useEffect(() => {
    if (!existing.data) return
    setTitle(existing.data.title)
    setDate(existing.data.date)
    setPhaseId(existing.data.phaseId)
    setReached(existing.data.reached)
  }, [existing.data])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const result =
      request.kind === 'editMilestone'
        ? await run(
            'save',
            () =>
              milestoneService.update(request.id, {
                title: title.trim(),
                date,
                phaseId,
                ...(reached !== existing.data?.reached && { reachedAt: reached ? new Date().toISOString() : null }),
              }),
            'Jalon enregistré',
          )
        : await run(
            'save',
            () => milestoneService.create(project.id, { title: title.trim(), date, phaseId, ...(reached && { reachedAt: new Date().toISOString() }) }),
            'Jalon créé',
          )
    if (result.ok) close()
  }

  const remove = async () => {
    if (request.kind !== 'editMilestone') return
    const result = await run('delete', () => milestoneService.remove(request.id), 'Jalon supprimé')
    if (result.ok) close()
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <span className="ds-diamond" aria-hidden />
          {editing ? 'Modifier le jalon' : 'Nouveau jalon'}
        </span>
      }
      onClose={close}
      footer={
        <Footer
          busy={busy === 'save'}
          submitLabel={editing ? 'Enregistrer' : 'Créer'}
          extra={
            editing &&
            (confirmDelete ? (
              <Button size="sm" variant="danger" busy={busy === 'delete'} onClick={remove}>
                Confirmer la suppression
              </Button>
            ) : (
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                Supprimer
              </Button>
            ))
          }
        />
      }
    >
      {editing && existing.error ? (
        <p className="text-muted">{existing.error.message}</p>
      ) : (
        <form id="dialog-form" onSubmit={submit} className="space-y-4">
          <Field label="Titre">
            <input className="ds-input" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="API Core Prête" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input className="ds-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="Rattachement">
              <select className="ds-select" value={phaseId ?? ''} onChange={(event) => setPhaseId(event.target.value === '' ? null : Number(event.target.value))}>
                <option value="">Projet</option>
                {tree.data?.phases.map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {levelCode('PHASE', phase.code)} : {phase.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reached} onChange={(event) => setReached(event.target.checked)} className="accent-[var(--type-milestone)]" />
            Jalon atteint
          </label>
        </form>
      )}
    </Modal>
  )
}

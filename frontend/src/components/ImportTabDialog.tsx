// « Importer depuis Atelier Tab » (docs/SUITE.md §4.1) : choix d'un fichier JSON DataFlow v2.1.0, du projet
// cible et du type, aperçu calculé par le backend (rien n'est écrit), puis import et résumé.
// Le frontend ne fait que lire le fichier et afficher : la correspondance des statuts, le rangement et la
// détection des réimports sont faits par l'API.
import { CheckCircle2, FileJson, FileUp, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { TYPE_NAME, WORK_ITEM_TYPES } from '../lib/labels.ts'
import { shortDate } from '../lib/format.ts'
import { atelierTabService } from '../services/api.ts'
import { errorMessage } from '../services/client.ts'
import type {
  AtelierTabEnvelope,
  AtelierTabImportItem,
  AtelierTabImportResult,
  AtelierTabPreview,
  Project,
  WorkItemType,
} from '../services/types.ts'
import { useApp } from '../store/app.ts'
import { Button, Field, Modal, StatusBadge } from './ui.tsx'

/** Projet cible : celui nommé comme dans le fichier (créé au besoin), ou un projet existant. */
const BY_NAME = 'by-name'
const MAX_FILE_BYTES = 20 * 1024 * 1024

const ACTION_LABEL: Record<AtelierTabImportItem['action'], { label: string; status: 'IN_PROGRESS' | 'RESOLVED' | 'OPEN' | 'ON_HOLD' }> = {
  created: { label: 'Création', status: 'IN_PROGRESS' },
  updated: { label: 'Mise à jour', status: 'RESOLVED' },
  unchanged: { label: 'Inchangé', status: 'OPEN' },
  skipped: { label: 'Ignorée', status: 'ON_HOLD' },
}

const DONE_LABEL: Record<AtelierTabImportItem['action'], string> = {
  created: 'Créé',
  updated: 'Mis à jour',
  unchanged: 'Inchangé',
  skipped: 'Ignorée',
}

interface LoadedFile {
  name: string
  envelope: AtelierTabEnvelope
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/** Lecture du fichier : JSON et forme générale d'une enveloppe DataFlow ; la validation complète est faite par l'API. */
async function readEnvelope(file: File): Promise<AtelierTabEnvelope> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Fichier trop volumineux (20 Mo au plus).')
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Ce fichier n’est pas un JSON valide.')
  }
  const envelope = data as Partial<AtelierTabEnvelope> | null
  if (!envelope || typeof envelope !== 'object' || envelope.target_system !== 'atelier_projets' || !envelope.project) {
    throw new Error('Ce fichier n’est pas un export DataFlow d’Atelier Tab (target_system « atelier_projets » attendu).')
  }
  return envelope as AtelierTabEnvelope
}

export function ImportTabDialog({ projects, current }: { projects: Project[]; current: Project | undefined }) {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [target, setTarget] = useState<string>(BY_NAME)
  const [type, setType] = useState<WorkItemType>('TASK')
  const [preview, setPreview] = useState<AtelierTabPreview | null>(null)
  const [result, setResult] = useState<AtelierTabImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
  // Une clé par contenu : un double clic n'importe qu'une fois, un nouvel essai après modification réimporte.
  const key = useRef(newKey())
  const input = useRef<HTMLInputElement>(null)
  const close = () => useApp.getState().openDialog(null)

  const options = { ...(target !== BY_NAME && { projectId: Number(target) }), type }

  // Aperçu relu à chaque changement de fichier, de projet ou de type.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    key.current = newKey()
    setBusy('preview')
    setError(null)
    atelierTabService
      .preview(file.envelope, options)
      .then(
        (value) => !cancelled && setPreview(value),
        (reason: unknown) => {
          if (cancelled) return
          setPreview(null)
          setError(errorMessage(reason))
        },
      )
      .finally(() => !cancelled && setBusy(null))
    return () => {
      cancelled = true
    }
    // options est dérivé de target et type.
  }, [file, target, type])

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    setResult(null)
    setPreview(null)
    try {
      const envelope = await readEnvelope(chosen)
      setFile({ name: chosen.name, envelope })
      // Projet du fichier déjà présent : proposé par défaut (sinon il sera créé).
      const match = projects.find((project) => project.name === envelope.project.name.trim())
      setTarget(match ? String(match.id) : BY_NAME)
    } catch (reason) {
      setFile(null)
      setError(errorMessage(reason))
    }
  }

  const submit = async () => {
    if (!file || !preview) return
    setBusy('import')
    setError(null)
    try {
      const value = await atelierTabService.import(file.envelope, options, key.current)
      setResult(value)
      const { refresh, notify, setProject } = useApp.getState()
      refresh()
      if (value.projectId !== null && value.projectId !== current?.id) setProject(value.projectId)
      notify('success', `Import terminé : ${value.created} créé(s), ${value.updated} mis à jour.`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const items = result?.items ?? preview?.items ?? []
  const warnings = result?.warnings ?? preview?.warnings ?? []
  const counts = result ?? preview
  const importable = preview !== null && preview.created + preview.updated > 0

  return (
    <Modal
      title="Importer depuis Atelier Tab"
      onClose={close}
      width="max-w-3xl"
      guard={busy === 'import'}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Fermer
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button variant="primary" icon={<FileUp className="size-4" />} busy={busy === 'import'} disabled={!importable || busy !== null} onClick={submit}>
              {preview ? `Importer ${preview.created + preview.updated} élément(s)` : 'Importer'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-muted">
          Fichier JSON exporté par Atelier Tab (DataFlow v2.1.0). Les lignes sont rangées dans la phase « Imports Atelier Tab » ; un
          réimport du même fichier met à jour les éléments déjà importés.
        </p>

        <div className="flex items-center gap-3">
          <Button
            className="shrink-0"
            icon={<FileJson className="size-4" />}
            onClick={() => input.current?.click()}
            disabled={busy === 'import' || result !== null}
          >
            {file ? 'Changer de fichier' : 'Choisir un fichier JSON…'}
          </Button>
          {/* Champ fichier masqué (display: none) : ouvert par le bouton, hors du parcours au clavier. */}
          <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={choose} aria-label="Fichier DataFlow (JSON)" />
          {file && (
            <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
              <span className="font-mono">{file.name}</span>
              <span className="text-muted">
                {' '}
                · {file.envelope.workspace?.name} › {file.envelope.project.name}
                {file.envelope.project.source_table ? ` › ${file.envelope.project.source_table.name}` : ''}
              </span>
            </span>
          )}
        </div>

        {file && !result && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Projet cible">
              <select className="ds-select" value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value={BY_NAME}>
                  {projects.some((project) => project.name === file.envelope.project.name.trim())
                    ? `« ${file.envelope.project.name} » (même nom)`
                    : `Nouveau projet « ${file.envelope.project.name} »`}
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type des nouveaux éléments">
              <select className="ds-select" value={type} onChange={(event) => setType(event.target.value as WorkItemType)}>
                {WORK_ITEM_TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {TYPE_NAME[candidate]} ({candidate})
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {error && (
          <p className="ds-card ds-ink border-l-4 border-l-kind p-3" data-status="REJECTED" role="alert">
            {error}
          </p>
        )}

        {busy === 'preview' && !preview && <p className="text-muted">Calcul de l’aperçu…</p>}

        {counts && (
          <div className="space-y-3" aria-live="polite">
            {result ? (
              <p className="flex items-center gap-2 font-semibold" data-status="CLOSED">
                <CheckCircle2 className="size-5 text-kind" aria-hidden />
                Import terminé
              </p>
            ) : (
              preview && (
                <p className="text-sm">
                  <span className="text-muted">Destination : </span>
                  <span className="font-medium">
                    {preview.target.project.name} › {preview.target.phase.title} › {preview.target.epic.title} › {preview.target.story.title}
                  </span>
                  {!preview.target.story.exists && <span className="text-muted"> (créée à l’import)</span>}
                </p>
              )
            )}
            <div className="flex flex-wrap gap-2">
              <span className="ds-badge" data-status="IN_PROGRESS">
                {counts.created} {result ? 'créé(s)' : 'à créer'}
              </span>
              <span className="ds-badge" data-status="RESOLVED">
                {counts.updated} {result ? 'mis à jour' : 'à mettre à jour'}
              </span>
              <span className="ds-badge" data-status="OPEN">
                {counts.unchanged} inchangé(s)
              </span>
              <span className="ds-badge" data-status="ON_HOLD">
                {counts.skipped} ignorée(s)
              </span>
            </div>

            {warnings.length > 0 && (
              <div className="ds-card border-l-4 border-l-kind p-3" data-status="ON_HOLD">
                <p className="mb-1 flex items-center gap-2 font-semibold">
                  <TriangleAlert className="size-4 text-kind" aria-hidden />
                  {warnings.length} avertissement{warnings.length > 1 ? 's' : ''}
                </p>
                <ul className="max-h-24 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm text-muted">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-[min(18rem,28vh)] overflow-auto rounded-md border border-line">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="ds-num">Ligne</th>
                    <th>Titre</th>
                    <th>Statut</th>
                    <th>Échéance</th>
                    <th>{result ? 'Résultat' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.recordId}>
                      <td className="ds-num text-muted">{item.rowIndex}</td>
                      <td className="max-w-[18rem] truncate">
                        {item.title ?? <span className="italic text-muted">{item.reason ?? '—'}</span>}
                        {item.workItemId !== null && <span className="ml-2 font-mono text-xs text-muted">#{item.workItemId}</span>}
                      </td>
                      <td>{item.status ? <StatusBadge status={item.status} /> : '—'}</td>
                      <td className="whitespace-nowrap">{shortDate(item.dueDate)}</td>
                      <td>
                        <span className="ds-badge" data-plain="" data-status={ACTION_LABEL[item.action].status}>
                          {result ? DONE_LABEL[item.action] : ACTION_LABEL[item.action].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

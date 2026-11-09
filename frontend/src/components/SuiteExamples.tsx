// « Exemples de la suite » : une histoire fictive suivie d'une app à l'autre. Ici, son projet complet (phases, epics,
// stories, éléments, temps passés, jalons) et la tâche née de l'alerte d'Atelier Viz.
import { BookOpen, FolderOpen, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { exempleService } from '../services/api.ts'
import { useApp } from '../store/app.ts'
import { Button, Card } from './ui.tsx'

const APPS: Record<string, string> = {
  convert: 'Convert',
  tab: 'Tab',
  viz: 'Viz',
  tresorerie: 'Trésorerie',
  nexus: 'Nexus',
  projets: 'Projets',
  wiki: 'Wiki',
}
/** Histoire choisie, mémorisée sur l'appareil (clé commune aux apps de la suite servies depuis la même origine). */
const STORAGE_KEY = 'atelier:exemple'

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function SuiteExamples() {
  const histoires = useApi(() => exempleService.list(), [])
  const { busy, run } = useAction()
  const [selected, setSelected] = useState<string | null>(remembered)
  const list = histoires.data ?? []
  const h = list.find((x) => x.id === selected) ?? list[0]
  if (!h) return null

  const index = h.parcours.findIndex((e) => e.app === 'projets')
  const current = h.parcours[index]
  const next = h.parcours[index + 1]

  const choose = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // stockage indisponible : le choix n'est simplement pas gardé
    }
  }

  const load = async () => {
    const result = await run('load', () => exempleService.load(h.id), `Exemple « ${h.titre} » chargé`)
    if (result.ok) useApp.getState().setProject(result.value.projectId)
  }

  return (
    <Card className="space-y-3 p-4" aria-labelledby="suite-examples-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="suite-examples-title" className="flex items-center gap-2 font-semibold">
            <BookOpen className="size-4 text-accent-ink" aria-hidden />
            Exemples de la suite
          </h3>
          <p className="mt-1 text-sm text-muted">
            Des histoires fictives qui traversent toute la suite Atelier : l’alerte levée dans Viz devient ici une tâche de suivi, dans un projet complet.
          </p>
        </div>
        <select className="ds-select w-64 max-w-full" value={h.id} onChange={(event) => choose(event.target.value)} aria-label="Histoire d’exemple">
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.secteur} · {x.titre}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium">
          {h.titre} <span className="font-normal text-muted">— {h.sous_titre}</span>
        </p>
        <p className="mt-1 text-sm text-muted">{h.resume}</p>
      </div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Parcours de l’histoire dans la suite">
        {h.parcours.map((e, i) => (
          <li
            key={e.app}
            title={e.texte}
            aria-current={e.app === 'projets' ? 'step' : undefined}
            className={`inline-flex h-[22px] items-center gap-1.5 rounded-md border px-2 text-xs ${
              e.app === 'projets' ? 'border-accent-ink/40 bg-accent-soft text-accent-ink' : 'border-line text-muted'
            }`}
          >
            <span className="tabular-nums opacity-70">{i + 1}</span>
            {APPS[e.app] ?? e.app}
          </li>
        ))}
      </ol>
      {current && <p className="text-sm">{current.texte}</p>}
      <p className="text-xs text-muted">
        Projet « {h.projet} » : {h.elements} éléments, {h.jalons} jalon{h.jalons > 1 ? 's' : ''}, temps passés saisis.
      </p>

      <div className="flex flex-wrap gap-2">
        {h.charge && h.projectId !== null ? (
          <>
            <Button variant="primary" icon={<FolderOpen className="size-4" />} onClick={() => useApp.getState().setProject(h.projectId)}>
              Ouvrir le projet
            </Button>
            <Button
              icon={<Trash2 className="size-4" />}
              busy={busy === 'remove'}
              onClick={() => void run('remove', () => exempleService.remove(h.id), 'Exemple retiré')}
            >
              Retirer l’exemple
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<FolderOpen className="size-4" />} busy={busy === 'load'} onClick={() => void load()}>
            Charger l’exemple
          </Button>
        )}
      </div>

      {next && (
        <p className="border-t border-line pt-3 text-sm text-muted">
          <span className="font-medium text-fg">Ensuite, {APPS[next.app] ?? next.app}</span> — {next.texte}
        </p>
      )}
    </Card>
  )
}

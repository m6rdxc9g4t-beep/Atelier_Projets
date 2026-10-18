// Exécution d'une écriture vers l'API : état « en cours », notification, puis relecture des vues.
import { useCallback, useState } from 'react'
import { ApiError, errorMessage } from '../services/client.ts'
import { useApp } from '../store/app.ts'

export type ActionResult<T> = { ok: true; value: T } | { ok: false }

/** busy : identifiant de l'action en cours (pour l'indicateur du bon bouton), ou null. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(async <T,>(id: string, action: () => Promise<T>, success?: string): Promise<ActionResult<T>> => {
    const { notify, refresh } = useApp.getState()
    setBusy(id)
    try {
      const result = await action()
      refresh()
      if (success) notify('success', success)
      return { ok: true, value: result }
    } catch (error) {
      notify('error', errorMessage(error))
      // Ressource disparue (supprimée ailleurs) : les vues relisent l'API pour ne plus l'afficher.
      if (error instanceof ApiError && error.status === 404) refresh()
      return { ok: false }
    } finally {
      setBusy(null)
    }
  }, [])

  return { busy, run }
}

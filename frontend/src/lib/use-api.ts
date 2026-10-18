// Lecture d'une ressource de l'API, relue quand ses dépendances ou la révision globale changent.
// Après une modification (même ressource), les données précédentes restent affichées pendant la
// relecture : pas de clignotement. Pour une autre ressource (autre projet, autre élément), rien de
// périmé n'est affiché.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/app.ts'

export interface ApiState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

interface Loaded<T> {
  key: string
  data?: T
  error?: Error
}

export function useApi<T>(
  fetcher: (() => Promise<T>) | null,
  deps: readonly unknown[],
  options: { followRevision?: boolean } = {},
): ApiState<T> {
  // followRevision: false pour une ressource indépendante des données du projet (état de l'IA locale).
  const followRevision = options.followRevision ?? true
  const revision = useApp((state) => (followRevision ? state.revision : 0))
  const key = JSON.stringify([fetcher === null, ...deps])
  const [loaded, setLoaded] = useState<Loaded<T>>({ key: '' })
  const [pending, setPending] = useState(0)
  const [nonce, setNonce] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const run = fetcherRef.current
    if (!run) {
      setLoaded({ key })
      return
    }
    let cancelled = false
    setPending((count) => count + 1)
    run()
      .then(
        (data) => {
          if (!cancelled) setLoaded({ key, data })
        },
        (reason: unknown) => {
          if (!cancelled) {
            setLoaded((previous) => ({
              key,
              data: previous.key === key ? previous.data : undefined,
              error: reason instanceof Error ? reason : new Error(String(reason)),
            }))
          }
        },
      )
      .finally(() => setPending((count) => count - 1))
    return () => {
      cancelled = true
    }
  }, [key, revision, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const current = loaded.key === key
  return {
    data: current ? loaded.data : undefined,
    error: current ? loaded.error : undefined,
    loading: fetcher !== null && (pending > 0 || !current),
    reload,
  }
}

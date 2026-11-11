import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { readDeepLink, withoutDeepLink } from './lib/deep-link.ts'
import { useApp } from './store/app.ts'
import './index.css'
import '@atelier/design-system/brand/atelier-brand.css'

// Lien profond (Atelier Hub) : appliqué avant le premier rendu pour passer avant le projet enregistré.
const link = readDeepLink(location.search)
if (link) {
  const { setProject, openWorkItem } = useApp.getState()
  setProject(link.projectId)
  if (link.workItemId !== null) openWorkItem(link.workItemId)
  history.replaceState(history.state, '', withoutDeepLink(location.href))
}

const root = document.getElementById('root')
if (!root) throw new Error('Élément #root introuvable dans index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Analyseur Markdown (chargé à la demande, voir ui.tsx) : téléchargé au repos après le premier affichage,
// pour que la première fiche ouverte soit déjà mise en forme.
const whenIdle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 1500))
whenIdle(() => void import('./components/Markdown.tsx'))

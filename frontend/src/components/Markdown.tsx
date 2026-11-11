// Rendu Markdown (react-markdown + GFM). Module chargé à la demande par MarkdownText (ui.tsx) :
// l'analyseur Markdown ne pèse pas sur le premier affichage de l'application.
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function RenderedMarkdown({ children }: { children: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}>
      {children}
    </Markdown>
  )
}

import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  children: ReactNode
}

export function Panel({ title, children }: PanelProps) {
  return (
    <section aria-label={title} className="panel" role="region">
      <header className="panel__header">
        <h1>{title}</h1>
      </header>
      <div className="panel__content">{children}</div>
    </section>
  )
}

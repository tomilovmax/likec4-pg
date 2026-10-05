import { useMemo } from 'react'

import { LikeC4Model } from '@likec4/core/model'
import type { LayoutedLikeC4ModelData } from '@likec4/core/types'
import { LikeC4ModelProvider, ReactLikeC4 } from 'likec4/react'

import type { DiagramModelData } from '@likec4-web-ide/contracts'

interface LikeC4DiagramViewProps {
  model: DiagramModelData
  viewId: string
  onNavigateTo: (viewId: string) => void
}

// REQ-15: официальный renderer — субпаф likec4/react пакета likec4@1.59.4
// (внутри него забандлен @likec4/diagram; стили изолированы в ShadowRoot).
// Модель приходит с /api/diagram как $data layoutedModel() и оживляется
// официальной фабрикой клиента. Ошибки create/render ловит DiagramErrorBoundary.
export function LikeC4DiagramView({ model, viewId, onNavigateTo }: LikeC4DiagramViewProps) {
  const likec4model = useMemo(
    () => LikeC4Model.create(model as unknown as LayoutedLikeC4ModelData),
    [model],
  )
  return (
    <LikeC4ModelProvider likec4model={likec4model}>
      <ReactLikeC4
        viewId={viewId}
        pannable
        zoomable
        controls
        fitView
        onNavigateTo={(nextViewId: string) => {
          onNavigateTo(nextViewId)
        }}
      />
    </LikeC4ModelProvider>
  )
}

export default LikeC4DiagramView

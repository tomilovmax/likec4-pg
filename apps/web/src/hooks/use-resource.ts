import { useCallback, useEffect, useState } from 'react'

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

export function useResource<T>(load: () => Promise<T>): {
  state: ResourceState<T>
  reload: () => void
} {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' })
  const [requestNumber, setRequestNumber] = useState(0)

  const reload = useCallback(() => {
    setRequestNumber((currentRequestNumber) => currentRequestNumber + 1)
  }, [])

  useEffect(() => {
    let isCurrent = true

    setState({ status: 'loading' })
    void load().then(
      (data) => {
        if (isCurrent) {
          setState({ status: 'ready', data })
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Request failed',
          })
        }
      },
    )

    return () => {
      isCurrent = false
    }
  }, [load, requestNumber])

  return { state, reload }
}

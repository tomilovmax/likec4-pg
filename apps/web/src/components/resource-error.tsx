interface ResourceErrorProps {
  message: string
  onRetry: () => void
}

export function ResourceError({ message, onRetry }: ResourceErrorProps) {
  return (
    <div className="resource-state resource-state--error" role="alert">
      <p>Не удалось загрузить данные.</p>
      <p className="resource-state__detail">{message}</p>
      <button onClick={onRetry} type="button">
        Повторить
      </button>
    </div>
  )
}

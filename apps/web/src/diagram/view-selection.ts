// REQ-16: выбранная view живёт в URL hash (#view=<id>). Selection переживает
// refresh страницы и повторную загрузку модели, а ссылка на конкретную
// диаграмму shareable. Значение не является путём файла — только id view
// из ответа /api/diagram.
const VIEW_HASH_PREFIX = '#view='

export function readSelectedViewFromLocation(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith(VIEW_HASH_PREFIX)) {
    return null
  }
  const id = decodeURIComponent(hash.slice(VIEW_HASH_PREFIX.length))
  return id === '' ? null : id
}

export function writeSelectedViewToLocation(viewId: string): void {
  // replaceState, а не присвоение location.hash: переходы между views
  // не засоряют history браузера кнопкой «Назад».
  window.history.replaceState(null, '', `${VIEW_HASH_PREFIX}${encodeURIComponent(viewId)}`)
}

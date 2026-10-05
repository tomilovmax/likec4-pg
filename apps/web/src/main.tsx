import { createRoot } from 'react-dom/client'

import { App } from './app'
import './styles.css'

const container = document.getElementById('root')

if (container === null) {
  throw new Error('Root container is missing')
}

// Без StrictMode: его двойное монтирование в dev переинициализирует VS Code
// services Monaco, которые инициализируются строго один раз (REQ-19).
createRoot(container).render(<App />)

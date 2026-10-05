import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['apps/web/**/*.test.tsx', 'jsdom']],
    exclude: ['**/dist/**', '**/node_modules/**'],
    // Интеграционные тесты REQ-14/15 платят инициализацию официального API
    // likec4 (language-стек, layout-wasm) на первом вызове; при параллельном
    // запуске файлов она не укладывается в дефолтные 5 секунд.
    testTimeout: 30_000,
  },
})

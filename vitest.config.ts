import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['apps/web/**/*.test.tsx', 'jsdom']],
    exclude: ['**/dist/**', '**/node_modules/**'],
  },
})

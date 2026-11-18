import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __MYHKU_APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
  },
})

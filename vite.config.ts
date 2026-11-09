import { defineConfig } from 'vite'
export default defineConfig({ base: process.env.VITE_BASE || '/', clearScreen: false, server: { port: 1420, strictPort: true, host: '127.0.0.1' }, envPrefix: ['VITE_', 'TAURI_ENV_*'] })

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// MOCK_BRIDGE=1 swaps @forge/bridge for dev/bridge-mock.js (local preview only).
const mock = process.env.MOCK_BRIDGE
  ? { '@forge/bridge': fileURLToPath(new URL('./dev/bridge-mock.js', import.meta.url)) }
  : {};
export default defineConfig({ plugins: [react()], base: './', resolve: { alias: mock } });

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const browserHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "frame-src https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    headers: browserHeaders,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    watch: { ignored: ['**/data/**', '**/dist/**', '**/evidence/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, headers: browserHeaders },
});

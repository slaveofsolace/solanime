import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be a valid API port.');
  const target = `http://127.0.0.1:${port}`;
  const proxy = { '/api': { target, changeOrigin: false } };
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "script-src 'self' https://www.youtube.com; frame-src https://www.youtube-nocookie.com https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  };
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, headers },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy, headers },
  };
});

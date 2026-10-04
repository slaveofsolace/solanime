import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Full-resolution brand sources stay in the repository for the branding scripts;
// the site only references the derived WebP/PNG files, so the sources are not published.
const UNPUBLISHED_BRAND_SOURCES = [
  'branding/solanime-approved-master.png',
  'branding/sun-cloudscape-source.png',
  'branding/ribbon-foreground-source.png',
  'branding/provenance.json',
];
function omitBrandSources(): Plugin {
  let outDir = 'dist';
  return {
    name: 'solanime-omit-brand-sources',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      await Promise.all(UNPUBLISHED_BRAND_SOURCES.map((file) => rm(resolve(outDir, file), { force: true })));
    },
  };
}
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
      "script-src 'self' https://www.youtube.com https://challenges.cloudflare.com; frame-src https://www.youtube-nocookie.com/embed/ https://megaplay.buzz/stream/s-2/ https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  };
  // Vite's React refresh preamble is an inline module. Permit it only in the
  // local development server; preview and deployed builds retain the strict CSP.
  const developmentHeaders = {
    ...headers,
    'Content-Security-Policy': headers['Content-Security-Policy'].replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
  return {
    plugins: [react(), omitBrandSources()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy, headers: developmentHeaders },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy, headers },
  };
});

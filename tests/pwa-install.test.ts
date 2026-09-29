import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as {
  id: string;
  start_url: string;
  scope: string;
  display: string;
  icons: Array<{ src: string; sizes: string; type: string }>;
};

describe('installable Solanime web app', () => {
  it('keeps the stable app identity and launch inside the site', () => {
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });

  it('ships real 192 and 512 pixel PNG icons', () => {
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(candidate => candidate.sizes === `${size}x${size}`);
      expect(icon?.type).toBe('image/png');
      const bytes = readFileSync(resolve(root, 'public', icon!.src.replace(/^\//, '')));
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    }
  });
});

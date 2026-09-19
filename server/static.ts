import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; media-src 'self' https: blob:; worker-src 'self' blob:; frame-src https://www.youtube-nocookie.com https://megaplay.buzz; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
};
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const inside = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};
/** Serve only the build directory. Missing assets and API routes never become HTML data responses. */
export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  directory: string,
): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (
    pathname.includes('\\') ||
    /[\x00-\x1f]/.test(pathname) ||
    pathname.split('/').some((part) => part.startsWith('.') || part.startsWith('_'))
  )
    return false;
  const root = await realpath(directory);
  let file = resolve(root, `.${pathname}`);
  if (!inside(root, file)) return false;
  const appRoute =
    /^\/(?:catalogue|search|library|admin(?:\/sources)?|login|register|recover|profiles|account(?:\/recovery-code)?|title\/[^/]+|watch\/[^/]+\/[^/]+)?\/?$/.test(
      pathname,
    );
  if (appRoute) file = resolve(root, 'index.html');
  try {
    file = await realpath(file);
    if (!inside(root, file)) return false;
    const info = await stat(file);
    if (!info.isFile() || !mime[extname(file)]) return false;
    const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
    const headers = {
      ...securityHeaders,
      'Content-Type': mime[extname(file)],
      ETag: etag,
      'Cache-Control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers);
      response.end();
      return true;
    }
    response.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      response.once('close', () => stream.destroy());
      stream.pipe(response);
    }
    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    )
      return false;
    throw error;
  }
}

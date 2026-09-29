import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../errors.ts';
export async function readBody(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new AppError(413, 'BAD_REQUEST', 'Request body is too large.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data as Record<string, unknown>;
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Request body must be a JSON object.');
  }
}
export function reply(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...headers,
  });
  response.end(JSON.stringify(body));
}
export function cookieValue(request: IncomingMessage, name: string) {
  const matches = (request.headers.cookie ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

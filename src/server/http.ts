import { ZodError } from 'zod';
import { DatabaseError } from './database';

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return json({ error: error.issues.map(issue => issue.message).join('; ') }, 400);
  if (error instanceof DatabaseError) return json({ error: error.message }, error.status);
  if (error instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400);
  console.error('Sandbox request failed', error);
  return json({ error: 'The local server could not complete this request. Your draft is still in the editor.' }, 500);
}
export async function readBody(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (raw.length > 150_000) throw new DatabaseError('Request exceeds 150 KB', 413);
  return JSON.parse(raw);
}
// This local demo has no authentication; do not allow another website to write
// through the browser to the loopback server.
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  // Next may construct request.url with an internal localhost hostname even
  // when the browser reached 127.0.0.1. Host preserves the incoming authority;
  // never use forwarded headers to decide which origins can mutate local data.
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let allowed = false;
  try {
    const parsed = new URL(origin);
    allowed = ['http:', 'https:'].includes(parsed.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      && parsed.host === host
      && request.headers.get('sec-fetch-site') !== 'cross-site';
  } catch { /* An invalid or opaque origin is not a local browser origin. */ }
  if (!allowed) throw new DatabaseError('Cross-origin writes are not allowed', 403);
}
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

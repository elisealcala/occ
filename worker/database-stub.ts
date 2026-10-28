// Cloudflare requests are handled by the Worker before Next route handlers.
export function getRepository(): never {
  throw new Error('The local SQLite repository is unavailable in Workers');
}

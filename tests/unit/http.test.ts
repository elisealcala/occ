import { describe, expect, it } from 'vitest';
import { checkOrigin } from '../../src/server/http';

function localRequest(headers: Record<string, string> = {}, url = 'http://localhost:3101/api/experiments') {
  return new Request(url, { method: 'POST', headers });
}

describe('local write origin guard', () => {
  it('accepts a browser using 127.0.0.1 when Next internally constructs a localhost URL', () => {
    const request = localRequest({ host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'sec-fetch-site': 'same-origin' });
    expect(() => checkOrigin(request)).not.toThrow();
  });

  it.each(['localhost:3101', '[::1]:3101'])('accepts the matching local browser authority %s', host => {
    expect(() => checkOrigin(localRequest({ host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }))).not.toThrow();
  });

  it('uses the request URL authority when Host is unavailable', () => {
    expect(() => checkOrigin(localRequest({ origin: 'http://localhost:3101' }))).not.toThrow();
  });

  it.each([
    { host: 'example.com:3101', origin: 'http://example.com:3101' },
    { host: '127.0.0.1:3101', origin: 'http://example.com:3101' },
    { host: '127.0.0.1:3101', origin: 'null' },
    { host: '127.0.0.1:3101', origin: 'not a URL' },
    { host: '127.0.0.1:3101', origin: 'ftp://127.0.0.1:3101' },
  ])('rejects foreign, opaque, or invalid browser origin $origin', headers => {
    expect(() => checkOrigin(localRequest(headers))).toThrow('Cross-origin writes are not allowed');
  });

  it.each([
    { host: '127.0.0.1:3101', origin: 'http://localhost:3101' },
    { host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3102' },
  ])('rejects a mismatched host or port: $origin against $host', headers => {
    expect(() => checkOrigin(localRequest(headers))).toThrow('Cross-origin writes are not allowed');
  });

  it('rejects browser cross-site metadata even when the origin authority matches', () => {
    const request = localRequest({ host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'sec-fetch-site': 'cross-site' });
    expect(() => checkOrigin(request)).toThrow('Cross-origin writes are not allowed');
  });

  it('does not let forged forwarded headers authorize a mismatched origin', () => {
    const request = localRequest({
      host: '127.0.0.1:3101', origin: 'http://localhost:3101',
      'x-forwarded-host': 'localhost:3101', 'x-forwarded-proto': 'http',
      forwarded: 'host=localhost:3101;proto=http',
    });
    expect(() => checkOrigin(request)).toThrow('Cross-origin writes are not allowed');
  });

  it('ignores forwarded headers when the actual local Host and Origin match', () => {
    const request = localRequest({ host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'x-forwarded-host': 'example.com' });
    expect(() => checkOrigin(request)).not.toThrow();
  });

  it('permits a nonbrowser request without an Origin header', () => {
    expect(() => checkOrigin(localRequest({ host: '127.0.0.1:3101' }))).not.toThrow();
  });
});

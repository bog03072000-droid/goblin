import { describe, it, expect } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { timingSafeTokenMatch, AuthRateLimiter, extractToken } from '../../src/main/security/httpTokenAuth';

describe('timingSafeTokenMatch', () => {
  it('returns true for identical tokens', () => {
    expect(timingSafeTokenMatch('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different tokens of the same length', () => {
    expect(timingSafeTokenMatch('abc123', 'abc124')).toBe(false);
  });

  it('returns false (never throws) for tokens of different lengths', () => {
    expect(timingSafeTokenMatch('short', 'a-much-longer-token-value')).toBe(false);
  });

  it('returns false for an empty provided token against a real one', () => {
    expect(timingSafeTokenMatch('', 'real-token')).toBe(false);
  });
});

describe('AuthRateLimiter', () => {
  it('is not blocked before any failures', () => {
    const limiter = new AuthRateLimiter(3, 60_000);
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('blocks a source after maxAttempts failures within the window', () => {
    const limiter = new AuthRateLimiter(3, 60_000);
    limiter.recordFailure('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
  });

  it('tracks each source independently', () => {
    const limiter = new AuthRateLimiter(1, 60_000);
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    expect(limiter.isBlocked('5.6.7.8')).toBe(false);
  });

  it('recordSuccess clears a source\'s failure count', () => {
    const limiter = new AuthRateLimiter(2, 60_000);
    limiter.recordFailure('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    limiter.recordSuccess('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('a window that has expired resets the count instead of staying blocked forever', () => {
    const limiter = new AuthRateLimiter(1, 10); // 10ms window
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.isBlocked('1.2.3.4')).toBe(false);
        resolve();
      }, 20);
    });
  });
});

describe('extractToken', () => {
  function makeRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
    const req = new IncomingMessage(new Socket());
    req.url = url;
    req.headers = headers;
    return req;
  }

  it('reads the token from a ?token= query parameter', () => {
    expect(extractToken(makeRequest('/profiles?token=abc123'))).toBe('abc123');
  });

  it('reads the token from an Authorization: Bearer header when no query param is present', () => {
    expect(extractToken(makeRequest('/profiles', { authorization: 'Bearer xyz789' }))).toBe('xyz789');
  });

  it('prefers the query parameter over the header when both are present', () => {
    expect(extractToken(makeRequest('/profiles?token=from-query', { authorization: 'Bearer from-header' }))).toBe(
      'from-query',
    );
  });

  it('returns null when neither is present', () => {
    expect(extractToken(makeRequest('/profiles'))).toBeNull();
  });

  it('returns null for a malformed (non-Bearer) Authorization header', () => {
    expect(extractToken(makeRequest('/profiles', { authorization: 'Basic dXNlcjpwYXNz' }))).toBeNull();
  });
});

import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';

/**
 * Shared by every local, token-gated HTTP listener this app exposes —
 * originally written for automationProxy.ts's per-profile CDP proxy, and
 * reused verbatim (not reimplemented) by restApiServer.ts's app-level
 * profile-management API, since both need exactly the same guarantee:
 * reject anyone without the right token, without leaking timing
 * information about how close a wrong guess was, and without letting
 * unlimited guessing happen even against a long random token.
 */

export function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is compared first (leaks only the length, which isn't secret —
  // every token this app generates is the same fixed length anyway) so
  // timingSafeEqual is never called on unequal-length buffers, which would
  // throw rather than return false.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Limits repeated bad-token attempts from the same source within a rolling
 * window. "Loopback-only" narrows WHO can reach this port, not how many
 * guesses they get once they're on the machine — any other local process
 * (malware, a compromised browser extension with localhost fetch access,
 * etc.) can still hit it, and the token is the only thing standing between
 * it and full control of whatever this token gates. The token itself is
 * long and random enough that brute-forcing it outright isn't realistic
 * even unthrottled, but this still closes off cheap scanning/hammering and
 * is standard defense-in-depth for anything token-gated, regardless of how
 * strong the token is. */
export class AuthRateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxAttempts = 20,
    private readonly windowMs = 60_000,
  ) {}

  /** Whether `source` is currently blocked, without recording anything. */
  isBlocked(source: string): boolean {
    const entry = this.attempts.get(source);
    if (!entry || Date.now() - entry.windowStart > this.windowMs) return false;
    return entry.count >= this.maxAttempts;
  }

  /** Records one failed auth attempt for `source`, starting (or restarting,
   * if the previous window has expired) its window as needed. */
  recordFailure(source: string): void {
    const now = Date.now();
    const entry = this.attempts.get(source);
    if (!entry || now - entry.windowStart > this.windowMs) {
      this.attempts.set(source, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  /** Clears a source's record on successful auth, so a client that mistyped
   * a token a few times isn't punished for the rest of the window once it
   * gets it right. */
  recordSuccess(source: string): void {
    this.attempts.delete(source);
  }
}

export function extractToken(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

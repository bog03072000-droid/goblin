import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeTokenMatch, AuthRateLimiter, extractToken } from '../security/httpTokenAuth';
import type { ProfileRepository } from '../database/profileRepository';
import type { ProfileManager } from '../profiles/profileManager';
import type { TemplateRepository } from '../database/templateRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import { createProfileWithFingerprint } from '../profiles/createProfileWithFingerprint';
import { ProfileCreateInputSchema, ProfileUpdateInputSchema } from '../../shared/schemas/profile';

export interface RestApiServerHandle {
  close(): void;
}

export interface RestApiServerDeps {
  profiles: ProfileRepository;
  profileManager: ProfileManager;
  templates: TemplateRepository;
  fingerprints: FingerprintRepository;
}

/** Same shape every other route handler in this module returns — a plain
 * value to JSON-serialize plus the status code to send it with. Letting a
 * handler throw instead (e.g. "profile not found") is caught centrally in
 * `dispatch()` and mapped to a 404/400/500 there, so no individual route
 * needs its own try/catch. */
type RouteResult = { status: number; body: unknown };

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Thrown by a route handler to produce a specific status code/message —
 * anything else thrown (a genuine bug, a repository error) falls through to
 * a generic 500 in `dispatch()` rather than leaking an internal stack trace
 * to the client. */
class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function notFound(): never {
  throw new HttpError(404, 'Profile not found');
}

async function dispatch(deps: RestApiServerDeps, req: IncomingMessage): Promise<RouteResult> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = req.method ?? 'GET';
  // Matches "/profiles", "/profiles/<id>", "/profiles/<id>/start",
  // "/profiles/<id>/stop" — a deliberately small, fixed route set (not a
  // generic router library) since there are exactly six endpoints total.
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] !== 'profiles') {
    throw new HttpError(404, 'Not found');
  }

  if (segments.length === 1) {
    if (method === 'GET') {
      const list = deps.profiles.list({
        search: url.searchParams.get('search') ?? undefined,
        tag: url.searchParams.get('tag') ?? undefined,
        groupId: url.searchParams.get('groupId') ?? undefined,
      });
      return { status: 200, body: list };
    }
    if (method === 'POST') {
      const raw = await readJsonBody(req);
      const parsed = ProfileCreateInputSchema.safeParse(raw);
      if (!parsed.success) throw new HttpError(400, parsed.error.message);
      const profile = createProfileWithFingerprint(deps, parsed.data);
      return { status: 201, body: profile };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const id = segments[1]!;

  if (segments.length === 2) {
    if (method === 'GET') {
      const profile = deps.profiles.getById(id) ?? notFound();
      return { status: 200, body: profile };
    }
    if (method === 'PATCH') {
      if (!deps.profiles.getById(id)) notFound();
      const raw = await readJsonBody(req);
      const parsed = ProfileUpdateInputSchema.safeParse({ ...(typeof raw === 'object' && raw ? raw : {}), id });
      if (!parsed.success) throw new HttpError(400, parsed.error.message);
      const updated = deps.profiles.update(id, parsed.data);
      return { status: 200, body: updated };
    }
    if (method === 'DELETE') {
      if (!deps.profiles.getById(id)) notFound();
      deps.profileManager.delete(id);
      return { status: 204, body: undefined };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (segments.length === 3 && method === 'POST') {
    if (!deps.profiles.getById(id)) notFound();
    if (segments[2] === 'start') {
      const profile = deps.profileManager.start(id);
      return { status: 200, body: profile };
    }
    if (segments[2] === 'stop') {
      const profile = await deps.profileManager.stop(id);
      return { status: 200, body: profile };
    }
  }

  throw new HttpError(404, 'Not found');
}

/**
 * App-level REST API for profile CRUD — create/list/get/update/delete/
 * start/stop over plain HTTP, distinct from automationProxy.ts's per-profile
 * CDP proxy (which drives an already-running profile's *browser*; this
 * drives the profile manager itself, the same operations the app's own UI
 * performs). Same security posture as that proxy, reusing the identical
 * primitives from httpTokenAuth.ts rather than a separate implementation:
 * bound to 127.0.0.1 only, every request must present a token
 * (`?token=`/`Authorization: Bearer`) checked with `crypto.timingSafeEqual`,
 * and repeated bad-token attempts from one source are rate-limited. See
 * README's Automation section for the real usage examples this mirrors.
 */
export function startRestApiServer(params: {
  port: number;
  token: string;
  deps: RestApiServerDeps;
  rateLimiter?: AuthRateLimiter;
}): Promise<RestApiServerHandle> {
  const { port, token, deps } = params;
  const rateLimiter = params.rateLimiter ?? new AuthRateLimiter();

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const source = req.socket.remoteAddress ?? 'unknown';
    if (rateLimiter.isBlocked(source)) {
      sendJson(res, 429, { error: 'Too many failed token attempts — try again later' });
      return;
    }
    const provided = extractToken(req);
    if (!provided || !timingSafeTokenMatch(provided, token)) {
      rateLimiter.recordFailure(source);
      sendJson(res, 401, { error: 'Missing or invalid API token' });
      return;
    }
    rateLimiter.recordSuccess(source);

    try {
      const result = await dispatch(deps, req);
      sendJson(res, result.status, result.body);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const server = http.createServer((req, res) => {
    void handleHttp(req, res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => server.close() });
    });
  });
}

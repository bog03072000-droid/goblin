import { z } from 'zod';

/** Mirrors the subset of Electron's own Cookie/CookiesSetDetails shape this
 * app's UI actually surfaces — cookies only ever exist inside a running
 * profile's own child-process session (see profileManager.ts's
 * sendChildRequest), so this is what crosses that process boundary, not a
 * DB-persisted record of its own. */
export const CookieInfoSchema = z.object({
  domain: z.string().optional(),
  name: z.string(),
  value: z.string(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']).optional(),
  /** Seconds since the epoch; absent means a session cookie. */
  expirationDate: z.number().optional(),
  session: z.boolean().optional(),
});
export type CookieInfo = z.infer<typeof CookieInfoSchema>;

/** Input for setting/editing one cookie — `url` (not `domain`) is what
 * Electron's session.cookies.set() actually keys off of; the UI derives it
 * from the cookie's own domain (defaulting to https://) when the user
 * hasn't started from an existing row. */
export const CookieSetInputSchema = z.object({
  url: z.string(),
  name: z.string().min(1),
  value: z.string(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(['unspecified', 'no_restriction', 'lax', 'strict']).optional(),
  expirationDate: z.number().optional(),
});
export type CookieSetInput = z.infer<typeof CookieSetInputSchema>;

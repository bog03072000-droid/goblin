import { z } from 'zod';

export const ProxyProtocolSchema = z.enum(['http', 'https', 'socks5']);
export type ProxyProtocol = z.infer<typeof ProxyProtocolSchema>;

export const ProxySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  protocol: ProxyProtocolSchema,
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Filled in by the periodic health-check scheduler (see
  // src/main/proxy/proxyHealthScheduler.ts), not just the manual "Test"
  // button — null until the first scheduled check runs.
  lastCheckStatus: z.enum(['OK', 'FAIL']).nullable(),
  lastCheckedAt: z.string().nullable(),
  lastCheckLatencyMs: z.number().nullable(),
});
export type ProxyRecord = z.infer<typeof ProxySchema>;

export const ProxyInputSchema = z.object({
  name: z.string().min(1).max(120),
  protocol: ProxyProtocolSchema,
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional(),
});
export type ProxyInput = z.infer<typeof ProxyInputSchema>;

export interface ProxyTestResult {
  success: boolean;
  latencyMs: number | null;
  error: string | null;
}

/** One row from proxy_check_history — every scheduled or manual health
 * check, not just the most recent (which lives on ProxyRecord itself via
 * lastCheckStatus/lastCheckedAt/lastCheckLatencyMs). See
 * ProxyRepository.recordCheckResult()/listCheckHistory(). */
export const ProxyCheckHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['OK', 'FAIL']),
  latencyMs: z.number().nullable(),
  checkedAt: z.string(),
});
export type ProxyCheckHistoryEntry = z.infer<typeof ProxyCheckHistoryEntrySchema>;

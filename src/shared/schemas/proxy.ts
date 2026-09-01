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

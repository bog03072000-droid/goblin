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

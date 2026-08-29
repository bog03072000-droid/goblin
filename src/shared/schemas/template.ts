import { z } from 'zod';
import { OsSchema } from './fingerprint';

export const TemplateDefinitionSchema = z.object({
  os: OsSchema,
  locale: z.string().min(2).optional(),
});
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: TemplateDefinitionSchema,
  createdAt: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

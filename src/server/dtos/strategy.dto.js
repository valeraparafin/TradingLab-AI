import { z } from 'zod';

export const UpdateStrategyDTO = z.object({
  name: z.string().optional(),
  logicTemplateId: z.string().optional(),
  riskTemplateId: z.string().optional(),
  settings: z.record(z.any()).optional(),
});

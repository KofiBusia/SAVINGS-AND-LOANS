import { z } from 'zod';
import { validateGhanaCard } from '../utils/ghana-validators';

export const GhanaCardSchema = z.object({
  cardNumber: z
    .string()
    .regex(/^GHA-\d{8}-\d$/, 'Ghana Card must match format GHA-XXXXXXXX-X')
    .refine((val) => {
      try { validateGhanaCard(val); return true; } catch { return false; }
    }, 'Invalid Ghana Card checksum'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  verificationMethod: z.enum(['OCR_PLUS_NIA', 'NIA_DIRECT', 'OFFLINE_CACHED']),
  livenessScore: z.number().min(0).max(100),
  niaReferenceCode: z.string().min(1),
});

export type GhanaCardInput = z.infer<typeof GhanaCardSchema>;

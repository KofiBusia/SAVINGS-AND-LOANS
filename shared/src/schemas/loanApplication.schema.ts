import { z } from 'zod';
import { DCD_2025 } from '../constants/compliance';

export const LoanApplicationSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  requestedAmount: z.number().positive().max(1_000_000),
  termMonths: z.number().int().min(1).max(60),
  purpose: z.string().min(10).max(500),
  annualInterestRatePercent: z
    .number()
    .positive()
    .max(DCD_2025.MAX_INTEREST_RATE_PA, `Rate cannot exceed BoG cap of ${DCD_2025.MAX_INTEREST_RATE_PA}%`),
  // Compounding is never a valid option - field must not exist
  interestType: z.literal('SIMPLE'),
  collateralDescription: z.string().optional(),
  guarantorCustomerId: z.string().uuid().optional(),
  preAgreementAcknowledged: z.boolean().refine((v) => v === true, 'Pre-agreement must be acknowledged'),
  consentTimestamp: z.string().datetime(),
});

export type LoanApplicationInput = z.infer<typeof LoanApplicationSchema>;

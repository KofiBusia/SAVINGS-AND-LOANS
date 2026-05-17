import { z } from 'zod';

export const KYC_STATES = [
  'PENDING_GHANA_CARD',
  'PENDING_LIVENESS',
  'PENDING_ADDRESS',
  'PENDING_INCOME',
  'PENDING_PEP_SCREENING',
  'PENDING_RISK_CLASSIFICATION',
  'PENDING_EDD',
  'PENDING_BENEFICIAL_OWNERSHIP',
  'PENDING_CONSENT',
  'PENDING_PRE_AGREEMENT',
  'PENDING_ESIGNATURE',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;

export const KYC_TRANSITIONS: Record<string, string[]> = {
  PENDING_GHANA_CARD: ['PENDING_LIVENESS', 'REJECTED'],
  PENDING_LIVENESS: ['PENDING_ADDRESS', 'REJECTED'],
  PENDING_ADDRESS: ['PENDING_INCOME'],
  PENDING_INCOME: ['PENDING_PEP_SCREENING'],
  PENDING_PEP_SCREENING: ['PENDING_RISK_CLASSIFICATION', 'REJECTED'],
  PENDING_RISK_CLASSIFICATION: ['PENDING_EDD', 'PENDING_BENEFICIAL_OWNERSHIP'],
  PENDING_EDD: ['PENDING_BENEFICIAL_OWNERSHIP', 'REJECTED'],
  PENDING_BENEFICIAL_OWNERSHIP: ['PENDING_CONSENT'],
  PENDING_CONSENT: ['PENDING_PRE_AGREEMENT'],
  PENDING_PRE_AGREEMENT: ['PENDING_ESIGNATURE'],
  PENDING_ESIGNATURE: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  REJECTED: [],
};

export function assertValidKycTransition(from: string, to: string): void {
  const allowed = KYC_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid KYC state transition: ${from} → ${to}. Allowed: ${allowed.join(', ')}`);
  }
}

export const KycWorkflowSchema = z.object({
  customerId: z.string().uuid(),
  currentState: z.enum(KYC_STATES),
  targetState: z.enum(KYC_STATES),
  actorUserId: z.string(),
  reason: z.string().optional(),
});

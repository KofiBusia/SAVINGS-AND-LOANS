/**
 * Immutable audit log interface with SHA-256 hash chain.
 * Required by Cybersecurity Act 1038.
 * Each entry is linked to previous via hash: SHA256(prevHash + action + timestamp + userId)
 */

export type AuditAction =
  | 'KYC_STATE_CHANGE'
  | 'LOAN_CREATED' | 'LOAN_APPROVED' | 'LOAN_DISBURSED' | 'LOAN_REPAYMENT' | 'LOAN_RESTRUCTURED'
  | 'SAVINGS_DEPOSIT' | 'SAVINGS_WITHDRAWAL'
  | 'CUSTOMER_CREATED' | 'CUSTOMER_UPDATED' | 'CUSTOMER_SUSPENDED'
  | 'STR_SUBMITTED' | 'CTR_SUBMITTED' | 'BOG_REPORT_GENERATED'
  | 'USER_LOGIN' | 'USER_LOGOUT' | 'USER_LOGIN_FAILED' | 'MFA_VERIFIED' | 'MFA_FAILED'
  | 'DATA_EXPORT' | 'DSAR_SUBMITTED' | 'CONSENT_GIVEN' | 'CONSENT_WITHDRAWN'
  | 'BREAK_GLASS_ACCESS' | 'DATA_RESIDENCY_VIOLATION' | 'SECURITY_ALERT'
  | 'PRODUCT_CONFIGURED' | 'ROLE_ASSIGNED' | 'ROLE_REVOKED';

export interface AuditLogEntry {
  id: string;
  sequenceNumber: number;       // Monotonically increasing
  hash: string;                 // SHA256(prevHash + action + timestamp + userId)
  prevHash: string;             // Hash of previous entry (GENESIS_HASH for first)
  action: AuditAction;
  timestamp: string;            // ISO 8601 UTC
  userId: string;               // Actor performing the action
  customerId?: string;          // Affected customer (if applicable)
  entityType?: string;          // 'LOAN' | 'SAVINGS' | 'CUSTOMER' etc.
  entityId?: string;
  metadata: Record<string, unknown>;  // Action-specific data
  ipAddress?: string;
  deviceId?: string;
  branchCode?: string;
  // IMMUTABLE: these fields must never be updated after creation
  readonly isImmutable: true;
}

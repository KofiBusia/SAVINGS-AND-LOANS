/** Typed error codes for all regulatory violations, validation errors, and integration errors */

export enum RegulatoryErrorCode {
  // Digital Credit Directive 2025
  COMPOUNDING_INTEREST_PROHIBITED = 'DCD2025_001',
  INTEREST_RATE_EXCEEDS_CAP = 'DCD2025_002',
  PRE_AGREEMENT_NOT_DISPLAYED = 'DCD2025_003',
  COMPLAINT_SLA_EXCEEDED = 'DCD2025_004',

  // AML Act 1044
  KYC_INCOMPLETE = 'AML1044_001',
  GHANA_CARD_REQUIRED = 'AML1044_002',
  PEP_SCREENING_REQUIRED = 'AML1044_003',
  CTR_THRESHOLD_EXCEEDED = 'AML1044_004',
  STR_REQUIRED = 'AML1044_005',
  EDD_REQUIRED = 'AML1044_006',

  // Data Protection Act 843
  DATA_RESIDENCY_VIOLATION = 'DPA843_001',
  CONSENT_NOT_OBTAINED = 'DPA843_002',
  DSAR_SLA_EXCEEDED = 'DPA843_003',
  UNAUTHORIZED_PII_EXPORT = 'DPA843_004',

  // Cybersecurity Act 1038
  MFA_REQUIRED = 'CYB1038_001',
  AUDIT_LOG_TAMPERED = 'CYB1038_002',
  SESSION_EXPIRED = 'CYB1038_003',
  BREAK_GLASS_UNAUTHORIZED = 'CYB1038_004',
}

export enum ValidationErrorCode {
  INVALID_GHANA_CARD = 'VAL_001',
  INVALID_PHONE_NUMBER = 'VAL_002',
  INVALID_AMOUNT = 'VAL_003',
  INVALID_LOAN_TERM = 'VAL_004',
  INVALID_KYC_STATE_TRANSITION = 'VAL_005',
  INVALID_GHANA_POST_GPS = 'VAL_006',
}

export enum IntegrationErrorCode {
  GHIPSS_TIMEOUT = 'INT_001',
  GHIPSS_FAILED = 'INT_002',
  NIA_VERIFICATION_FAILED = 'INT_003',
  BUREAU_SUBMISSION_FAILED = 'INT_004',
  FIC_REPORT_FAILED = 'INT_005',
  PAYMENT_GATEWAY_FAILED = 'INT_006',
}

export class RegulatoryError extends Error {
  constructor(
    public readonly code: RegulatoryErrorCode,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'RegulatoryError';
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly code: ValidationErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'ValidationError';
  }
}

export class IntegrationError extends Error {
  constructor(
    public readonly code: IntegrationErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'IntegrationError';
  }
}

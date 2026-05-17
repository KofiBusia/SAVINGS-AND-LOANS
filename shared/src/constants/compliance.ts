/**
 * Ghana regulatory compliance constants.
 * These values are mandated by law and must not be changed without BoG approval.
 */

// --- Digital Credit Directive 2025 (Bank of Ghana) ---
export const DCD_2025 = {
  /** Maximum nominal interest rate per annum for digital credit (%) */
  MAX_INTEREST_RATE_PA: 36,
  /** Mandatory pre-agreement display time before borrower can sign (seconds) */
  PRE_AGREEMENT_MIN_DISPLAY_SECONDS: 30,
  /** Complaint resolution SLA (calendar days) - DCD 2025 Section 18 */
  COMPLAINT_RESOLUTION_DAYS: 20,
  /** Cooling-off period after loan agreement (hours) */
  COOLING_OFF_HOURS: 24,
  /** Compounding interest is PROHIBITED - must throw error if attempted */
  COMPOUNDING_PROHIBITED: true,
  /** Maximum total cost of credit as % of principal */
  MAX_TOTAL_COST_PERCENT: 100,
} as const;

// --- AML Act 1044 (Anti-Money Laundering) ---
export const AML_1044 = {
  /** Cash Transaction Report threshold (GHS) - must submit CTR to FIC */
  CTR_THRESHOLD_GHS: 10_000,
  /** Amount that triggers automatic STR review (GHS) */
  STR_AUTO_REVIEW_GHS: 5_000,
  /** PEP screening mandatory for all customers */
  PEP_SCREENING_REQUIRED: true,
  /** Enhanced Due Diligence triggers */
  EDD_TRIGGERS: ['HIGH_RISK', 'PEP', 'SANCTIONED_COUNTRY', 'POLITICALLY_SENSITIVE'],
  /** Beneficial ownership threshold (%) - must capture UBO above this */
  UBO_THRESHOLD_PERCENT: 25,
  /** Customer due diligence review frequency by risk class (days) */
  CDD_REVIEW_DAYS: { LOW: 365, MEDIUM: 180, HIGH: 90 },
  /** Document retention period (years) */
  RECORD_RETENTION_YEARS: 7,
} as const;

// --- Data Protection Act 843 ---
export const DPA_843 = {
  /** Permitted data regions for PII storage - MUST be Ghana-hosted */
  PERMITTED_DATA_REGIONS: ['gh-accra-1', 'gh-kumasi-1', 'gh-tamale-1'],
  /** DSAR response SLA (calendar days) */
  DSAR_RESPONSE_DAYS: 30,
  /** Consent must be granular - these scopes must be individually consented */
  CONSENT_SCOPES: [
    'credit_reporting',
    'marketing',
    'third_party_sharing',
    'location_data',
    'biometric_processing',
    'data_analytics',
  ],
  /** Data minimisation: only collect what is necessary */
  DATA_MINIMISATION: true,
  /** Loan records must be retained even after erasure request */
  LOAN_RECORD_RETENTION_YEARS: 7,
} as const;

// --- Credit Reporting L.I. 2394 ---
export const CREDIT_REPORTING = {
  /** Daily submission time to credit bureaus (24h format, WAT) */
  DAILY_SUBMISSION_TIME: '22:00',
  /** Credit bureaus to submit to */
  BUREAUS: ['XDS', 'DNB', 'MYCREDIT'] as const,
  /** NPA (Non-Performing Asset) classification buckets (days overdue) */
  NPA_BUCKETS: {
    CURRENT: 0,
    WATCH: 1,
    SUBSTANDARD: 91,
    DOUBTFUL: 181,
    LOSS: 361,
  },
} as const;

// --- Cybersecurity Act 1038 ---
export const CYBERSECURITY_1038 = {
  /** MFA required for all write operations */
  MFA_REQUIRED_FOR_WRITES: true,
  /** Audit log hash algorithm */
  AUDIT_HASH_ALGORITHM: 'sha256',
  /** Audit log must be immutable */
  IMMUTABLE_AUDIT_LOGS: true,
  /** Break-glass access requires dual approval */
  BREAK_GLASS_DUAL_APPROVAL: true,
  /** Session timeout (minutes) */
  SESSION_TIMEOUT_MINUTES: 30,
  /** Maximum failed login attempts before lockout */
  MAX_FAILED_LOGINS: 5,
  /** Account lockout duration (minutes) */
  LOCKOUT_DURATION_MINUTES: 30,
  MFA_ISSUER: 'Ghana Savings \& Loans',
  MFA_TOTP_WINDOW: 1,
  BACKUP_CODE_COUNT: 10,
} as const;

// --- KYC Document Types ---
export const KYC_DOCUMENTS = {
  PRIMARY_ID: 'GHANA_CARD',  // Only Ghana Card accepted per NIA policy
  SUPPORTED_ADDRESS_PROOF: ['UTILITY_BILL', 'BANK_STATEMENT', 'GHANA_POST_GPS'],
  SUPPORTED_INCOME_PROOF: ['PAY_SLIP', 'TAX_CERTIFICATE', 'BUSINESS_CERT', 'BANK_STATEMENT'],
} as const;

export type RiskClass = 'LOW' | 'MEDIUM' | 'HIGH';
export type NpaClass = 'CURRENT' | 'WATCH' | 'SUBSTANDARD' | 'DOUBTFUL' | 'LOSS';
export type CreditBureau = typeof CREDIT_REPORTING.BUREAUS[number];

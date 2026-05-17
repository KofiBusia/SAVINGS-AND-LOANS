/**
 * Transaction interfaces for Ghana Savings & Loan Platform
 *
 * Regulatory references:
 *   - FIC Act 2020 (Act 1044) §33: Currency Transaction Report (CTR) for >= GHS 10,000 cash
 *   - FIC Act 2020 §34: Suspicious Transaction Report (STR) within 3 working days
 *   - Payment Systems and Services Act 2019 (Act 987): payment system rules
 *   - GhIPSS Technical Specification v3 2024: GhIPSS transaction format
 *   - BoG Mobile Money Guidelines 2023: mobile money transaction rules
 *   - FIC AML/CFT Guidelines 2021 §6: transaction monitoring requirements
 */

// ============================================================================
// Enumerations
// ============================================================================

/** High-level transaction type classification */
export enum TransactionType {
  // Savings transactions
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  INTEREST_CREDIT = 'INTEREST_CREDIT',
  SAVINGS_TRANSFER = 'SAVINGS_TRANSFER',

  // Loan transactions
  LOAN_DISBURSEMENT = 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT = 'LOAN_REPAYMENT',
  LOAN_PROCESSING_FEE = 'LOAN_PROCESSING_FEE',
  LOAN_INSURANCE_PREMIUM = 'LOAN_INSURANCE_PREMIUM',
  LOAN_WRITEOFF = 'LOAN_WRITEOFF',

  // Fee transactions
  ACCOUNT_FEE = 'ACCOUNT_FEE',
  PENALTY_FEE = 'PENALTY_FEE',
  DORMANCY_FEE = 'DORMANCY_FEE',

  // Internal
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
  REVERSAL = 'REVERSAL',

  // Regulatory
  DORMANT_TRANSFER_TO_BOG = 'DORMANT_TRANSFER_TO_BOG',
  COURT_FREEZE = 'COURT_FREEZE',
  COURT_UNFREEZE = 'COURT_UNFREEZE',
}

/** Transaction lifecycle state */
export enum TransactionStatus {
  /** Transaction initiated but not yet processed */
  PENDING = 'PENDING',

  /** Submitted to external system (GhIPSS / MoMo) — awaiting confirmation */
  PROCESSING = 'PROCESSING',

  /** Successfully completed and funds settled */
  COMPLETED = 'COMPLETED',

  /**
   * Failed — error from payment gateway or internal validation
   * Balance NOT changed; transaction can be retried
   */
  FAILED = 'FAILED',

  /**
   * Reversed — transaction completed but then reversed
   * A corresponding REVERSAL transaction is created
   * Reason documented; original + reversal both retained for audit
   */
  REVERSED = 'REVERSED',

  /**
   * Expired — transaction timed out waiting for confirmation
   * GhIPSS: 5-minute window; MoMo: 60-second window
   */
  EXPIRED = 'EXPIRED',

  /**
   * Held pending AML/compliance review
   * Funds debited from sender but not credited to recipient until cleared
   */
  AML_HOLD = 'AML_HOLD',
}

/** Channel through which the transaction was initiated */
export enum TransactionChannel {
  MOBILE_APP = 'MOBILE_APP',
  WEB_PORTAL = 'WEB_PORTAL',
  BACK_OFFICE = 'BACK_OFFICE',       // Staff-initiated via admin portal
  USSD = 'USSD',                      // *712# or equivalent
  API = 'API',                        // Third-party API integration
  ATM = 'ATM',                        // ATM card transaction
  BRANCH = 'BRANCH',                  // Over-the-counter at branch
  SYSTEM = 'SYSTEM',                  // System-generated (interest credit, fees)
}

/** Currency code — GHS is the functional currency; foreign currency for diaspora */
export enum Currency {
  GHS = 'GHS',  // Ghana Cedi — functional currency per BoG requirements
  USD = 'USD',
  GBP = 'GBP',
  EUR = 'EUR',
}

/** Payment method used */
export enum PaymentMethod {
  MOBILE_MONEY_MTN = 'MOBILE_MONEY_MTN',
  MOBILE_MONEY_TELECEL = 'MOBILE_MONEY_TELECEL',
  MOBILE_MONEY_AIRTELTIGO = 'MOBILE_MONEY_AIRTELTIGO',
  GHIPSS_INSTANT_PAY = 'GHIPSS_INSTANT_PAY',
  GHIPSS_ACH = 'GHIPSS_ACH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  INTERNAL = 'INTERNAL',   // No external payment — internal account movement
}

// ============================================================================
// Sub-interfaces
// ============================================================================

/**
 * AML monitoring flags attached to a transaction
 * @see FIC AML/CFT Guidelines 2021 §6.3 (Transaction Monitoring)
 */
export interface AmlFlags {
  /**
   * Whether a CTR (Currency Transaction Report) must be filed.
   * @see FIC Act 2020 §33: CTR required for cash transactions >= GHS 10,000
   */
  requiresCtr: boolean;

  /**
   * Whether an STR (Suspicious Transaction Report) was raised.
   * @see FIC Act 2020 §34: STR must be filed within 3 working days
   */
  requiresStr: boolean;

  /** Reference to the filed CTR/STR document */
  ctrRef: string | null;
  strRef: string | null;

  /** ISO 8601 timestamps of CTR/STR filing */
  ctrFiledAt: string | null;
  strFiledAt: string | null;

  /** AML alert reason codes */
  alertCodes: string[];

  /** Whether this transaction was flagged for manual review */
  flaggedForManualReview: boolean;

  /** ID of compliance officer who reviewed the flag */
  reviewedBy: string | null;
  reviewedAt: string | null;

  /** Outcome of manual review */
  reviewOutcome: 'CLEARED' | 'ESCALATED_TO_FIC' | 'TRANSACTION_BLOCKED' | null;
}

/**
 * Geographic location data captured at transaction time
 * Used for fraud detection and AML analysis
 */
export interface TransactionLocation {
  /** Latitude (if GPS available on mobile) */
  latitude: number | null;
  longitude: number | null;
  /** Ghana Digital Address (GPS code) */
  digitalAddress: string | null;
  /** City / town */
  city: string | null;
  /** Ghana region */
  region: string | null;
  /** IP address (for web/API transactions) */
  ipAddress: string | null;
  /** Whether location was verified against customer's registered address */
  locationVerified: boolean;
}

// ============================================================================
// Base Transaction Interface
// ============================================================================

/**
 * Base transaction record — all transaction types extend this
 *
 * Transactions are IMMUTABLE once completed. Corrections are made via
 * REVERSAL transactions, never by editing existing records.
 * This supports the SHA-256 audit hash chain in AuditLog.
 */
export interface BaseTransaction {
  /** UUID v4 */
  id: string;

  /**
   * Human-readable transaction reference
   * Format: GH{YYYYMMDD}{10-char alphanumeric} — GhIPSS format
   * e.g., GH20250115ABC1234567
   */
  transactionRef: string;

  type: TransactionType;
  status: TransactionStatus;
  channel: TransactionChannel;
  paymentMethod: PaymentMethod;

  /** Customer who owns the transaction */
  customerId: string;

  /**
   * Amount in GHS (always positive — direction determined by type)
   * Stored as a number; use Decimal.js for calculations to avoid float errors
   */
  amountGhs: number;

  currency: Currency;

  /**
   * Exchange rate (if currency != GHS)
   * Foreign currency amount = amountGhs / exchangeRate
   */
  exchangeRate: number | null;

  /** Description / narration */
  description: string;

  /**
   * Source account (savings account number or 'EXTERNAL')
   */
  fromAccount: string | null;

  /**
   * Destination account (savings account number or 'EXTERNAL')
   */
  toAccount: string | null;

  /** Ledger balance of the account AFTER this transaction (GHS) */
  balanceAfterGhs: number;

  /** AML monitoring data */
  amlFlags: AmlFlags;

  /** Location data at time of transaction */
  location: TransactionLocation | null;

  /**
   * Device fingerprint (mobile app / browser)
   * Used for fraud detection
   */
  deviceFingerprint: string | null;

  /**
   * If this is a reversal: reference to the original transaction
   */
  reversedTransactionId: string | null;

  /** Reason for reversal (if applicable) */
  reversalReason: string | null;

  /** Error code if status = FAILED */
  errorCode: string | null;
  errorMessage: string | null;

  /** ISO 8601 timestamp transaction was initiated */
  initiatedAt: string;

  /** ISO 8601 timestamp transaction was completed/failed */
  completedAt: string | null;

  /** Value date for interest calculations (may differ from completedAt for MoMo) */
  valueDate: string;

  createdAt: string;
  createdBy: string;

  /**
   * SHA-256 hash of this transaction record (part of audit hash chain)
   * Computed after all fields are set; used to detect tampering
   */
  transactionHash: string;

  /**
   * SHA-256 hash of the PREVIOUS transaction in this account's chain
   * Enables blockchain-style tamper detection
   */
  previousTransactionHash: string | null;
}

// ============================================================================
// Mobile Money Transaction
// ============================================================================

/**
 * Mobile Money transaction details
 * Covers MTN MoMo, Telecel Cash, AirtelTigo Money
 *
 * @see BoG Mobile Money Guidelines 2023
 * @see BoG Electronic Payment Channels Guidelines 2020
 */
export interface MobileMoneyTransaction extends BaseTransaction {
  readonly _type: 'MOBILE_MONEY';

  /** Mobile network operator */
  mno: 'MTN' | 'TELECEL' | 'AIRTELTIGO';

  /**
   * Sender's MoMo wallet number (Ghana format: +233XXXXXXXXX)
   */
  senderWalletNumber: string;

  /**
   * Recipient's MoMo wallet number or institution shortcode
   */
  recipientWalletNumber: string;

  /** MNO's internal transaction ID */
  mnoTransactionId: string;

  /** MNO's external reference (shown on customer's MoMo receipt) */
  mnoExternalRef: string | null;

  /**
   * MoMo callback status
   * MNO sends callback on completion; we update status on receipt
   */
  callbackReceived: boolean;
  callbackReceivedAt: string | null;

  /**
   * MoMo network response code
   * Used for debugging failed transactions
   */
  mnoResponseCode: string | null;
  mnoResponseMessage: string | null;

  /**
   * Whether customer approved the transaction on their MoMo app/USSD
   * (Some MoMo APIs require customer PIN confirmation)
   */
  customerApproved: boolean;
  customerApprovedAt: string | null;
}

// ============================================================================
// GhIPSS Transaction
// ============================================================================

/**
 * GhIPSS Instant Pay transaction details
 * GhIPSS is the interbank payment infrastructure in Ghana.
 *
 * @see GhIPSS Technical Specification v3 2024
 * @see Payment Systems and Services Act 2019 (Act 987)
 *
 * GhIPSS transactions are FINAL AND IRREVOCABLE once accepted.
 * Disputes must be raised through the GhIPSS dispute resolution process.
 */
export interface GhIPSSTransaction extends BaseTransaction {
  readonly _type: 'GHIPSS';

  /**
   * GhIPSS transaction ID — assigned by GhIPSS
   * Format: GHIPSS{YYYYMMDD}{12-char alphanumeric}
   */
  ghipssTransactionId: string;

  /**
   * Originating institution code (our 4-digit GhIPSS code)
   */
  originatingInstitutionCode: string;

  /**
   * Beneficiary institution code (receiving bank's GhIPSS code)
   * @see shared/src/constants/ghana.ts GHANA_BANK_CODES
   */
  beneficiaryInstitutionCode: string;

  /** Originating account number */
  originatingAccountNumber: string;

  /** Beneficiary account number */
  beneficiaryAccountNumber: string;

  /** Beneficiary account name (verified by receiving bank) */
  beneficiaryAccountName: string;

  /**
   * GhIPSS settlement batch ID
   * GhIPSS settles in near-real-time batches; this links to the batch
   */
  settlementBatchId: string | null;

  /** ISO 8601 timestamp of GhIPSS settlement */
  settledAt: string | null;

  /**
   * GhIPSS mandate reference (for recurring payments like loan repayments)
   */
  mandateRef: string | null;

  /**
   * GhIPSS response code
   * 00 = Approved; non-00 = error (see GhIPSS response code table)
   */
  ghipssResponseCode: string;
  ghipssResponseMessage: string | null;

  /**
   * Whether this is a GhIPSS ACH (next-day) or Instant Pay (real-time)
   */
  paymentRail: 'INSTANT_PAY' | 'ACH';
}

// ============================================================================
// Cash Transaction
// ============================================================================

/**
 * Over-the-counter cash transaction
 *
 * @see FIC Act 2020 §33: Cash transactions >= GHS 10,000 require CTR
 * @see FIC AML/CFT Guidelines 2021: Cash threshold monitoring
 */
export interface CashTransaction extends BaseTransaction {
  readonly _type: 'CASH';

  /** Branch / agent location where cash was received/paid */
  branchCode: string;

  /** Teller ID who processed the transaction */
  tellerId: string;

  /** Denomination breakdown (optional but recommended for large cash) */
  denominationBreakdown: Record<string, number> | null;

  /**
   * ID document presented at counter
   * FIC Guidelines: must verify ID for cash transactions >= GHS 1,000
   */
  idDocumentType: 'GHANA_CARD' | 'PASSPORT' | 'VOTER_ID' | 'DRIVERS_LICENSE';
  idDocumentNumber: string;

  /**
   * Whether CTR (Currency Transaction Report) was filed
   * Required for cash >= GHS 10,000 per FIC Act 2020 §33
   */
  ctrFiled: boolean;
  ctrRef: string | null;
  ctrFiledAt: string | null;
}

// ============================================================================
// Union type for all transaction types
// ============================================================================

export type Transaction = MobileMoneyTransaction | GhIPSSTransaction | CashTransaction;

// ============================================================================
// Transaction query/filter types
// ============================================================================

export interface TransactionFilter {
  customerId?: string;
  accountNumber?: string;
  type?: TransactionType | TransactionType[];
  status?: TransactionStatus | TransactionStatus[];
  channel?: TransactionChannel;
  paymentMethod?: PaymentMethod | PaymentMethod[];
  fromDate?: string;
  toDate?: string;
  minAmountGhs?: number;
  maxAmountGhs?: number;
  /** Filter for AML-flagged transactions only */
  amlFlaggedOnly?: boolean;
  /** Filter for transactions requiring CTR */
  ctrRequiredOnly?: boolean;
}

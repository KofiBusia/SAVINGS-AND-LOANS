/**
 * Savings account interfaces for Ghana Savings & Loan Platform
 *
 * Regulatory references:
 *   - BoG Guidelines for Deposit-Taking MFIs 2023
 *   - BoG Consumer Protection Act 2019 (depositor protection)
 *   - BoG Dormant Accounts Guidelines 2022
 *   - BoG Minimum Capital Requirements 2023
 *   - FIC AML/CFT Guidelines 2021 (cash deposit monitoring)
 *   - Data Protection Act 2012 (account privacy)
 *
 * Interest on savings accounts is also SIMPLE INTEREST.
 * This is consistent with DCD 2025 and standard BoG deposit guidelines.
 */

// ============================================================================
// Enumerations
// ============================================================================

/** Type of savings account product */
export enum SavingsAccountType {
  /**
   * Regular savings — standard deposit account
   * Free withdrawals with reasonable notice period
   */
  REGULAR_SAVINGS = 'REGULAR_SAVINGS',

  /**
   * Fixed deposit — locked for agreed term (30–365 days)
   * Higher interest rate; early withdrawal incurs penalty
   * @see BoG Fixed Deposit Guidelines 2023
   */
  FIXED_DEPOSIT = 'FIXED_DEPOSIT',

  /**
   * Target savings — customer sets a target amount and date
   * Withdrawals restricted until target date or target amount reached
   * Common in Ghanaian susu/savings groups
   */
  TARGET_SAVINGS = 'TARGET_SAVINGS',

  /**
   * Susu savings — simulated traditional Ghanaian savings model
   * Customer makes regular deposits; receives lump sum at end of cycle
   */
  SUSU = 'SUSU',

  /**
   * Loan collateral savings — mandatory savings lien against a loan
   * Cannot be withdrawn while linked loan is active
   */
  LOAN_COLLATERAL = 'LOAN_COLLATERAL',

  /**
   * Child savings (Junior Savers)
   * Account opened by parent/guardian for minor
   * Requires guardian consent; accessible at age 18
   */
  CHILD_SAVINGS = 'CHILD_SAVINGS',
}

/** Current status of a savings account */
export enum SavingsAccountStatus {
  /** Account active, all operations permitted */
  ACTIVE = 'ACTIVE',

  /**
   * Restricted — withdrawals limited (e.g., pending KYC renewal)
   * Deposits still permitted
   */
  RESTRICTED = 'RESTRICTED',

  /**
   * Frozen — no transactions permitted
   * Triggered by AML suspicion or court order
   * Must be reported per FIC Act 2020 §40
   */
  FROZEN = 'FROZEN',

  /**
   * Dormant — no customer-initiated transaction for 6+ months
   * @see BoG Dormant Accounts Guidelines 2022:
   * - 6 months: account marked dormant
   * - 2 years: funds transferred to BoG Dormant Account Pool
   * - Customer can reclaim funds from BoG pool at any time
   */
  DORMANT = 'DORMANT',

  /**
   * Pre-dormant — warning state: 3–6 months without transaction
   * System sends SMS/email reminders to customer
   */
  PRE_DORMANT = 'PRE_DORMANT',

  /**
   * Transferred to BoG dormant pool
   * @see BoG Dormant Accounts Guidelines 2022 §8
   */
  TRANSFERRED_TO_BOG = 'TRANSFERRED_TO_BOG',

  /** Account closure requested; in 30-day cooling-off period */
  PENDING_CLOSURE = 'PENDING_CLOSURE',

  /** Account permanently closed */
  CLOSED = 'CLOSED',
}

/** Interest credit frequency for savings accounts */
export enum InterestCreditFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
  /** Interest credited at maturity (for fixed deposits) */
  AT_MATURITY = 'AT_MATURITY',
}

/** Withdrawal restriction type */
export enum WithdrawalRestrictionType {
  /** No restrictions — standard savings */
  NONE = 'NONE',

  /**
   * Notice period required before large withdrawals
   * Common for fixed deposits; typically 30–90 days
   */
  NOTICE_PERIOD = 'NOTICE_PERIOD',

  /**
   * Maximum monthly withdrawal amount applies
   * Used for target savings to enforce saving discipline
   */
  MONTHLY_LIMIT = 'MONTHLY_LIMIT',

  /**
   * Locked until a specific date
   * For fixed deposits and target savings
   */
  LOCKED_UNTIL_DATE = 'LOCKED_UNTIL_DATE',

  /**
   * Locked until target amount reached
   * For target savings accounts
   */
  LOCKED_UNTIL_TARGET = 'LOCKED_UNTIL_TARGET',

  /**
   * Lien — locked as collateral against a loan
   * Cannot be released until linked loan is fully repaid
   */
  LIEN = 'LIEN',

  /**
   * Court order / legal freeze
   * Cannot be released without court order lifting the freeze
   */
  COURT_ORDER = 'COURT_ORDER',
}

// ============================================================================
// Sub-interfaces
// ============================================================================

/**
 * Savings account withdrawal rule
 * Multiple rules may apply simultaneously (e.g., notice period + monthly limit)
 */
export interface WithdrawalRule {
  type: WithdrawalRestrictionType;

  /** For NOTICE_PERIOD: days of advance notice required */
  noticePeriodDays: number | null;

  /** For MONTHLY_LIMIT: maximum withdrawal amount per calendar month (GHS) */
  monthlyLimitGhs: number | null;

  /** For LOCKED_UNTIL_DATE: lock expiry date (ISO 8601) */
  lockedUntilDate: string | null;

  /** For LOCKED_UNTIL_TARGET: target amount (GHS) */
  lockedUntilTargetGhs: number | null;

  /** For LIEN: loan ID this lien is linked to */
  liensLoanId: string | null;

  /** For COURT_ORDER: reference number of court order */
  courtOrderRef: string | null;

  /**
   * Early withdrawal penalty rate (%)
   * For fixed deposits: typically forfeiture of X months' interest
   * BoG guideline: penalty should not exceed 3 months' interest
   */
  earlyWithdrawalPenaltyPercent: number | null;

  /** Effective date of this rule */
  effectiveFrom: string;

  /** Expiry date (null = indefinite) */
  effectiveTo: string | null;
}

/**
 * Fixed deposit term details
 * Only applicable when accountType = FIXED_DEPOSIT
 */
export interface FixedDepositTerms {
  /** Deposit amount locked (GHS) */
  depositAmountGhs: number;

  /** Start date of the fixed deposit term (ISO 8601) */
  startDate: string;

  /** Maturity date (ISO 8601) */
  maturityDate: string;

  /** Tenor in days */
  tenorDays: number;

  /**
   * Interest rate (APR %) for this fixed deposit
   * Simple interest: I = P × r × t
   */
  interestRateApr: number;

  /** Total interest to be earned at maturity (GHS) */
  interestAtMaturityGhs: number;

  /** Total payout at maturity = depositAmountGhs + interestAtMaturityGhs */
  maturityPayoutGhs: number;

  /**
   * Auto-renewal instruction
   * If true: on maturity, principal is re-deposited for another identical term
   */
  autoRenewal: boolean;

  /** Whether the fixed deposit has been rolled over (renewed) */
  rolloverCount: number;
}

/**
 * Target savings goal configuration
 */
export interface TargetSavingsGoal {
  /** Description of what the customer is saving for */
  goalDescription: string;
  /** Target amount to save (GHS) */
  targetAmountGhs: number;
  /** Target completion date (ISO 8601) */
  targetDate: string;
  /** Whether the target has been reached */
  targetReached: boolean;
  /** ISO 8601 timestamp when target was reached */
  targetReachedAt: string | null;
}

/**
 * Susu cycle configuration
 * Models the traditional Ghanaian rotating savings group.
 */
export interface SusuCycleConfig {
  /** Total number of members in this susu cycle */
  totalMembers: number;
  /** Daily/weekly/monthly contribution amount per member (GHS) */
  contributionAmountGhs: number;
  contributionFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  /** ISO 8601 start date of the susu cycle */
  cycleStartDate: string;
  /** ISO 8601 end date (when all members have received their lump sum) */
  cycleEndDate: string;
  /** This account holder's position in the payout order (1-based) */
  payoutPosition: number;
  /** ISO 8601 scheduled payout date for this account holder */
  scheduledPayoutDate: string;
}

/**
 * Interest accrual record — tracks daily/monthly interest calculation
 */
export interface InterestAccrualRecord {
  id: string;
  accountId: string;
  /** Date for which interest was accrued (ISO 8601 date) */
  accrualDate: string;
  /** Opening balance for this accrual period (GHS) */
  openingBalanceGhs: number;
  /** Daily interest rate = (APR / 365) */
  dailyRateDecimal: number;
  /** Interest earned for this period (GHS) */
  interestEarnedGhs: number;
  /**
   * Interest credited to account (may differ from earned — credited at frequency)
   * Uncredited accrued interest accumulates until next credit date.
   */
  interestCreditedGhs: number;
  /** Whether this accrual has been credited to the account balance */
  credited: boolean;
  /** ISO 8601 timestamp when credited */
  creditedAt: string | null;
}

/**
 * Dormancy tracking record
 * @see BoG Dormant Accounts Guidelines 2022
 */
export interface DormancyRecord {
  /** ISO 8601 date of last customer-initiated transaction */
  lastActivityDate: string;
  /** Number of months since last activity */
  monthsInactive: number;
  /**
   * Notification sent at 3-month mark (pre-dormant warning)
   */
  preDoormancyNotificationSentAt: string | null;
  /**
   * Notification sent at 6-month mark (dormancy notification)
   */
  dormancyNotificationSentAt: string | null;
  /**
   * Notification sent at 18-month mark (final notice before BoG transfer)
   */
  finalNoticeBeforeTransferSentAt: string | null;
  /**
   * Date funds were transferred to BoG Dormant Account Pool
   * After transfer, account status = TRANSFERRED_TO_BOG
   */
  transferredToBoGAt: string | null;
  /** BoG receipt reference for the transfer */
  bogTransferRef: string | null;
}

// ============================================================================
// Main Savings Account interface
// ============================================================================

/**
 * Core Savings Account entity
 *
 * @see BoG Guidelines for Deposit-Taking MFIs 2023
 * @see BoG Dormant Accounts Guidelines 2022
 * @see FIC AML/CFT Guidelines 2021 (cash deposit monitoring)
 */
export interface SavingsAccount {
  // --------------------------------------------------------------------------
  // Identity
  // --------------------------------------------------------------------------

  /** UUID v4 */
  id: string;

  /**
   * Account number — format: GSL-SAV-XXXXXXXXXXXXXX (12 digits)
   * Must be unique across the institution
   */
  accountNumber: string;

  /** Customer this account belongs to */
  customerId: string;

  accountType: SavingsAccountType;

  /** Product name (e.g., "Daily Savers Account", "Fixed 90-Day Deposit") */
  productName: string;

  // --------------------------------------------------------------------------
  // Balance
  // --------------------------------------------------------------------------

  /**
   * Current ledger balance (GHS)
   * This is the authoritative balance used for all financial operations.
   */
  balanceGhs: number;

  /**
   * Available balance (GHS)
   * = balanceGhs minus any holds/lien amounts
   * This is what the customer can actually withdraw.
   */
  availableBalanceGhs: number;

  /**
   * Total hold amount (GHS)
   * Includes: collateral lien, processing holds, court freeze amounts
   */
  holdAmountGhs: number;

  /**
   * Minimum balance requirement (GHS)
   * Account cannot be reduced below this level.
   * BoG mandates disclosure of minimum balance in account opening.
   */
  minimumBalanceGhs: number;

  /**
   * Accrued interest not yet credited to balance (GHS)
   * Credited at the interest credit frequency.
   */
  accruedInterestGhs: number;

  /** Total interest earned since account opening (GHS) */
  totalInterestEarnedGhs: number;

  // --------------------------------------------------------------------------
  // Interest
  // --------------------------------------------------------------------------

  /**
   * Interest rate (APR %) for this account
   * Simple interest applied on daily balance basis
   * Per BoG deposit guidelines, rates must be published and disclosed
   */
  interestRateApr: number;

  interestCreditFrequency: InterestCreditFrequency;

  /** ISO 8601 date of next interest credit */
  nextInterestCreditDate: string | null;

  /** ISO 8601 date interest was last credited */
  lastInterestCreditedAt: string | null;

  /** Running accrual records */
  accruedInterestRecords: InterestAccrualRecord[];

  // --------------------------------------------------------------------------
  // Fixed Deposit / Target Savings specific
  // --------------------------------------------------------------------------

  fixedDepositTerms: FixedDepositTerms | null;
  targetSavingsGoal: TargetSavingsGoal | null;
  susuCycleConfig: SusuCycleConfig | null;

  // --------------------------------------------------------------------------
  // Withdrawal Rules
  // --------------------------------------------------------------------------

  withdrawalRules: WithdrawalRule[];

  /**
   * Maximum single withdrawal amount (GHS) — 0 means unlimited
   * BoG may require enhanced verification for withdrawals > GHS 50,000
   */
  maxSingleWithdrawalGhs: number;

  /**
   * Maximum daily withdrawal amount (GHS) — 0 means unlimited
   */
  maxDailyWithdrawalGhs: number;

  // --------------------------------------------------------------------------
  // Account Status & Dormancy
  // --------------------------------------------------------------------------

  status: SavingsAccountStatus;

  dormancyRecord: DormancyRecord | null;

  /**
   * ISO 8601 timestamp of last customer-initiated transaction
   * Used to calculate dormancy status
   */
  lastTransactionAt: string | null;

  // --------------------------------------------------------------------------
  // For CHILD_SAVINGS: guardian information
  // --------------------------------------------------------------------------

  /**
   * Guardian customer ID (for child accounts)
   * Guardian has control until the child reaches age 18
   */
  guardianCustomerId: string | null;

  /**
   * Date the minor becomes an adult and takes control of account (ISO 8601)
   */
  accountMatureAt: string | null;

  // --------------------------------------------------------------------------
  // For LOAN_COLLATERAL: linked loan
  // --------------------------------------------------------------------------

  /** Loan ID if this account has a lien for a specific loan */
  liensLoanId: string | null;

  /** Amount held as lien (GHS) — must be >= loan collateral requirement */
  lienAmountGhs: number;

  // --------------------------------------------------------------------------
  // Audit
  // --------------------------------------------------------------------------

  /** ISO 8601 date account was opened */
  openedAt: string;

  /** Staff ID or 'SELF' for self-service registration */
  openedBy: string;

  /** ISO 8601 date account was closed */
  closedAt: string | null;

  /** Reason for account closure */
  closureReason: string | null;

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;

  /** SHA-256 hash of the serialised account record at last write */
  recordHash: string;
}

// ============================================================================
// Savings Product Configuration
// ============================================================================

export interface SavingsProduct {
  id: string;
  name: string;
  accountType: SavingsAccountType;
  minimumOpeningBalanceGhs: number;
  minimumBalanceGhs: number;
  interestRateApr: number;
  interestCreditFrequency: InterestCreditFrequency;
  maxSingleWithdrawalGhs: number;
  maxDailyWithdrawalGhs: number;
  withdrawalRules: WithdrawalRule[];
  /** Whether this product is open to new customers */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

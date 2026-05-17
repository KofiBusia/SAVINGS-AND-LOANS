/**
 * Savings Account entity — typed interfaces and enums.
 * Authoritative schema is in src/database/schema.prisma.
 */

export enum SavingsAccountStatus {
  PENDING_ACTIVATION = 'PENDING_ACTIVATION',
  ACTIVE             = 'ACTIVE',
  DORMANT            = 'DORMANT',
  FROZEN             = 'FROZEN',
  CLOSED             = 'CLOSED',
}

export enum SavingsProductType {
  REGULAR_SAVINGS       = 'REGULAR_SAVINGS',      // Standard savings account
  FIXED_DEPOSIT         = 'FIXED_DEPOSIT',         // Fixed term, locked funds
  SUSU                  = 'SUSU',                  // Traditional Ghana susu savings
  TARGET_SAVINGS        = 'TARGET_SAVINGS',        // Goal-based savings
  COOPERATIVE_SHARES    = 'COOPERATIVE_SHARES',    // Cooperative share capital
  GROUP_SAVINGS         = 'GROUP_SAVINGS',         // Group/thrift savings
  CHILDREN_SAVINGS      = 'CHILDREN_SAVINGS',      // Minor's savings account
  RETIREMENT_SAVINGS    = 'RETIREMENT_SAVINGS',    // Long-term retirement
}

export enum InterestAccrualMethod {
  DAILY_BALANCE  = 'DAILY_BALANCE',    // Interest on daily closing balance
  MINIMUM_BALANCE = 'MINIMUM_BALANCE', // Interest on minimum monthly balance
  AVERAGE_BALANCE = 'AVERAGE_BALANCE', // Interest on average monthly balance
}

export enum WithdrawalRuleType {
  LOCK_IN_PERIOD       = 'LOCK_IN_PERIOD',
  MINIMUM_BALANCE      = 'MINIMUM_BALANCE',
  FREQUENCY_LIMIT      = 'FREQUENCY_LIMIT',
  NOTICE_PERIOD        = 'NOTICE_PERIOD',
  PARTIAL_ONLY         = 'PARTIAL_ONLY',
  RESTRICTED_DATES     = 'RESTRICTED_DATES',
}

export interface InterestAccrualRecord {
  id:               string;
  accountId:        string;
  periodStart:      Date;
  periodEnd:        Date;
  averageBalance:   number;
  accrualRate:      number;     // Annual rate for this period
  accrualMethod:    InterestAccrualMethod;
  accruedAmount:    number;     // GHS
  postedAt?:        Date;
  status:           'ACCRUED' | 'POSTED' | 'REVERSED';
}

export interface WithdrawalRule {
  type:              WithdrawalRuleType;
  value:             number | string | Date;
  penaltyRate?:      number;   // % of withdrawn amount as penalty
  description:       string;
  isActive:          boolean;
}

export interface DividendRecord {
  id:               string;
  accountId:        string;
  declarationDate:  Date;
  periodStart:      Date;
  periodEnd:        Date;
  ratePercent:      number;
  dividendAmount:   number;    // GHS
  paidAt?:          Date;
  status:           'DECLARED' | 'PAID' | 'CANCELLED';
}

export interface SavingsStatement {
  accountId:        string;
  accountNumber:    string;
  fromDate:         Date;
  toDate:           Date;
  openingBalance:   number;
  closingBalance:   number;
  totalDeposits:    number;
  totalWithdrawals: number;
  totalInterest:    number;
  totalDividends:   number;
  transactions:     StatementTransaction[];
}

export interface StatementTransaction {
  date:             Date;
  type:             'DEPOSIT' | 'WITHDRAWAL' | 'INTEREST' | 'DIVIDEND' | 'FEE' | 'REVERSAL';
  description:      string;
  debitAmount?:     number;
  creditAmount?:    number;
  balance:          number;
  reference:        string;
  channel?:         string;
}

export interface SavingsAccount {
  id:               string;
  accountNumber:    string;
  customerId:       string;
  productType:      SavingsProductType;
  status:           SavingsAccountStatus;

  // ─── Balance ───────────────────────────────────────────────────────────────
  ledgerBalance:    number;      // GHS — total balance
  availableBalance: number;      // GHS — balance available for withdrawal
  minimumBalance:   number;      // GHS — mandatory minimum

  // ─── Interest ──────────────────────────────────────────────────────────────
  annualInterestRate: number;    // % p.a.
  accrualMethod:    InterestAccrualMethod;
  accruedInterestGHS: number;    // Unposted accrued interest
  lastInterestPostedAt?: Date;
  nextInterestPostingDate: Date;
  interestAccrualRecords: InterestAccrualRecord[];

  // ─── Lock-in / Term (for fixed deposits) ──────────────────────────────────
  isTermDeposit:    boolean;
  termStartDate?:   Date;
  termEndDate?:     Date;
  lockInPeriodDays?: number;

  // ─── Withdrawal Rules ──────────────────────────────────────────────────────
  withdrawalRules:  WithdrawalRule[];

  // ─── Dividends (for cooperative/group accounts) ───────────────────────────
  isDividendEligible: boolean;
  dividendRecords:  DividendRecord[];
  totalDividendsPaidGHS: number;

  // ─── Membership / Contributions (for susu / cooperative) ─────────────────
  shareCount?:      number;
  shareValue?:      number;   // GHS per share
  totalSharesGHS?:  number;

  // ─── Metadata ────────────────────────────────────────────────────────────
  branchCode:       string;
  openedBy:         string;
  openedAt:         Date;
  dormantSince?:    Date;
  closedAt?:        Date;
  closureReason?:   string;
  tags:             string[];
  notes?:           string;
  createdAt:        Date;
  updatedAt:        Date;
  deletedAt?:       Date;
}

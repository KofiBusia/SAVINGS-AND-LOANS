/**
 * Loan entity — typed interfaces and enums.
 * Authoritative schema is in src/database/schema.prisma.
 *
 * CRITICAL: All interest calculations use SIMPLE INTEREST ONLY per BoG Digital Credit Directive 2025.
 * Compounding interest is PROHIBITED.
 */

export enum LoanStatus {
  DRAFT                = 'DRAFT',
  PENDING_APPROVAL     = 'PENDING_APPROVAL',
  APPROVED             = 'APPROVED',
  PENDING_DISBURSEMENT = 'PENDING_DISBURSEMENT',
  DISBURSED            = 'DISBURSED',
  ACTIVE               = 'ACTIVE',
  WATCHLIST            = 'WATCHLIST',       // 30 DPD
  SUBSTANDARD          = 'SUBSTANDARD',     // 90 DPD
  DOUBTFUL             = 'DOUBTFUL',        // 180 DPD
  LOSS                 = 'LOSS',            // 360 DPD
  RESTRUCTURED         = 'RESTRUCTURED',
  CLOSED               = 'CLOSED',
  WRITTEN_OFF          = 'WRITTEN_OFF',
  REJECTED             = 'REJECTED',
  CANCELLED            = 'CANCELLED',
}

export enum LoanType {
  PERSONAL          = 'PERSONAL',
  BUSINESS          = 'BUSINESS',
  MORTGAGE          = 'MORTGAGE',
  AGRICULTURE       = 'AGRICULTURE',
  EDUCATION         = 'EDUCATION',
  EMERGENCY         = 'EMERGENCY',
  GROUP             = 'GROUP',
  COOPERATIVE       = 'COOPERATIVE',
}

export enum RepaymentFrequency {
  DAILY    = 'DAILY',
  WEEKLY   = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY  = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  BULLET   = 'BULLET',   // Single repayment at end of term
}

export enum DisbursementChannel {
  MOBILE_MONEY = 'MOBILE_MONEY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  GHIPSS        = 'GHIPSS',
  CASH          = 'CASH',
  CHEQUE        = 'CHEQUE',
}

export enum RepaymentStatus {
  PENDING   = 'PENDING',
  PARTIAL   = 'PARTIAL',
  PAID      = 'PAID',
  OVERDUE   = 'OVERDUE',
  WAIVED    = 'WAIVED',
}

export enum RestructuringType {
  TERM_EXTENSION       = 'TERM_EXTENSION',
  RATE_REDUCTION       = 'RATE_REDUCTION',
  PAYMENT_HOLIDAY      = 'PAYMENT_HOLIDAY',
  PRINCIPAL_REDUCTION  = 'PRINCIPAL_REDUCTION',
  COMBINATION          = 'COMBINATION',
}

export interface RepaymentScheduleEntry {
  installmentNumber: number;
  dueDate:           Date;
  principalComponent: number;      // GHS
  interestComponent:  number;      // GHS — SIMPLE interest only
  totalInstallment:   number;      // GHS
  balanceAfter:       number;      // GHS outstanding principal after payment
  status:             RepaymentStatus;
  paidAmount?:        number;
  paidAt?:            Date;
  daysOverdue?:       number;
  penaltyAmount?:     number;
}

export interface DisbursementRecord {
  id:                string;
  disbursedAt:       Date;
  amount:            number;       // GHS
  channel:           DisbursementChannel;
  recipientName:     string;
  recipientAccount:  string;       // Mobile money number or bank account
  recipientBank?:    string;
  ghipssReference?:  string;
  transactionRef:    string;
  status:            'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  failureReason?:    string;
  confirmedAt?:      Date;
}

export interface RestructuringRecord {
  id:                    string;
  restructuredAt:        Date;
  type:                  RestructuringType;
  previousPrincipal:     number;
  newPrincipal:          number;
  previousInterestRate:  number;
  newInterestRate:       number;
  previousTermMonths:    number;
  newTermMonths:         number;
  reason:                string;
  hardshipAssessmentId:  string;
  bogApprovalRef?:       string;       // Required for restructuring per BoG
  bogApprovalDate?:      Date;
  approvedBy:            string;
  notes?:                string;
}

export interface LoanCollateral {
  id:            string;
  type:          string;
  description:   string;
  estimatedValue: number;  // GHS
  valuationDate:  Date;
  valuerId?:      string;
  documentRefs:   string[];
}

export interface Loan {
  id:             string;
  loanNumber:     string;           // e.g., GHL-2024-000001
  customerId:     string;
  productId:      string;
  type:           LoanType;
  status:         LoanStatus;

  // ─── Principal ────────────────────────────────────────────────────────────────
  principalAmountGHS:  number;
  approvedAmountGHS:   number;
  disbursedAmountGHS:  number;
  outstandingPrincipal: number;

  // ─── Simple Interest (ONLY — per BoG Digital Credit Directive 2025) ──────────
  interestType:        'SIMPLE';    // MUST always be 'SIMPLE' — compounding PROHIBITED
  annualInterestRate:  number;      // e.g., 28.5 for 28.5%
  monthlyInterestRate: number;      // annualRate / 12
  totalInterestGHS:    number;      // I = P * r * t (simple)
  totalRepayableGHS:   number;      // Principal + Interest + Fees

  // ─── Term ─────────────────────────────────────────────────────────────────────
  termMonths:          number;
  repaymentFrequency:  RepaymentFrequency;
  repaymentSchedule:   RepaymentScheduleEntry[];

  // ─── Disbursement ─────────────────────────────────────────────────────────────
  disbursedAt?:        Date;
  disbursementChannel: DisbursementChannel;
  disbursementRecords: DisbursementRecord[];

  // ─── Repayment Tracking ───────────────────────────────────────────────────────
  totalPaidGHS:        number;
  totalPrincipalPaidGHS: number;
  totalInterestPaidGHS:  number;
  totalPenaltiesPaidGHS: number;
  maturityDate?:       Date;
  closedAt?:           Date;

  // ─── NPA / Delinquency ────────────────────────────────────────────────────────
  daysPassedDue:       number;      // DPD
  npaClassification:   'PERFORMING' | 'WATCHLIST' | 'SUBSTANDARD' | 'DOUBTFUL' | 'LOSS';
  provisionAmount:     number;      // GHS
  lastPaymentDate?:    Date;
  lastPaymentAmount?:  number;

  // ─── Restructuring ────────────────────────────────────────────────────────────
  isRestructured:      boolean;
  restructuringCount:  number;
  restructuringHistory: RestructuringRecord[];
  bogRestructuringRef?: string;

  // ─── Collateral ───────────────────────────────────────────────────────────────
  isSecured:           boolean;
  collateral:          LoanCollateral[];
  collateralValueGHS:  number;
  ltv:                 number;      // Loan-to-value ratio

  // ─── Fees ─────────────────────────────────────────────────────────────────────
  processingFeeGHS:    number;
  insurancePremiumGHS: number;
  otherFeesGHS:        number;
  apr:                 number;      // Annual Percentage Rate (must be disclosed)

  // ─── Purpose & Approval ───────────────────────────────────────────────────────
  purpose:             string;
  approvedBy?:         string;
  approvedAt?:         Date;
  rejectionReason?:    string;
  officerUserId:       string;
  branchCode:          string;

  // ─── Pre-Agreement Disclosure ─────────────────────────────────────────────────
  preAgreementDisplayedAt?: Date;
  eSignatureHash?:          string;
  eSignedAt?:               Date;

  // ─── Metadata ─────────────────────────────────────────────────────────────────
  creditBureauRef?:    string;
  creditScore?:        number;
  notes?:              string;
  tags:                string[];
  createdAt:           Date;
  updatedAt:           Date;
  deletedAt?:          Date;
}

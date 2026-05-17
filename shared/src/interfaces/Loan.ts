/** Loan interfaces - Digital Credit Directive 2025 compliant (simple interest only) */

export type LoanStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PRE_AGREEMENT_DISPLAYED'
  | 'AGREEMENT_SIGNED'
  | 'DISBURSEMENT_PENDING'
  | 'DISBURSED'
  | 'REPAYING'
  | 'COMPLETED'
  | 'OVERDUE'
  | 'NPA'
  | 'RESTRUCTURED'
  | 'WRITTEN_OFF'
  | 'REJECTED';

export type NpaClass = 'CURRENT' | 'WATCH' | 'SUBSTANDARD' | 'DOUBTFUL' | 'LOSS';

export interface RepaymentScheduleEntry {
  instalmentNumber: number;
  dueDate: Date;
  principalComponent: number;
  interestComponent: number;
  totalDue: number;
  paidAmount: number;
  paidAt?: Date;
  outstandingBalance: number;
  status: 'UPCOMING' | 'PAID' | 'PARTIAL' | 'OVERDUE';
}

export interface DisbursementRecord {
  disbursedAt: Date;
  amount: number;
  channel: 'GHIPSS_MTN' | 'GHIPSS_TELECEL' | 'GHIPSS_AIRTELTIGO' | 'BANK_TRANSFER' | 'CASH';
  transactionReference: string;
  ghipssReference?: string;
  recipientPhone?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

export interface RestructuringRecord {
  restructuredAt: Date;
  reason: string;
  originalTermMonths: number;
  newTermMonths: number;
  principalWrittenOff: number;
  approvedBy: string;
  bogNotificationRef?: string;  // BoG notification for material restructurings
}

export interface Loan {
  id: string;
  loanNumber: string;           // e.g. LN-2024-000001
  customerId: string;
  productId: string;

  // Financials - simple interest ONLY (DCD 2025)
  principal: number;
  annualInterestRatePercent: number;  // Max 36% per BoG cap
  termMonths: number;
  totalInterest: number;
  totalRepayment: number;
  monthlyInstalment: number;

  // Interest type MUST always be SIMPLE (enforced at service layer)
  interestType: 'SIMPLE';

  // Disbursement
  disbursementRecord?: DisbursementRecord;
  disbursedAt?: Date;

  // Repayment
  repaymentSchedule: RepaymentScheduleEntry[];
  totalPaid: number;
  outstandingBalance: number;
  nextPaymentDate?: Date;
  nextPaymentAmount?: number;

  // NPA Classification (Credit Reporting L.I. 2394)
  npaClass: NpaClass;
  daysOverdue: number;

  // DCD 2025 compliance tracking
  preAgreementDisplayedAt?: Date;  // Mandatory 30-second display
  preAgreementAcceptedAt?: Date;
  eSignatureHash?: string;
  coolingOffExpiresAt?: Date;      // 24-hour cooling off period

  // Status
  status: LoanStatus;
  purpose: string;
  rejectionReason?: string;
  approvedBy?: string;
  approvedAt?: Date;

  // Restructuring
  isRestructured: boolean;
  restructuringHistory: RestructuringRecord[];

  // Bureau reporting
  lastBureauSubmissionAt?: Date;
  bureauReferenceId?: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  branchCode?: string;
}

export interface LoanProduct {
  id: string;
  name: string;
  targetSegment: 'SME' | 'MICROCREDIT' | 'GROUP' | 'AGRICULTURAL';
  minAmount: number;
  maxAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
  annualInterestRatePercent: number;  // Must be <= 36% (BoG cap)
  interestType: 'SIMPLE';            // ONLY simple interest permitted
  processingFeePercent: number;
  penaltyRatePercent: number;
  requiresCollateral: boolean;
  requiresGuarantor: boolean;
  isActive: boolean;
}

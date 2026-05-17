/**
 * Ghana Credit Bureau Client
 *
 * Integrates with Ghana's licensed credit bureaus:
 * - XDS Data (licensed under Borrowers and Lenders Act 2020, Act 1052)
 * - CRB Africa (Credit Reference Bureau)
 *
 * All queries are routed through our backend proxy for:
 * 1. API key management
 * 2. Audit logging (mandatory under Act 1052)
 * 3. Data residency compliance
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreditBureauProvider = 'xds' | 'crb_africa' | 'combined';

export interface CreditFacility {
  facilityType:
    | 'personal_loan'
    | 'business_loan'
    | 'mortgage'
    | 'overdraft'
    | 'credit_card'
    | 'microfinance';
  provider: string;
  accountNumber: string;
  dateOpened: string;
  dateClosed?: string;
  creditLimit?: number;
  outstandingBalance: number;
  monthlyInstalment?: number;
  status: 'current' | 'overdue' | 'default' | 'written_off' | 'closed';
  daysOverdue?: number;
  worstStatus?: string;
}

export interface PaymentHistory {
  month: string; // YYYY-MM
  status: 'on_time' | 'late_1_30' | 'late_31_60' | 'late_61_90' | 'late_90_plus' | 'default' | 'no_data';
}

export interface CreditInquiry {
  inquiryDate: string;
  inquiringInstitution: string;
  inquiryType: 'hard' | 'soft';
  purpose: string;
}

export interface CreditBureauReport {
  reportId: string;
  provider: CreditBureauProvider;
  generatedAt: string;
  expiresAt: string;

  // Subject
  subjectName: string;
  ghanaCardNumber: string;
  dateOfBirth: string;
  addresses: string[];
  phoneNumbers: string[];

  // Scores
  creditScore: number; // 300-850 (XDS scale)
  scoreRating: 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor' | 'Very Poor';
  scoreFactors: string[];

  // Portfolio summary
  totalFacilities: number;
  activeFacilities: number;
  totalOutstanding: number;
  totalCreditLimit: number;
  overallUtilization: number; // 0-1

  // Risk indicators
  hasDefault: boolean;
  hasWriteOff: boolean;
  totalDefaults: number;
  totalWriteOffs: number;
  debtToIncomeRatio?: number;

  // Facilities
  facilities: CreditFacility[];

  // History
  paymentHistory: PaymentHistory[];
  recentInquiries: CreditInquiry[];

  // Affordability
  estimatedMonthlyObligations: number;
  maxAffordableLoan?: number;
  recommendedMaxInstalment?: number;

  // Flags
  isBankrupt: boolean;
  isDeceased: boolean;
  hasFraudAlert: boolean;
  fraudAlertDetails?: string;
}

export interface CreditQueryRequest {
  ghanaCardNumber: string;
  fullName: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  provider?: CreditBureauProvider;
  purpose: 'loan_application' | 'periodic_review' | 'collections' | 'kyc';
  requestedBy: string; // employee ID
  customerId?: string;
}

export interface CreditQueryResponse {
  success: boolean;
  queryId: string;
  report?: CreditBureauReport;
  error?: string;
  errorCode?: 'NOT_FOUND' | 'BUREAU_UNAVAILABLE' | 'CONSENT_REQUIRED' | 'QUOTA_EXCEEDED' | 'TIMEOUT';
  cachedUntil?: string;
  billingRef?: string;
}

export interface AffordabilityAssessment {
  requestedAmount: number;
  requestedTerm: number;
  interestRate: number;
  monthlyInstalment: number;
  monthlyIncome: number;
  existingObligations: number;
  debtToIncomeRatio: number;
  disposableIncome: number;
  isAffordable: boolean;
  maxAffordableInstalment: number;
  maxAffordableLoan: number;
  recommendation: 'approve' | 'reduce_amount' | 'reduce_term' | 'decline';
  notes: string;
}

// ─── Score Rating ─────────────────────────────────────────────────────────────

export function getCreditScoreRating(
  score: number
): CreditBureauReport['scoreRating'] {
  if (score >= 750) return 'Excellent';
  if (score >= 700) return 'Very Good';
  if (score >= 650) return 'Good';
  if (score >= 550) return 'Fair';
  if (score >= 450) return 'Poor';
  return 'Very Poor';
}

// ─── Affordability Calculator ─────────────────────────────────────────────────

/**
 * Calculates affordability using simple interest.
 * Per BoG DCD 2025: compounding interest PROHIBITED.
 */
export function assessAffordability(
  params: {
    requestedAmount: number;
    requestedTermMonths: number;
    annualInterestRate: number;
    monthlyIncome: number;
    existingMonthlyObligations: number;
  }
): AffordabilityAssessment {
  const { requestedAmount, requestedTermMonths, annualInterestRate, monthlyIncome, existingMonthlyObligations } = params;

  // Simple interest calculation ONLY
  const totalInterest = requestedAmount * (annualInterestRate / 100) * (requestedTermMonths / 12);
  const totalRepayable = requestedAmount + totalInterest;
  const monthlyInstalment = totalRepayable / requestedTermMonths;

  const totalObligations = existingMonthlyObligations + monthlyInstalment;
  const debtToIncomeRatio = totalObligations / monthlyIncome;
  const disposableIncome = monthlyIncome - totalObligations;

  // BoG guideline: max DTI = 40%
  const maxDti = 0.40;
  const maxAffordableInstalment = monthlyIncome * maxDti - existingMonthlyObligations;

  // Max loan based on affordability (simple interest)
  const monthlyRate = annualInterestRate / 100 / 12;
  const maxAffordableLoan =
    maxAffordableInstalment > 0
      ? (maxAffordableInstalment * requestedTermMonths) / (1 + (annualInterestRate / 100) * (requestedTermMonths / 12))
      : 0;

  const isAffordable = debtToIncomeRatio <= maxDti && disposableIncome > 0;

  let recommendation: AffordabilityAssessment['recommendation'];
  let notes: string;

  if (isAffordable) {
    recommendation = 'approve';
    notes = `DTI of ${(debtToIncomeRatio * 100).toFixed(1)}% is within the 40% BoG guideline.`;
  } else if (maxAffordableLoan >= requestedAmount * 0.8) {
    recommendation = 'reduce_term';
    notes = `Reducing the loan term would bring DTI within acceptable range.`;
  } else if (maxAffordableLoan >= requestedAmount * 0.5) {
    recommendation = 'reduce_amount';
    notes = `Maximum affordable loan is GHS ${maxAffordableLoan.toFixed(0)}. Consider reducing the requested amount.`;
  } else {
    recommendation = 'decline';
    notes = `DTI of ${(debtToIncomeRatio * 100).toFixed(1)}% exceeds BoG guideline of 40%. Insufficient disposable income.`;
  }

  return {
    requestedAmount,
    requestedTerm: requestedTermMonths,
    interestRate: annualInterestRate,
    monthlyInstalment,
    monthlyIncome,
    existingObligations: existingMonthlyObligations,
    debtToIncomeRatio,
    disposableIncome,
    isAffordable,
    maxAffordableInstalment: Math.max(0, maxAffordableInstalment),
    maxAffordableLoan: Math.max(0, maxAffordableLoan),
    recommendation,
    notes,
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CREDIT_CACHE_PREFIX = 'credit-bureau-';
const CREDIT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days per Act 1052

function getCachedReport(ghanaCardNumber: string): CreditBureauReport | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${CREDIT_CACHE_PREFIX}${ghanaCardNumber}`);
    if (!raw) return null;
    const cached: { report: CreditBureauReport; cachedAt: number } = JSON.parse(raw);
    if (Date.now() - cached.cachedAt > CREDIT_CACHE_TTL_MS) {
      sessionStorage.removeItem(`${CREDIT_CACHE_PREFIX}${ghanaCardNumber}`);
      return null;
    }
    return cached.report;
  } catch {
    return null;
  }
}

function setCachedReport(ghanaCardNumber: string, report: CreditBureauReport): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      `${CREDIT_CACHE_PREFIX}${ghanaCardNumber}`,
      JSON.stringify({ report, cachedAt: Date.now() })
    );
  } catch {
    // Quota exceeded — ignore
  }
}

// ─── Main Client Functions ────────────────────────────────────────────────────

/**
 * Queries the credit bureau for a customer's credit report.
 * Requires customer consent (recorded at onboarding).
 */
export async function queryCreditBureau(
  request: CreditQueryRequest
): Promise<CreditQueryResponse> {
  const normalized = request.ghanaCardNumber.trim().toUpperCase();

  // Check cache (session-scoped for security)
  const cached = getCachedReport(normalized);
  if (cached) {
    return {
      success: true,
      queryId: `cached-${Date.now()}`,
      report: cached,
      cachedUntil: new Date(Date.now() + CREDIT_CACHE_TTL_MS).toISOString(),
    };
  }

  try {
    const response = await fetch('/api/credit-bureau/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, ghanaCardNumber: normalized }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { errorCode?: string };
      return {
        success: false,
        queryId: '',
        error: `Credit bureau query failed: HTTP ${response.status}`,
        errorCode: (err.errorCode as CreditQueryResponse['errorCode']) ?? 'BUREAU_UNAVAILABLE',
      };
    }

    const result: CreditQueryResponse = await response.json();

    if (result.success && result.report) {
      setCachedReport(normalized, result.report);
    }

    return result;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      success: false,
      queryId: '',
      error: isTimeout ? 'Credit bureau query timed out' : 'Network error',
      errorCode: isTimeout ? 'TIMEOUT' : 'BUREAU_UNAVAILABLE',
    };
  }
}

/**
 * Parses and summarizes a credit bureau report for display.
 */
export function summarizeCreditReport(report: CreditBureauReport): {
  summary: string;
  flags: string[];
  recommendedAction: 'proceed' | 'manual_review' | 'decline';
} {
  const flags: string[] = [];

  if (report.hasDefault) flags.push('Default history');
  if (report.hasWriteOff) flags.push('Write-off history');
  if (report.isBankrupt) flags.push('Bankruptcy record');
  if (report.hasFraudAlert) flags.push(`Fraud alert: ${report.fraudAlertDetails}`);
  if (report.overallUtilization > 0.8) flags.push('High credit utilization (>80%)');
  if ((report.debtToIncomeRatio ?? 0) > 0.4) flags.push('High debt-to-income ratio (>40%)');
  if (report.recentInquiries.filter((i) => i.inquiryType === 'hard').length > 3) {
    flags.push('Multiple recent hard credit inquiries');
  }

  let recommendedAction: 'proceed' | 'manual_review' | 'decline';
  if (report.isBankrupt || report.hasFraudAlert || report.isDeceased) {
    recommendedAction = 'decline';
  } else if (flags.length >= 2 || report.creditScore < 450) {
    recommendedAction = 'manual_review';
  } else {
    recommendedAction = 'proceed';
  }

  const summary = `Credit score: ${report.creditScore} (${report.scoreRating}). ${report.totalFacilities} total facilities, ${report.activeFacilities} active. Outstanding: GHS ${report.totalOutstanding.toLocaleString()}.`;

  return { summary, flags, recommendedAction };
}

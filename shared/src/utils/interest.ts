/**
 * Ghana Simple Interest Calculator
 * REGULATORY REQUIREMENT: Digital Credit Directive 2025 (Bank of Ghana)
 * Compounding interest is STRICTLY PROHIBITED for digital credit in Ghana.
 * Any attempt to use compounding interest will throw a RegulatoryError.
 */

import { RegulatoryError, RegulatoryErrorCode } from '../constants/errors';
import { DCD_2025 } from '../constants/compliance';

export interface RepaymentInstalment {
  instalmentNumber: number;
  dueDate: Date;
  principalComponent: number;
  interestComponent: number;
  totalPayment: number;
  outstandingBalance: number;
}

export interface InterestCalculationResult {
  principal: number;
  ratePercentPA: number;
  termMonths: number;
  totalInterest: number;
  totalRepayment: number;
  monthlyInstalment: number;
  annualPercentageRate: number;
  repaymentSchedule: RepaymentInstalment[];
}

export interface PenaltyCalculationResult {
  daysOverdue: number;
  penaltyRate: number;
  penaltyAmount: number;
  totalOutstanding: number;
}

export interface PrepaymentCalculationResult {
  originalTotalCost: number;
  remainingPrincipal: number;
  interestSaved: number;
  prepaymentAmount: number;
  prepaymentDate: Date;
}

/**
 * CRITICAL COMPLIANCE CHECK: Detect any compounding interest parameters.
 * Called before every interest calculation.
 * Throws RegulatoryError if compounding is attempted.
 */
function assertNoCompounding(params: {
  isCompounding?: boolean;
  compoundingFrequency?: string;
  compoundingPeriod?: number;
}): void {
  if (
    params.isCompounding === true ||
    params.compoundingFrequency !== undefined ||
    params.compoundingPeriod !== undefined
  ) {
    throw new RegulatoryError(
      RegulatoryErrorCode.COMPOUNDING_INTEREST_PROHIBITED,
      'REGULATORY_VIOLATION: Compounding interest is PROHIBITED under Bank of Ghana ' +
        'Digital Credit Directive 2025. Only simple interest is permitted for digital credit. ' +
        'All interest must be calculated as: I = P × r × t',
      { params },
    );
  }
}

/**
 * Validate that the interest rate does not exceed the BoG cap.
 */
function assertRateWithinCap(ratePercentPA: number): void {
  if (ratePercentPA > DCD_2025.MAX_INTEREST_RATE_PA) {
    throw new RegulatoryError(
      RegulatoryErrorCode.INTEREST_RATE_EXCEEDS_CAP,
      `Interest rate ${ratePercentPA}% p.a. exceeds BoG maximum of ${DCD_2025.MAX_INTEREST_RATE_PA}% p.a.`,
    );
  }
}

/**
 * Calculate simple interest only: I = P × r × t
 *
 * @param principal - Loan principal in GHS
 * @param ratePercentPA - Annual interest rate as a percentage (e.g. 24 for 24% p.a.)
 * @param termMonths - Loan term in months
 * @param startDate - Loan disbursement date (defaults to today)
 * @param isCompounding - MUST NOT be true; throws regulatory error if true
 */
export function calculateSimpleInterest(
  principal: number,
  ratePercentPA: number,
  termMonths: number,
  startDate: Date = new Date(),
  isCompounding?: boolean,
): InterestCalculationResult {
  // REGULATORY GUARD: reject any compounding attempt
  assertNoCompounding({ isCompounding });
  assertRateWithinCap(ratePercentPA);

  if (principal <= 0) throw new Error('Principal must be positive');
  if (ratePercentPA < 0) throw new Error('Interest rate cannot be negative');
  if (termMonths <= 0 || !Number.isInteger(termMonths)) throw new Error('Term must be a positive integer in months');

  const monthlyRate = ratePercentPA / 100 / 12;

  // Simple interest: I = P * r * t (where t is in years)
  const termYears = termMonths / 12;
  const totalInterest = principal * (ratePercentPA / 100) * termYears;
  const totalRepayment = principal + totalInterest;
  const monthlyInstalment = totalRepayment / termMonths;

  // APR for simple interest equals the nominal rate
  const annualPercentageRate = ratePercentPA;

  // Generate repayment schedule
  const repaymentSchedule = generateRepaymentSchedule(
    principal,
    monthlyRate,
    monthlyInstalment,
    termMonths,
    startDate,
  );

  return {
    principal,
    ratePercentPA,
    termMonths,
    totalInterest: roundTo2DP(totalInterest),
    totalRepayment: roundTo2DP(totalRepayment),
    monthlyInstalment: roundTo2DP(monthlyInstalment),
    annualPercentageRate,
    repaymentSchedule,
  };
}

/**
 * Generate monthly repayment schedule for a simple interest loan.
 * Interest is pre-computed and evenly distributed across instalments.
 */
function generateRepaymentSchedule(
  principal: number,
  monthlyRate: number,
  monthlyInstalment: number,
  termMonths: number,
  startDate: Date,
): RepaymentInstalment[] {
  const schedule: RepaymentInstalment[] = [];
  const totalInterest = principal * monthlyRate * termMonths;
  const interestPerInstalment = totalInterest / termMonths;
  const principalPerInstalment = principal / termMonths;
  let outstandingBalance = principal;

  for (let i = 1; i <= termMonths; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    const principalComponent = roundTo2DP(principalPerInstalment);
    const interestComponent = roundTo2DP(interestPerInstalment);
    outstandingBalance = roundTo2DP(outstandingBalance - principalComponent);

    schedule.push({
      instalmentNumber: i,
      dueDate,
      principalComponent,
      interestComponent,
      totalPayment: roundTo2DP(principalComponent + interestComponent),
      outstandingBalance: Math.max(0, outstandingBalance),
    });
  }

  return schedule;
}

/**
 * Calculate penalty for overdue payments.
 * Penalty is simple interest on overdue amount - NOT compounding.
 */
export function calculatePenalty(
  overdueAmount: number,
  penaltyRatePercentPA: number,
  daysOverdue: number,
): PenaltyCalculationResult {
  // Penalty is also simple interest only
  assertNoCompounding({});
  const penaltyAmount = overdueAmount * (penaltyRatePercentPA / 100) * (daysOverdue / 365);

  return {
    daysOverdue,
    penaltyRate: penaltyRatePercentPA,
    penaltyAmount: roundTo2DP(penaltyAmount),
    totalOutstanding: roundTo2DP(overdueAmount + penaltyAmount),
  };
}

/**
 * Calculate prepayment: how much to pay now to settle the loan early.
 * For simple interest, only remaining principal is due (interest not yet accrued is saved).
 */
export function calculatePrepayment(
  originalPrincipal: number,
  ratePercentPA: number,
  termMonths: number,
  monthsPaid: number,
  prepaymentDate: Date = new Date(),
): PrepaymentCalculationResult {
  assertNoCompounding({});

  const termYears = termMonths / 12;
  const originalTotalInterest = originalPrincipal * (ratePercentPA / 100) * termYears;
  const originalTotalCost = originalPrincipal + originalTotalInterest;

  const principalPaidSoFar = (originalPrincipal / termMonths) * monthsPaid;
  const interestPaidSoFar = (originalTotalInterest / termMonths) * monthsPaid;

  const remainingPrincipal = originalPrincipal - principalPaidSoFar;
  const remainingInterestIfFullTerm = originalTotalInterest - interestPaidSoFar;

  return {
    originalTotalCost: roundTo2DP(originalTotalCost),
    remainingPrincipal: roundTo2DP(remainingPrincipal),
    interestSaved: roundTo2DP(remainingInterestIfFullTerm),
    prepaymentAmount: roundTo2DP(remainingPrincipal),
    prepaymentDate,
  };
}

function roundTo2DP(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format interest amount for display in multiple Ghana languages.
 */
export function formatInterestSummary(result: InterestCalculationResult, language: string = 'en'): string {
  const labels: Record<string, Record<string, string>> = {
    en: { principal: 'Principal', interest: 'Total Interest', repayment: 'Total Repayment', monthly: 'Monthly Payment' },
    tw: { principal: 'Sika a wogye', interest: 'Dwan sika', repayment: 'Sika nyinaa', monthly: 'Bosome biara' },
    ga: { principal: 'Sika baa', interest: 'Sika shi akɛ', repayment: 'Sika nyɛmɔ', monthly: 'Ngmɛi biaa' },
    ee: { principal: 'Gadzraƒe', interest: 'Atsina', repayment: 'Ɖoɖo nyuie', monthly: 'Ɣleti sia ɣleti' },
    ha: { principal: 'Babban bashi', interest: 'Riba', repayment: 'Jimlar biya', monthly: 'Kowane wata' },
  };
  const l = labels[language] ?? labels['en'];
  return [
    `${l['principal']}: GH₵${result.principal.toFixed(2)}`,
    `${l['interest']}: GH₵${result.totalInterest.toFixed(2)}`,
    `${l['repayment']}: GH₵${result.totalRepayment.toFixed(2)}`,
    `${l['monthly']}: GH₵${result.monthlyInstalment.toFixed(2)}`,
  ].join('\n');
}

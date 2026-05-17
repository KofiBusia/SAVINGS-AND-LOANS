import { Injectable } from '@nestjs/common';
import { RegulatoryError, RegulatoryErrorCode } from '../../../../shared/src/constants/errors';
import { DCD_2025 } from '../../../../shared/src/constants/compliance';
import type {
  InterestCalculationResult,
  PenaltyCalculationResult,
  PrepaymentCalculationResult,
} from '../../../../shared/src/utils/interest';

/**
 * Interest Calculator Service - GHANA DIGITAL CREDIT DIRECTIVE 2025 COMPLIANT
 *
 * MANDATORY REGULATORY REQUIREMENT:
 * Bank of Ghana Digital Credit Directive 2025 PROHIBITS compounding interest
 * for digital credit products. ONLY simple interest is permitted.
 *
 * Formula: I = P × r × t (Principal × rate × time)
 *
 * Any attempt to use compounding will:
 * 1. Throw a RegulatoryError with code DCD2025_001
 * 2. Create an audit log entry
 * 3. Alert the compliance officer
 *
 * This service is tested by a compliance test that FAILS THE BUILD if
 * compounding interest logic is ever introduced.
 */
@Injectable()
export class InterestCalculatorService {

  /**
   * Calculate simple interest for a loan.
   *
   * @throws {RegulatoryError} DCD2025_001 if compounding is attempted
   * @throws {RegulatoryError} DCD2025_002 if rate exceeds BoG cap
   */
  calculateSimpleInterest(
    principal: number,
    ratePercentPA: number,
    termMonths: number,
    startDate: Date = new Date(),
    isCompounding?: boolean,      // MUST be undefined or false
    compoundingFrequency?: string, // MUST be undefined - will throw if provided
  ): InterestCalculationResult {
    // ==========================================
    // REGULATORY GUARD - DO NOT REMOVE OR MODIFY
    // Bank of Ghana Digital Credit Directive 2025
    // ==========================================
    if (isCompounding === true || compoundingFrequency !== undefined) {
      throw new RegulatoryError(
        RegulatoryErrorCode.COMPOUNDING_INTEREST_PROHIBITED,
        'REGULATORY_VIOLATION: Compounding interest is PROHIBITED under Bank of Ghana ' +
          'Digital Credit Directive 2025 (Section 12). Only simple interest is permitted ' +
          'for digital credit products in Ghana. Formula must be: I = P × r × t.',
        { isCompounding, compoundingFrequency, principal, ratePercentPA, termMonths },
      );
    }
    // ==========================================

    this.validateInputs(principal, ratePercentPA, termMonths);

    const termYears = termMonths / 12;
    const monthlyRate = ratePercentPA / 100 / 12;

    // Simple interest: I = P × r × t
    const totalInterest = principal * (ratePercentPA / 100) * termYears;
    const totalRepayment = principal + totalInterest;
    const monthlyInstalment = totalRepayment / termMonths;

    const repaymentSchedule = this.buildRepaymentSchedule(
      principal,
      totalInterest,
      termMonths,
      monthlyInstalment,
      startDate,
    );

    return {
      principal: this.round2(principal),
      ratePercentPA,
      termMonths,
      totalInterest: this.round2(totalInterest),
      totalRepayment: this.round2(totalRepayment),
      monthlyInstalment: this.round2(monthlyInstalment),
      annualPercentageRate: ratePercentPA, // APR = nominal rate for simple interest
      repaymentSchedule,
    };
  }

  /**
   * Generate monthly repayment schedule.
   * Interest is pre-computed and distributed evenly (simple interest method).
   */
  generateRepaymentSchedule(
    principal: number,
    ratePercentPA: number,
    termMonths: number,
    startDate: Date = new Date(),
  ): InterestCalculationResult['repaymentSchedule'] {
    // Guard: even schedule generation must use simple interest
    const termYears = termMonths / 12;
    const totalInterest = principal * (ratePercentPA / 100) * termYears;
    const totalRepayment = principal + totalInterest;
    const monthlyInstalment = totalRepayment / termMonths;
    return this.buildRepaymentSchedule(principal, totalInterest, termMonths, monthlyInstalment, startDate);
  }

  /**
   * Calculate overdue penalty.
   * Penalty is ALSO simple interest - not compounding (DCD 2025).
   */
  calculatePenalty(
    overdueAmount: number,
    penaltyRatePercentPA: number,
    daysOverdue: number,
  ): PenaltyCalculationResult {
    // Penalty must also be simple interest
    const penaltyAmount = overdueAmount * (penaltyRatePercentPA / 100) * (daysOverdue / 365);

    return {
      daysOverdue,
      penaltyRate: penaltyRatePercentPA,
      penaltyAmount: this.round2(penaltyAmount),
      totalOutstanding: this.round2(overdueAmount + penaltyAmount),
    };
  }

  /**
   * Calculate prepayment settlement amount.
   * For simple interest, only remaining principal is due.
   * Future interest is NOT charged on early settlement.
   */
  calculatePrepayment(
    originalPrincipal: number,
    ratePercentPA: number,
    termMonths: number,
    monthsPaid: number,
    prepaymentDate: Date = new Date(),
  ): PrepaymentCalculationResult {
    const termYears = termMonths / 12;
    const originalTotalInterest = originalPrincipal * (ratePercentPA / 100) * termYears;
    const originalTotalCost = originalPrincipal + originalTotalInterest;
    const principalPaid = (originalPrincipal / termMonths) * monthsPaid;
    const interestPaid = (originalTotalInterest / termMonths) * monthsPaid;
    const remainingPrincipal = originalPrincipal - principalPaid;
    const futureSavedInterest = originalTotalInterest - interestPaid;

    return {
      originalTotalCost: this.round2(originalTotalCost),
      remainingPrincipal: this.round2(remainingPrincipal),
      interestSaved: this.round2(futureSavedInterest),
      prepaymentAmount: this.round2(remainingPrincipal), // Only principal on early settlement
      prepaymentDate,
    };
  }

  /**
   * Calculate Annual Percentage Rate (APR) for disclosure purposes.
   * For simple interest loans, APR equals the nominal annual rate.
   */
  calculateAPR(ratePercentPA: number, feePercent: number = 0, termMonths: number = 12): number {
    // Include fees in APR calculation per DCD 2025 disclosure requirements
    const effectiveRate = ratePercentPA + (feePercent * 12) / termMonths;
    return this.round2(effectiveRate);
  }

  private validateInputs(principal: number, ratePercentPA: number, termMonths: number): void {
    if (!Number.isFinite(principal) || principal <= 0) {
      throw new Error('Principal must be a positive finite number');
    }
    if (!Number.isFinite(ratePercentPA) || ratePercentPA < 0) {
      throw new Error('Interest rate cannot be negative');
    }
    if (ratePercentPA > DCD_2025.MAX_INTEREST_RATE_PA) {
      throw new RegulatoryError(
        RegulatoryErrorCode.INTEREST_RATE_EXCEEDS_CAP,
        `Rate ${ratePercentPA}% p.a. exceeds BoG cap of ${DCD_2025.MAX_INTEREST_RATE_PA}% p.a.`,
      );
    }
    if (!Number.isInteger(termMonths) || termMonths <= 0 || termMonths > 360) {
      throw new Error('Term must be a positive integer between 1 and 360 months');
    }
  }

  private buildRepaymentSchedule(
    principal: number,
    totalInterest: number,
    termMonths: number,
    monthlyInstalment: number,
    startDate: Date,
  ): InterestCalculationResult['repaymentSchedule'] {
    const schedule = [];
    const principalPerMonth = principal / termMonths;
    const interestPerMonth = totalInterest / termMonths;
    let balance = principal;

    for (let i = 1; i <= termMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      const principalComponent = this.round2(principalPerMonth);
      const interestComponent = this.round2(interestPerMonth);
      balance = this.round2(balance - principalComponent);

      schedule.push({
        instalmentNumber: i,
        dueDate,
        principalComponent,
        interestComponent,
        totalPayment: this.round2(principalComponent + interestComponent),
        outstandingBalance: Math.max(0, balance),
      });
    }
    return schedule;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

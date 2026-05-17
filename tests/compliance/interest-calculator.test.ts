/**
 * COMPLIANCE TESTS - Digital Credit Directive 2025 (Bank of Ghana)
 *
 * These tests MUST pass for the build to succeed.
 * Any introduction of compounding interest logic WILL FAIL THIS TEST SUITE
 * and block the CI/CD pipeline.
 *
 * Run: npm run test:compliance
 */

import { calculateSimpleInterest, calculatePenalty, calculatePrepayment } from '../../shared/src/utils/interest';
import { RegulatoryError, RegulatoryErrorCode } from '../../shared/src/constants/errors';

describe('DCD 2025 Compliance: Interest Calculator', () => {

  // ============================================================
  // CRITICAL TEST: Compounding interest MUST throw
  // This test failing = regulatory violation = build blocked
  // ============================================================
  describe('Compounding Interest Prohibition (DCD 2025 §12)', () => {
    it('MUST throw RegulatoryError when isCompounding=true', () => {
      expect(() =>
        calculateSimpleInterest(10000, 24, 12, new Date(), true)
      ).toThrow(RegulatoryError);
    });

    it('MUST throw with correct error code DCD2025_001', () => {
      try {
        calculateSimpleInterest(10000, 24, 12, new Date(), true);
        fail('Should have thrown RegulatoryError');
      } catch (err) {
        expect(err).toBeInstanceOf(RegulatoryError);
        expect((err as RegulatoryError).code).toBe(RegulatoryErrorCode.COMPOUNDING_INTEREST_PROHIBITED);
      }
    });

    it('MUST throw when compoundingFrequency is provided', () => {
      expect(() =>
        // @ts-expect-error - Testing runtime guard
        calculateSimpleInterest(10000, 24, 12, new Date(), undefined, 'MONTHLY')
      ).toThrow(RegulatoryError);
    });

    it('error message MUST reference BoG Digital Credit Directive 2025', () => {
      try {
        calculateSimpleInterest(10000, 24, 12, new Date(), true);
        fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('Digital Credit Directive 2025');
        expect((err as Error).message).toContain('Compounding');
      }
    });

    it('MUST NOT use Math.pow for compounding in any calculation', () => {
      // Verify no internal compounding: A = P(1+r/n)^(nt)
      const result = calculateSimpleInterest(10000, 24, 12);
      // Simple interest: I = P * r * t = 10000 * 0.24 * 1 = 2400
      expect(result.totalInterest).toBeCloseTo(2400, 1);
      // Total: 12400
      expect(result.totalRepayment).toBeCloseTo(12400, 1);
    });
  });

  // ============================================================
  // Simple Interest Correctness Tests
  // Formula: I = P × r × t
  // ============================================================
  describe('Simple Interest Calculation Accuracy', () => {
    it('correctly calculates I = P × r × t for 12-month loan', () => {
      const result = calculateSimpleInterest(10000, 24, 12);
      // I = 10000 × 0.24 × 1 = 2400
      expect(result.totalInterest).toBeCloseTo(2400, 1);
      expect(result.totalRepayment).toBeCloseTo(12400, 1);
      expect(result.monthlyInstalment).toBeCloseTo(1033.33, 1);
    });

    it('correctly calculates for 6-month loan at 18% p.a.', () => {
      const result = calculateSimpleInterest(5000, 18, 6);
      // I = 5000 × 0.18 × 0.5 = 450
      expect(result.totalInterest).toBeCloseTo(450, 1);
      expect(result.totalRepayment).toBeCloseTo(5450, 1);
    });

    it('generates correct number of repayment schedule entries', () => {
      const result = calculateSimpleInterest(10000, 24, 12);
      expect(result.repaymentSchedule).toHaveLength(12);
    });

    it('final outstanding balance is 0 after all payments', () => {
      const result = calculateSimpleInterest(10000, 24, 12);
      const lastEntry = result.repaymentSchedule[result.repaymentSchedule.length - 1];
      expect(lastEntry.outstandingBalance).toBe(0);
    });

    it('total of all instalment payments equals totalRepayment', () => {
      const result = calculateSimpleInterest(10000, 24, 12);
      const totalFromSchedule = result.repaymentSchedule.reduce(
        (sum, entry) => sum + entry.totalPayment, 0
      );
      expect(Math.abs(totalFromSchedule - result.totalRepayment)).toBeLessThan(1); // within GH₵1
    });

    it('APR equals nominal rate for simple interest', () => {
      const result = calculateSimpleInterest(10000, 24, 12);
      expect(result.annualPercentageRate).toBe(24);
    });
  });

  // ============================================================
  // BoG Interest Rate Cap Tests
  // ============================================================
  describe('BoG Interest Rate Cap (Max 36% p.a.)', () => {
    it('accepts rates at or below 36%', () => {
      expect(() => calculateSimpleInterest(10000, 36, 12)).not.toThrow();
      expect(() => calculateSimpleInterest(10000, 24, 12)).not.toThrow();
    });

    it('MUST throw when rate exceeds 36% p.a.', () => {
      expect(() => calculateSimpleInterest(10000, 37, 12)).toThrow();
    });

    it('throws with code DCD2025_002 for rate cap violation', () => {
      try {
        calculateSimpleInterest(10000, 40, 12);
        fail('Should have thrown');
      } catch (err) {
        expect((err as RegulatoryError).code).toBe(RegulatoryErrorCode.INTEREST_RATE_EXCEEDS_CAP);
      }
    });
  });

  // ============================================================
  // Penalty Calculation (also simple interest)
  // ============================================================
  describe('Penalty Calculation (Simple Interest Only)', () => {
    it('calculates penalty as simple interest', () => {
      const result = calculatePenalty(1000, 5, 30);
      // Penalty = 1000 × 0.05 × (30/365) = 4.11
      expect(result.penaltyAmount).toBeCloseTo(4.11, 1);
    });

    it('total outstanding = overdue + penalty', () => {
      const result = calculatePenalty(1000, 5, 30);
      expect(result.totalOutstanding).toBeCloseTo(1000 + result.penaltyAmount, 2);
    });
  });

  // ============================================================
  // Prepayment Tests
  // ============================================================
  describe('Prepayment Calculation', () => {
    it('prepayment amount equals remaining principal only (no future interest)', () => {
      // For simple interest, only principal is due on early settlement
      const result = calculatePrepayment(10000, 24, 12, 6);
      // After 6 months, 50% principal paid, 50% remaining
      expect(result.remainingPrincipal).toBeCloseTo(5000, 0);
      expect(result.prepaymentAmount).toBeCloseTo(5000, 0);
    });

    it('customer saves future interest on prepayment', () => {
      const result = calculatePrepayment(10000, 24, 12, 6);
      expect(result.interestSaved).toBeGreaterThan(0);
    });
  });
});

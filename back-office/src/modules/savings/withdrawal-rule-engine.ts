import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WithdrawalRuleType } from './savings.entity';

export interface WithdrawalRuleConfig {
  type:           WithdrawalRuleType;
  value:          number | string | Date;
  penaltyRate?:   number;    // Annual % of withdrawn amount
  description:    string;
  isActive:       boolean;
}

export interface WithdrawalEvaluationResult {
  allowed:            boolean;
  violations:         string[];
  warnings:           string[];
  penaltyAmount:      number;
  penaltyRate:        number;
  penaltyReason?:     string;
  applicableRules:    string[];
}

@Injectable()
export class WithdrawalRuleEngine {
  private readonly logger = new Logger(WithdrawalRuleEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Evaluate Withdrawal Against All Rules ────────────────────────────────────

  async evaluateWithdrawal(
    account:        Record<string, unknown>,
    requestedAmount: number,
    requestDate:    Date,
  ): Promise<WithdrawalEvaluationResult> {
    const result: WithdrawalEvaluationResult = {
      allowed:         true,
      violations:      [],
      warnings:        [],
      penaltyAmount:   0,
      penaltyRate:     0,
      applicableRules: [],
    };

    // Fetch rules from DB for this account's product
    const productRules = await this.prisma.withdrawalRule.findMany({
      where: {
        productId: account.productId as string,
        isActive:  true,
      },
    });

    for (const rule of productRules) {
      const ruleConfig: WithdrawalRuleConfig = {
        type:        rule.type as WithdrawalRuleType,
        value:       rule.value as number | string | Date,
        penaltyRate: rule.penaltyRate as number ?? undefined,
        description: rule.description as string,
        isActive:    rule.isActive as boolean,
      };

      const ruleResult = this.applyRule(account, requestedAmount, requestDate, ruleConfig);

      result.applicableRules.push(rule.type as string);

      if (!ruleResult.allowed) {
        result.allowed = false;
        result.violations.push(...ruleResult.violations);
      }

      result.warnings.push(...ruleResult.warnings);

      // Accumulate penalties
      if (ruleResult.penaltyAmount > 0) {
        result.penaltyAmount  += ruleResult.penaltyAmount;
        result.penaltyRate    += ruleResult.penaltyRate;
        result.penaltyReason   = ruleResult.penaltyReason;
      }
    }

    result.penaltyAmount = this.round2(result.penaltyAmount);
    return result;
  }

  // ─── Apply Individual Rule ────────────────────────────────────────────────────

  private applyRule(
    account:         Record<string, unknown>,
    requestedAmount: number,
    requestDate:     Date,
    rule:            WithdrawalRuleConfig,
  ): WithdrawalEvaluationResult {
    const result: WithdrawalEvaluationResult = {
      allowed:         true,
      violations:      [],
      warnings:        [],
      penaltyAmount:   0,
      penaltyRate:     0,
      applicableRules: [rule.type],
    };

    switch (rule.type) {
      case WithdrawalRuleType.LOCK_IN_PERIOD:
        this.applyLockInRule(account, requestDate, rule, result);
        break;

      case WithdrawalRuleType.MINIMUM_BALANCE:
        this.applyMinimumBalanceRule(account, requestedAmount, rule, result);
        break;

      case WithdrawalRuleType.FREQUENCY_LIMIT:
        this.applyFrequencyLimitRule(account, requestDate, rule, result);
        break;

      case WithdrawalRuleType.NOTICE_PERIOD:
        this.applyNoticePeriodRule(account, requestDate, rule, result);
        break;

      case WithdrawalRuleType.PARTIAL_ONLY:
        this.applyPartialOnlyRule(account, requestedAmount, rule, result);
        break;

      case WithdrawalRuleType.RESTRICTED_DATES:
        this.applyRestrictedDatesRule(requestDate, rule, result);
        break;

      default:
        this.logger.warn(`Unknown withdrawal rule type: ${rule.type as string}`);
    }

    return result;
  }

  // ─── Lock-In Period Rule ──────────────────────────────────────────────────────

  private applyLockInRule(
    account:     Record<string, unknown>,
    requestDate: Date,
    rule:        WithdrawalRuleConfig,
    result:      WithdrawalEvaluationResult,
  ): void {
    const openedAt      = account.openedAt as Date;
    const termStartDate = (account.termStartDate as Date) ?? openedAt;
    const lockInDays    = rule.value as number;

    const lockInEndDate = new Date(termStartDate);
    lockInEndDate.setDate(lockInEndDate.getDate() + lockInDays);

    if (requestDate < lockInEndDate) {
      const daysRemaining = Math.ceil(
        (lockInEndDate.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (rule.penaltyRate && rule.penaltyRate > 0) {
        // Penalty for early withdrawal during lock-in
        const balance      = account.ledgerBalance as number;
        const penaltyAmt   = this.round2(balance * (rule.penaltyRate / 100));
        result.penaltyAmount = penaltyAmt;
        result.penaltyRate   = rule.penaltyRate;
        result.penaltyReason = `Early withdrawal during ${lockInDays}-day lock-in period`;
        result.warnings.push(
          `Early withdrawal penalty of ${rule.penaltyRate}% (GHS ${penaltyAmt.toFixed(2)}) applies. ` +
          `${daysRemaining} days remaining in lock-in period.`,
        );
        // Allowed but with penalty
      } else {
        // Fully blocked
        result.allowed = false;
        result.violations.push(
          `Withdrawal blocked: account is within ${lockInDays}-day lock-in period. ` +
          `${daysRemaining} days remaining until ${lockInEndDate.toISOString().substring(0, 10)}.`,
        );
      }
    }
  }

  // ─── Minimum Balance Rule ─────────────────────────────────────────────────────

  private applyMinimumBalanceRule(
    account:         Record<string, unknown>,
    requestedAmount: number,
    rule:            WithdrawalRuleConfig,
    result:          WithdrawalEvaluationResult,
  ): void {
    const minimumBalance = rule.value as number;
    const currentBalance = account.ledgerBalance as number;
    const balanceAfter   = this.round2(currentBalance - requestedAmount);

    if (balanceAfter < minimumBalance) {
      const maxWithdrawable = this.round2(currentBalance - minimumBalance);

      if (maxWithdrawable <= 0) {
        result.allowed = false;
        result.violations.push(
          `Withdrawal blocked: current balance (GHS ${currentBalance.toFixed(2)}) is at or below minimum balance requirement (GHS ${minimumBalance.toFixed(2)}).`,
        );
      } else {
        result.allowed = false;
        result.violations.push(
          `Withdrawal of GHS ${requestedAmount.toFixed(2)} would reduce balance below minimum of GHS ${minimumBalance.toFixed(2)}. ` +
          `Maximum withdrawable: GHS ${maxWithdrawable.toFixed(2)}.`,
        );
      }
    }
  }

  // ─── Frequency Limit Rule ─────────────────────────────────────────────────────

  private applyFrequencyLimitRule(
    account:     Record<string, unknown>,
    requestDate: Date,
    rule:        WithdrawalRuleConfig,
    result:      WithdrawalEvaluationResult,
  ): void {
    // value = max withdrawals per month
    const maxPerMonth = rule.value as number;

    // Count withdrawals this month — would normally query DB
    // Using account metadata for simplicity here
    const monthStart = new Date(requestDate.getFullYear(), requestDate.getMonth(), 1);
    const monthWithdrawals = (account.monthlyWithdrawalCount as number) ?? 0;

    if (monthWithdrawals >= maxPerMonth) {
      result.allowed = false;
      result.violations.push(
        `Monthly withdrawal limit reached: ${monthWithdrawals}/${maxPerMonth} withdrawals this month. ` +
        `Next withdrawal allowed from ${new Date(requestDate.getFullYear(), requestDate.getMonth() + 1, 1).toISOString().substring(0, 10)}.`,
      );
    } else if (monthWithdrawals >= maxPerMonth - 1) {
      result.warnings.push(
        `This will be withdrawal ${monthWithdrawals + 1} of ${maxPerMonth} allowed this month.`,
      );
    }

    void monthStart; // suppress unused variable warning
  }

  // ─── Notice Period Rule ───────────────────────────────────────────────────────

  private applyNoticePeriodRule(
    account:     Record<string, unknown>,
    requestDate: Date,
    rule:        WithdrawalRuleConfig,
    result:      WithdrawalEvaluationResult,
  ): void {
    const noticeDays = rule.value as number;

    // Check if a notice has been filed
    const noticeFiledAt = account.withdrawalNoticeFiledAt as Date | null;

    if (!noticeFiledAt) {
      result.allowed = false;
      result.violations.push(
        `This account requires ${noticeDays} days' notice before withdrawal. ` +
        `Please file a withdrawal notice to begin the notice period.`,
      );
      return;
    }

    const noticeEndDate = new Date(noticeFiledAt);
    noticeEndDate.setDate(noticeEndDate.getDate() + noticeDays);

    if (requestDate < noticeEndDate) {
      const daysRemaining = Math.ceil(
        (noticeEndDate.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      result.allowed = false;
      result.violations.push(
        `Notice period not yet completed. ${daysRemaining} days remaining. ` +
        `Withdrawal available from ${noticeEndDate.toISOString().substring(0, 10)}.`,
      );
    }
  }

  // ─── Partial Only Rule ────────────────────────────────────────────────────────

  private applyPartialOnlyRule(
    account:         Record<string, unknown>,
    requestedAmount: number,
    rule:            WithdrawalRuleConfig,
    result:          WithdrawalEvaluationResult,
  ): void {
    // value = max percentage of balance per withdrawal (e.g., 50 = max 50%)
    const maxPercent  = rule.value as number;
    const balance     = account.ledgerBalance as number;
    const maxAllowed  = this.round2(balance * (maxPercent / 100));

    if (requestedAmount > maxAllowed) {
      result.allowed = false;
      result.violations.push(
        `Partial withdrawal only: maximum ${maxPercent}% of balance per transaction. ` +
        `Maximum allowed: GHS ${maxAllowed.toFixed(2)}. Requested: GHS ${requestedAmount.toFixed(2)}.`,
      );
    }
  }

  // ─── Restricted Dates Rule ────────────────────────────────────────────────────

  private applyRestrictedDatesRule(
    requestDate: Date,
    rule:        WithdrawalRuleConfig,
    result:      WithdrawalEvaluationResult,
  ): void {
    // value = comma-separated restricted day/month pairs: "01-01,25-12,06-03"
    const restrictedDates = (rule.value as string).split(',').map((d) => d.trim());
    const requestMD = `${String(requestDate.getDate()).padStart(2, '0')}-${String(requestDate.getMonth() + 1).padStart(2, '0')}`;

    if (restrictedDates.includes(requestMD)) {
      result.allowed = false;
      result.violations.push(
        `Withdrawals are not permitted on ${requestMD}. ${rule.description}.`,
      );
    }
  }

  // ─── Calculate Maximum Withdrawable Amount ────────────────────────────────────

  async calculateMaxWithdrawable(
    account:     Record<string, unknown>,
    requestDate: Date,
  ): Promise<{ maxAmount: number; constraints: string[] }> {
    const balance     = account.ledgerBalance as number;
    const constraints: string[] = [];

    const productRules = await this.prisma.withdrawalRule.findMany({
      where: {
        productId: account.productId as string,
        isActive:  true,
      },
    });

    let maxAmount = balance;

    for (const rule of productRules) {
      switch (rule.type as WithdrawalRuleType) {
        case WithdrawalRuleType.MINIMUM_BALANCE: {
          const minBal = rule.value as number;
          const afterMin = this.round2(balance - minBal);
          if (afterMin < maxAmount) {
            maxAmount = Math.max(0, afterMin);
            constraints.push(`Minimum balance: GHS ${minBal} must remain`);
          }
          break;
        }

        case WithdrawalRuleType.PARTIAL_ONLY: {
          const maxPct = rule.value as number;
          const afterPartial = this.round2(balance * (maxPct / 100));
          if (afterPartial < maxAmount) {
            maxAmount = afterPartial;
            constraints.push(`Partial withdrawal limit: ${maxPct}% of balance`);
          }
          break;
        }

        case WithdrawalRuleType.LOCK_IN_PERIOD: {
          const termStart  = (account.termStartDate as Date) ?? (account.openedAt as Date);
          const lockInDays = rule.value as number;
          const lockEnd    = new Date(termStart);
          lockEnd.setDate(lockEnd.getDate() + lockInDays);
          if (requestDate < lockEnd && !rule.penaltyRate) {
            maxAmount = 0;
            constraints.push(`Lock-in period active until ${lockEnd.toISOString().substring(0, 10)}`);
          }
          break;
        }
      }
    }

    return { maxAmount: this.round2(maxAmount), constraints };
  }

  // ─── Penalty Calculator ───────────────────────────────────────────────────────

  calculatePenalty(
    withdrawalAmount: number,
    penaltyRatePercent: number,
    reason: string,
  ): { penaltyAmount: number; description: string } {
    const penaltyAmount = this.round2(withdrawalAmount * (penaltyRatePercent / 100));
    return {
      penaltyAmount,
      description: `${reason}: ${penaltyRatePercent}% of GHS ${withdrawalAmount.toFixed(2)} = GHS ${penaltyAmount.toFixed(2)}`,
    };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

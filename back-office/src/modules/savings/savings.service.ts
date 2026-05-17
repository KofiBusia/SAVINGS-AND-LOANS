import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';
import { WithdrawalRuleEngine } from './withdrawal-rule-engine';
import {
  SavingsAccountStatus,
  SavingsProductType,
  InterestAccrualMethod,
  SavingsStatement,
  StatementTransaction,
} from './savings.entity';

export interface CreateSavingsAccountDto {
  customerId:       string;
  productType:      SavingsProductType;
  productId:        string;
  initialDepositGHS?: number;
  branchCode:       string;
  notes?:           string;
}

export interface DepositDto {
  accountId:      string;
  amountGHS:      number;
  channel:        string;
  transactionRef: string;
  notes?:         string;
  receivedBy:     string;
}

export interface WithdrawalDto {
  accountId:        string;
  amountGHS:        number;
  channel:          string;
  transactionRef?:  string;
  purpose:          string;
  requestedBy:      string;
  approvedBy?:      string;    // Required for large withdrawals
  waivePenalty?:    boolean;   // Officer override
}

export interface WithdrawalResult {
  success:         boolean;
  amountWithdrawn: number;
  penaltyAmount:   number;
  newBalance:      number;
  transactionRef:  string;
  message:         string;
}

@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly withdrawalRuleEngine: WithdrawalRuleEngine,
  ) {}

  // ─── Open Savings Account ─────────────────────────────────────────────────────

  async openAccount(
    dto: CreateSavingsAccountDto,
    openedByUserId: string,
  ): Promise<{ accountId: string; accountNumber: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId, deletedAt: null },
    });

    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (customer.status !== 'ACTIVE') {
      throw new BadRequestException(`Customer must be ACTIVE to open a savings account. Status: ${customer.status}`);
    }
    if (customer.kycStatus !== 'COMPLETED') {
      throw new BadRequestException('Customer KYC must be COMPLETED before opening savings account');
    }

    const product = await this.prisma.savingsProduct.findUnique({
      where: { id: dto.productId, isActive: true },
    });

    if (!product) throw new NotFoundException(`Savings product ${dto.productId} not found`);

    const accountNumber = await this.generateAccountNumber();
    const minBalance    = (product.minimumBalance as number) ?? 0;

    if (dto.initialDepositGHS !== undefined && dto.initialDepositGHS < minBalance) {
      throw new BadRequestException(
        `Initial deposit (GHS ${dto.initialDepositGHS}) is below minimum balance (GHS ${minBalance}) for this product`,
      );
    }

    const account = await this.prisma.savingsAccount.create({
      data: {
        accountNumber,
        customerId:         dto.customerId,
        productId:          dto.productId,
        productType:        dto.productType,
        status:             SavingsAccountStatus.ACTIVE,
        ledgerBalance:      dto.initialDepositGHS ?? 0,
        availableBalance:   dto.initialDepositGHS ?? 0,
        minimumBalance:     minBalance,
        annualInterestRate: product.annualInterestRate as number,
        accrualMethod:      (product.accrualMethod as string) ?? InterestAccrualMethod.DAILY_BALANCE,
        accruedInterestGHS: 0,
        nextInterestPostingDate: this.nextMonthStart(),
        isTermDeposit:      dto.productType === SavingsProductType.FIXED_DEPOSIT,
        isDividendEligible: [SavingsProductType.COOPERATIVE_SHARES, SavingsProductType.GROUP_SAVINGS].includes(dto.productType),
        totalDividendsPaidGHS: 0,
        branchCode:         dto.branchCode,
        openedBy:           openedByUserId,
        openedAt:           new Date(),
        tags:               [],
        notes:              dto.notes ?? null,
      },
    });

    // Record initial deposit if provided
    if (dto.initialDepositGHS && dto.initialDepositGHS > 0) {
      await this.prisma.transaction.create({
        data: {
          accountId:     account.id,
          customerId:    dto.customerId,
          type:          'DEPOSIT',
          amount:        dto.initialDepositGHS,
          balanceAfter:  dto.initialDepositGHS,
          description:   'Account opening deposit',
          reference:     `OPEN-${accountNumber}`,
          channel:       'BRANCH',
          performedBy:   openedByUserId,
          status:        'COMPLETED',
        },
      });
    }

    await this.auditLog.log({
      action:       'SAVINGS_ACCOUNT_OPENED',
      resourceId:   account.id,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       openedByUserId,
      details: {
        accountNumber,
        customerId:        dto.customerId,
        productType:       dto.productType,
        initialDeposit:    dto.initialDepositGHS ?? 0,
      },
    });

    this.logger.log(`Savings account ${accountNumber} opened for customer ${dto.customerId}`);
    return { accountId: account.id, accountNumber };
  }

  // ─── Deposit ─────────────────────────────────────────────────────────────────

  async deposit(dto: DepositDto, processedByUserId: string): Promise<{ newBalance: number }> {
    const account = await this.getAccountOrThrow(dto.accountId);

    if (account.status !== SavingsAccountStatus.ACTIVE) {
      throw new BadRequestException(`Cannot deposit to account with status ${account.status}`);
    }

    if (dto.amountGHS <= 0) {
      throw new BadRequestException('Deposit amount must be positive');
    }

    const newBalance = this.round2((account.ledgerBalance as number) + dto.amountGHS);

    await this.prisma.savingsAccount.update({
      where: { id: dto.accountId },
      data: {
        ledgerBalance:    newBalance,
        availableBalance: newBalance,
        updatedAt:        new Date(),
      },
    });

    await this.prisma.transaction.create({
      data: {
        accountId:     dto.accountId,
        customerId:    account.customerId as string,
        type:          'DEPOSIT',
        amount:        dto.amountGHS,
        balanceAfter:  newBalance,
        description:   dto.notes ?? 'Customer deposit',
        reference:     dto.transactionRef,
        channel:       dto.channel,
        performedBy:   processedByUserId,
        status:        'COMPLETED',
      },
    });

    await this.auditLog.log({
      action:       'SAVINGS_DEPOSIT',
      resourceId:   dto.accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       processedByUserId,
      details: {
        accountNumber:  account.accountNumber,
        amountGHS:      dto.amountGHS,
        channel:        dto.channel,
        transactionRef: dto.transactionRef,
        newBalance,
      },
    });

    // Reset dormancy if previously dormant
    if (account.dormantSince) {
      await this.prisma.savingsAccount.update({
        where: { id: dto.accountId },
        data: { dormantSince: null, status: SavingsAccountStatus.ACTIVE },
      });
    }

    this.logger.debug(`Deposit GHS ${dto.amountGHS} to account ${account.accountNumber}. Balance: ${newBalance}`);
    return { newBalance };
  }

  // ─── Withdrawal ───────────────────────────────────────────────────────────────

  async withdraw(
    dto: WithdrawalDto,
    processedByUserId: string,
  ): Promise<WithdrawalResult> {
    const account = await this.getAccountOrThrow(dto.accountId);

    if (account.status === SavingsAccountStatus.FROZEN) {
      throw new ForbiddenException('Account is frozen. Withdrawal not permitted.');
    }

    if (account.status === SavingsAccountStatus.CLOSED) {
      throw new ForbiddenException('Account is closed');
    }

    if (dto.amountGHS <= 0) {
      throw new BadRequestException('Withdrawal amount must be positive');
    }

    // Evaluate withdrawal rules
    const ruleCheck = await this.withdrawalRuleEngine.evaluateWithdrawal(
      account as Record<string, unknown>,
      dto.amountGHS,
      new Date(),
    );

    if (!ruleCheck.allowed && !dto.waivePenalty) {
      throw new UnprocessableEntityException(
        `Withdrawal not permitted: ${ruleCheck.violations.join('; ')}`,
      );
    }

    const penaltyAmount = dto.waivePenalty ? 0 : (ruleCheck.penaltyAmount ?? 0);
    const totalDeduction = this.round2(dto.amountGHS + penaltyAmount);

    if (totalDeduction > (account.availableBalance as number)) {
      throw new BadRequestException(
        `Insufficient available balance. Required: GHS ${totalDeduction}, Available: GHS ${account.availableBalance}`,
      );
    }

    const newLedger    = this.round2((account.ledgerBalance    as number) - totalDeduction);
    const newAvailable = this.round2((account.availableBalance as number) - totalDeduction);
    const transRef     = dto.transactionRef ?? `WD-${account.accountNumber}-${Date.now()}`;

    await this.prisma.savingsAccount.update({
      where: { id: dto.accountId },
      data: {
        ledgerBalance:    newLedger,
        availableBalance: newAvailable,
        updatedAt:        new Date(),
      },
    });

    await this.prisma.transaction.create({
      data: {
        accountId:     dto.accountId,
        customerId:    account.customerId as string,
        type:          'WITHDRAWAL',
        amount:        dto.amountGHS,
        balanceAfter:  newLedger,
        description:   dto.purpose,
        reference:     transRef,
        channel:       dto.channel,
        performedBy:   processedByUserId,
        approvedBy:    dto.approvedBy ?? null,
        penaltyAmount,
        status:        'COMPLETED',
      },
    });

    if (penaltyAmount > 0) {
      // Record penalty transaction
      await this.prisma.transaction.create({
        data: {
          accountId:     dto.accountId,
          customerId:    account.customerId as string,
          type:          'FEE',
          amount:        penaltyAmount,
          balanceAfter:  newLedger,
          description:   `Early withdrawal penalty — ${ruleCheck.penaltyReason ?? 'rule violation'}`,
          reference:     `PEN-${transRef}`,
          channel:       'SYSTEM',
          performedBy:   processedByUserId,
          status:        'COMPLETED',
        },
      });
    }

    await this.auditLog.log({
      action:       'SAVINGS_WITHDRAWAL',
      resourceId:   dto.accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       processedByUserId,
      details: {
        accountNumber:  account.accountNumber,
        amountGHS:      dto.amountGHS,
        penaltyAmount,
        channel:        dto.channel,
        transactionRef: transRef,
        newBalance:     newLedger,
        ruleViolations: ruleCheck.violations,
      },
    });

    this.logger.log(
      `Withdrawal GHS ${dto.amountGHS} from ${account.accountNumber}. ` +
      `Penalty: GHS ${penaltyAmount}. Balance: GHS ${newLedger}`,
    );

    return {
      success:         true,
      amountWithdrawn: dto.amountGHS,
      penaltyAmount,
      newBalance:      newLedger,
      transactionRef:  transRef,
      message:         penaltyAmount > 0
        ? `Withdrawal successful. Early withdrawal penalty of GHS ${penaltyAmount} applied.`
        : 'Withdrawal successful.',
    };
  }

  // ─── Post Interest ────────────────────────────────────────────────────────────

  async postInterest(accountId: string, systemUserId: string): Promise<{ interestPostedGHS: number }> {
    const account = await this.getAccountOrThrow(accountId);

    if (account.status !== SavingsAccountStatus.ACTIVE) {
      return { interestPostedGHS: 0 };
    }

    const annualRate  = account.annualInterestRate as number;
    const balance     = account.ledgerBalance as number;
    const accrued     = account.accruedInterestGHS as number;

    if (accrued <= 0 && balance <= 0) return { interestPostedGHS: 0 };

    // Monthly interest posting: I = P × r × (1/12)
    const monthlyInterest = this.round2(balance * (annualRate / 100) / 12);
    const totalToPost     = this.round2(accrued + monthlyInterest);

    if (totalToPost <= 0) return { interestPostedGHS: 0 };

    const newBalance = this.round2(balance + totalToPost);

    await this.prisma.savingsAccount.update({
      where: { id: accountId },
      data: {
        ledgerBalance:           newBalance,
        availableBalance:        newBalance,
        accruedInterestGHS:      0,
        lastInterestPostedAt:    new Date(),
        nextInterestPostingDate: this.nextMonthStart(),
        updatedAt:               new Date(),
      },
    });

    await this.prisma.transaction.create({
      data: {
        accountId,
        customerId:    account.customerId as string,
        type:          'INTEREST',
        amount:        totalToPost,
        balanceAfter:  newBalance,
        description:   `Monthly interest posting — ${annualRate}% p.a.`,
        reference:     `INT-${account.accountNumber}-${new Date().toISOString().substring(0, 7)}`,
        channel:       'SYSTEM',
        performedBy:   systemUserId,
        status:        'COMPLETED',
      },
    });

    await this.auditLog.log({
      action:       'SAVINGS_INTEREST_POSTED',
      resourceId:   accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       systemUserId,
      details: {
        accountNumber:  account.accountNumber,
        annualRate,
        balance,
        interestPosted: totalToPost,
        newBalance,
      },
    });

    this.logger.debug(
      `Interest GHS ${totalToPost} posted to ${account.accountNumber}. Balance: GHS ${newBalance}`,
    );

    return { interestPostedGHS: totalToPost };
  }

  // ─── Generate Statement ───────────────────────────────────────────────────────

  async generateStatement(
    accountId: string,
    fromDate: Date,
    toDate: Date,
    requestedByUserId: string,
  ): Promise<SavingsStatement> {
    const account = await this.getAccountOrThrow(accountId);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        accountId,
        createdAt: { gte: fromDate, lte: toDate },
        status:    'COMPLETED',
      },
      orderBy: { createdAt: 'asc' },
    });

    const opening = await this.prisma.transaction.aggregate({
      where: {
        accountId,
        createdAt: { lt: fromDate },
        status:    'COMPLETED',
      },
      _sum: {
        amount: true,
      },
    });

    const openingBalance = this.round2((opening._sum.amount as number) ?? 0);

    let totalDeposits    = 0;
    let totalWithdrawals = 0;
    let totalInterest    = 0;
    let totalDividends   = 0;

    const statementTxns: StatementTransaction[] = [];

    for (const tx of transactions) {
      const type    = tx.type as string;
      const amount  = tx.amount as number;

      switch (type) {
        case 'DEPOSIT':    totalDeposits    += amount; break;
        case 'WITHDRAWAL': totalWithdrawals += amount; break;
        case 'INTEREST':   totalInterest    += amount; break;
        case 'DIVIDEND':   totalDividends   += amount; break;
      }

      statementTxns.push({
        date:         tx.createdAt as Date,
        type:         type as StatementTransaction['type'],
        description:  tx.description as string,
        debitAmount:  ['WITHDRAWAL', 'FEE'].includes(type) ? amount : undefined,
        creditAmount: ['DEPOSIT', 'INTEREST', 'DIVIDEND'].includes(type) ? amount : undefined,
        balance:      tx.balanceAfter as number,
        reference:    tx.reference as string,
        channel:      tx.channel as string ?? undefined,
      });
    }

    await this.auditLog.log({
      action:       'SAVINGS_STATEMENT_GENERATED',
      resourceId:   accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       requestedByUserId,
      details: {
        accountNumber: account.accountNumber,
        fromDate,
        toDate,
        transactionCount: transactions.length,
      },
    });

    return {
      accountId,
      accountNumber:   account.accountNumber as string,
      fromDate,
      toDate,
      openingBalance,
      closingBalance:  account.ledgerBalance as number,
      totalDeposits:   this.round2(totalDeposits),
      totalWithdrawals: this.round2(totalWithdrawals),
      totalInterest:   this.round2(totalInterest),
      totalDividends:  this.round2(totalDividends),
      transactions:    statementTxns,
    };
  }

  // ─── Freeze / Unfreeze Account ────────────────────────────────────────────────

  async freezeAccount(accountId: string, reason: string, officerUserId: string): Promise<void> {
    const account = await this.getAccountOrThrow(accountId);
    if (account.status === SavingsAccountStatus.FROZEN) return;

    await this.prisma.savingsAccount.update({
      where: { id: accountId },
      data: { status: SavingsAccountStatus.FROZEN, updatedAt: new Date() },
    });

    await this.auditLog.log({
      action:       'SAVINGS_ACCOUNT_FROZEN',
      resourceId:   accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       officerUserId,
      details:      { accountNumber: account.accountNumber, reason },
      severity:     'HIGH',
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async getAccountOrThrow(accountId: string): Promise<Record<string, unknown>> {
    const account = await this.prisma.savingsAccount.findUnique({
      where: { id: accountId, deletedAt: null },
    });
    if (!account) throw new NotFoundException(`Savings account ${accountId} not found`);
    return account as Record<string, unknown>;
  }

  private async generateAccountNumber(): Promise<string> {
    const count = await this.prisma.savingsAccount.count();
    return `SAV${String(count + 1).padStart(9, '0')}`;
  }

  private nextMonthStart(): Date {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

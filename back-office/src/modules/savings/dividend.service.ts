import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';
import { SavingsProductType } from './savings.entity';

export interface DividendDeclarationDto {
  productType:    SavingsProductType;    // Must be COOPERATIVE_SHARES or GROUP_SAVINGS
  periodStart:    Date;
  periodEnd:      Date;
  totalProfitGHS: number;               // Net profit available for distribution
  dividendRatePercent: number;          // e.g., 12 for 12% on share value
  declaredBy:     string;               // Officer user ID
  approvedBy:     string;               // Senior officer / board approval
  notes?:         string;
}

export interface DividendPostingResult {
  declarationId:    string;
  totalAccounts:    number;
  totalDividendGHS: number;
  successCount:     number;
  failureCount:     number;
  failures:         Array<{ accountId: string; reason: string }>;
}

export interface DividendStatement {
  declarationId:    string;
  periodStart:      Date;
  periodEnd:        Date;
  dividendRatePercent: number;
  accountId:        string;
  accountNumber:    string;
  customerId:       string;
  shareValue:       number;
  dividendAmount:   number;    // GHS
  paidAt?:          Date;
  status:           string;
}

@Injectable()
export class DividendService {
  private readonly logger = new Logger(DividendService.name);

  // Products eligible for dividends
  private readonly DIVIDEND_ELIGIBLE_PRODUCTS = [
    SavingsProductType.COOPERATIVE_SHARES,
    SavingsProductType.GROUP_SAVINGS,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Declare Dividend ─────────────────────────────────────────────────────────

  async declareDividend(
    dto: DividendDeclarationDto,
    initiatorUserId: string,
  ): Promise<{ declarationId: string; estimatedTotalGHS: number }> {
    if (!this.DIVIDEND_ELIGIBLE_PRODUCTS.includes(dto.productType)) {
      throw new BadRequestException(
        `Product type ${dto.productType} is not eligible for dividends. ` +
        `Only COOPERATIVE_SHARES and GROUP_SAVINGS products are dividend-eligible.`,
      );
    }

    if (dto.periodEnd <= dto.periodStart) {
      throw new BadRequestException('Dividend period end must be after period start');
    }

    if (dto.dividendRatePercent <= 0 || dto.dividendRatePercent > 100) {
      throw new BadRequestException('Dividend rate must be between 0% and 100%');
    }

    if (dto.totalProfitGHS <= 0) {
      throw new BadRequestException('Total profit available for distribution must be positive');
    }

    // Check for duplicate declaration for the same period
    const existing = await this.prisma.dividendDeclaration.findFirst({
      where: {
        productType:  dto.productType,
        periodStart:  dto.periodStart,
        periodEnd:    dto.periodEnd,
        status:       { not: 'CANCELLED' },
      },
    });

    if (existing) {
      throw new BadRequestException(
        `A dividend has already been declared for ${dto.productType} for the period ` +
        `${dto.periodStart.toISOString()} – ${dto.periodEnd.toISOString()}`,
      );
    }

    // Calculate estimated total dividend
    const eligibleAccounts = await this.prisma.savingsAccount.findMany({
      where: {
        productType:       dto.productType,
        status:            'ACTIVE',
        isDividendEligible: true,
        deletedAt:         null,
      },
      select: {
        id:            true,
        accountNumber: true,
        customerId:    true,
        ledgerBalance: true,
        shareCount:    true,
        shareValue:    true,
      },
    });

    if (eligibleAccounts.length === 0) {
      throw new UnprocessableEntityException(
        `No active ${dto.productType} accounts found for dividend distribution`,
      );
    }

    let estimatedTotal = 0;
    for (const acct of eligibleAccounts) {
      const shareVal    = (acct.shareValue as number) ?? (acct.ledgerBalance as number);
      const dividendAmt = this.round2(shareVal * (dto.dividendRatePercent / 100));
      estimatedTotal   += dividendAmt;
    }

    // Check estimated total doesn't exceed available profit
    if (estimatedTotal > dto.totalProfitGHS) {
      this.logger.warn(
        `Dividend estimate GHS ${estimatedTotal} exceeds available profit GHS ${dto.totalProfitGHS}. ` +
        `Consider reducing the dividend rate.`,
      );
    }

    const declaration = await this.prisma.dividendDeclaration.create({
      data: {
        productType:          dto.productType,
        periodStart:          dto.periodStart,
        periodEnd:            dto.periodEnd,
        totalProfitGHS:       dto.totalProfitGHS,
        dividendRatePercent:  dto.dividendRatePercent,
        estimatedTotalGHS:    this.round2(estimatedTotal),
        eligibleAccountCount: eligibleAccounts.length,
        declaredBy:           dto.declaredBy,
        approvedBy:           dto.approvedBy,
        status:               'DECLARED',
        declaredAt:           new Date(),
        notes:                dto.notes ?? null,
      },
    });

    await this.auditLog.log({
      action:       'DIVIDEND_DECLARED',
      resourceId:   declaration.id,
      resourceType: 'DIVIDEND',
      userId:       initiatorUserId,
      details: {
        productType:          dto.productType,
        dividendRatePercent:  dto.dividendRatePercent,
        estimatedTotalGHS:    this.round2(estimatedTotal),
        eligibleAccounts:     eligibleAccounts.length,
        period:               `${dto.periodStart.toISOString()} – ${dto.periodEnd.toISOString()}`,
      },
      severity: 'MEDIUM',
    });

    this.logger.log(
      `Dividend declared: ${declaration.id} at ${dto.dividendRatePercent}% for ${dto.productType}. ` +
      `Estimated total: GHS ${estimatedTotal.toFixed(2)}`,
    );

    return {
      declarationId:    declaration.id,
      estimatedTotalGHS: this.round2(estimatedTotal),
    };
  }

  // ─── Post Dividend to Accounts ────────────────────────────────────────────────

  async postDividend(
    declarationId: string,
    postedByUserId: string,
  ): Promise<DividendPostingResult> {
    const declaration = await this.prisma.dividendDeclaration.findUnique({
      where: { id: declarationId },
    });

    if (!declaration) {
      throw new NotFoundException(`Dividend declaration ${declarationId} not found`);
    }

    if (declaration.status !== 'DECLARED') {
      throw new BadRequestException(
        `Dividend cannot be posted in status ${declaration.status}. Must be DECLARED.`,
      );
    }

    const eligibleAccounts = await this.prisma.savingsAccount.findMany({
      where: {
        productType:        declaration.productType as string,
        status:             'ACTIVE',
        isDividendEligible: true,
        deletedAt:          null,
      },
    });

    let totalPosted  = 0;
    let successCount = 0;
    let failureCount = 0;
    const failures: Array<{ accountId: string; reason: string }> = [];

    // Post dividends in a batch with individual error handling
    for (const account of eligibleAccounts) {
      try {
        const shareVal     = (account.shareValue as number) ?? (account.ledgerBalance as number);
        const dividendAmt  = this.round2(shareVal * ((declaration.dividendRatePercent as number) / 100));

        if (dividendAmt <= 0) continue;

        const newBalance   = this.round2((account.ledgerBalance as number) + dividendAmt);
        const postingDate  = new Date();

        await this.prisma.savingsAccount.update({
          where: { id: account.id as string },
          data: {
            ledgerBalance:        newBalance,
            availableBalance:     newBalance,
            totalDividendsPaidGHS: this.round2((account.totalDividendsPaidGHS as number) + dividendAmt),
            updatedAt:            postingDate,
          },
        });

        await this.prisma.transaction.create({
          data: {
            accountId:    account.id as string,
            customerId:   account.customerId as string,
            type:         'DIVIDEND',
            amount:       dividendAmt,
            balanceAfter: newBalance,
            description:  `Dividend posting — ${declaration.dividendRatePercent}% for period ${(declaration.periodStart as Date).toISOString().substring(0, 10)} to ${(declaration.periodEnd as Date).toISOString().substring(0, 10)}`,
            reference:    `DIV-${declarationId}-${account.accountNumber}`,
            channel:      'SYSTEM',
            performedBy:  postedByUserId,
            status:       'COMPLETED',
          },
        });

        await this.prisma.dividendRecord.create({
          data: {
            declarationId,
            accountId:      account.id as string,
            customerId:     account.customerId as string,
            shareValue:     shareVal,
            dividendAmount: dividendAmt,
            paidAt:         postingDate,
            status:         'PAID',
          },
        });

        totalPosted  += dividendAmt;
        successCount++;
      } catch (error) {
        const errMsg = (error instanceof Error) ? error.message : String(error);
        failures.push({ accountId: account.id as string, reason: errMsg });
        failureCount++;
        this.logger.error(`Dividend posting failed for account ${account.id}: ${errMsg}`);
      }
    }

    const finalStatus = failureCount === 0 ? 'PAID' : (successCount === 0 ? 'FAILED' : 'PARTIAL');

    await this.prisma.dividendDeclaration.update({
      where: { id: declarationId },
      data: {
        status:          finalStatus,
        actualTotalGHS:  this.round2(totalPosted),
        postedAt:        new Date(),
        postedBy:        postedByUserId,
        successCount,
        failureCount,
      },
    });

    await this.auditLog.log({
      action:       'DIVIDEND_POSTED',
      resourceId:   declarationId,
      resourceType: 'DIVIDEND',
      userId:       postedByUserId,
      details: {
        totalPostedGHS: this.round2(totalPosted),
        successCount,
        failureCount,
        status:         finalStatus,
      },
      severity: 'MEDIUM',
    });

    this.logger.log(
      `Dividend posted: ${declarationId}. Total: GHS ${totalPosted.toFixed(2)}. ` +
      `Success: ${successCount}, Failures: ${failureCount}`,
    );

    return {
      declarationId,
      totalAccounts:    eligibleAccounts.length,
      totalDividendGHS: this.round2(totalPosted),
      successCount,
      failureCount,
      failures,
    };
  }

  // ─── Get Dividend Statement for Account ───────────────────────────────────────

  async getDividendStatement(
    accountId: string,
    requestedByUserId: string,
  ): Promise<DividendStatement[]> {
    const account = await this.prisma.savingsAccount.findUnique({
      where: { id: accountId, deletedAt: null },
    });

    if (!account) throw new NotFoundException(`Savings account ${accountId} not found`);

    const records = await this.prisma.dividendRecord.findMany({
      where: { accountId },
      include: { declaration: true },
      orderBy: { paidAt: 'desc' },
    });

    await this.auditLog.log({
      action:       'DIVIDEND_STATEMENT_ACCESSED',
      resourceId:   accountId,
      resourceType: 'SAVINGS_ACCOUNT',
      userId:       requestedByUserId,
      details:      { accountNumber: account.accountNumber, recordCount: records.length },
    });

    return records.map((r) => ({
      declarationId:       r.declarationId as string,
      periodStart:         (r.declaration as { periodStart: Date }).periodStart,
      periodEnd:           (r.declaration as { periodEnd: Date }).periodEnd,
      dividendRatePercent: (r.declaration as { dividendRatePercent: number }).dividendRatePercent,
      accountId:           r.accountId as string,
      accountNumber:       account.accountNumber as string,
      customerId:          r.customerId as string,
      shareValue:          r.shareValue as number,
      dividendAmount:      r.dividendAmount as number,
      paidAt:              r.paidAt as Date ?? undefined,
      status:              r.status as string,
    }));
  }

  // ─── Cancel Dividend Declaration ─────────────────────────────────────────────

  async cancelDividend(
    declarationId: string,
    reason: string,
    officerUserId: string,
  ): Promise<void> {
    const declaration = await this.prisma.dividendDeclaration.findUnique({
      where: { id: declarationId },
    });

    if (!declaration) throw new NotFoundException(`Declaration ${declarationId} not found`);
    if (declaration.status === 'PAID') {
      throw new BadRequestException('Cannot cancel a dividend that has already been paid. Initiate reversal instead.');
    }

    await this.prisma.dividendDeclaration.update({
      where: { id: declarationId },
      data: { status: 'CANCELLED', cancelledBy: officerUserId, cancelledAt: new Date(), cancelReason: reason },
    });

    await this.auditLog.log({
      action:       'DIVIDEND_CANCELLED',
      resourceId:   declarationId,
      resourceType: 'DIVIDEND',
      userId:       officerUserId,
      details:      { reason },
      severity:     'HIGH',
    });

    this.logger.warn(`Dividend ${declarationId} cancelled by ${officerUserId}. Reason: ${reason}`);
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

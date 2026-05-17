import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';
import { InterestCalculatorService } from './interest-calculator.service';
import { LoanStatus, DisbursementChannel, RepaymentFrequency, LoanType } from './loan.entity';
import axios from 'axios';

export interface CreateLoanDto {
  customerId:           string;
  productId:            string;
  type:                 LoanType;
  principalAmountGHS:   number;
  annualInterestRate:   number;
  termMonths:           number;
  repaymentFrequency:   RepaymentFrequency;
  disbursementChannel:  DisbursementChannel;
  disbursementAccount:  string;  // Mobile money / bank account
  purpose:              string;
  isSecured:            boolean;
  branchCode:           string;
  officerUserId:        string;
  processingFeeGHS?:    number;
  insurancePremiumGHS?: number;
}

export interface RecordRepaymentDto {
  loanId:          string;
  amountPaidGHS:   number;
  paymentDate:     Date;
  channel:         string;
  transactionRef:  string;
  receivedBy:      string;
  notes?:          string;
}

export interface CollectionActionDto {
  loanId:      string;
  actionType:  'REMINDER_CALL' | 'SMS_REMINDER' | 'FIELD_VISIT' | 'LEGAL_NOTICE' | 'WRITTEN_OFF';
  notes:       string;
  officerId:   string;
  nextActionDate?: Date;
}

@Injectable()
export class LoanService {
  private readonly logger = new Logger(LoanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly interestCalc: InterestCalculatorService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Originate Loan ──────────────────────────────────────────────────────────

  async originateLoan(
    dto: CreateLoanDto,
    initiatorUserId: string,
  ): Promise<{ loanId: string; loanNumber: string }> {
    // Validate customer
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId, deletedAt: null },
    });

    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (customer.status !== 'ACTIVE') {
      throw new BadRequestException(`Customer must be ACTIVE to apply for a loan. Current status: ${customer.status}`);
    }
    if (customer.kycStatus !== 'COMPLETED') {
      throw new BadRequestException('Customer KYC must be COMPLETED before loan origination');
    }
    if (customer.isSanctioned) {
      throw new ForbiddenException('Cannot originate loan for sanctioned customer');
    }
    if (customer.isBlacklisted) {
      throw new ForbiddenException('Cannot originate loan for blacklisted customer');
    }

    // Validate product
    const product = await this.prisma.loanProduct.findUnique({
      where: { id: dto.productId, isActive: true },
    });
    if (!product) throw new NotFoundException(`Loan product ${dto.productId} not found or inactive`);

    // Validate regulatory limits
    const maxLoan = this.configService.get<number>('ghana.regulatoryLimits.maxLoanAmountGHS', 500000);
    const minLoan = this.configService.get<number>('ghana.regulatoryLimits.minLoanAmountGHS', 100);
    const maxRate = this.configService.get<number>('ghana.regulatoryLimits.maxInterestRateAnnualPercent', 36);

    if (dto.principalAmountGHS < minLoan || dto.principalAmountGHS > maxLoan) {
      throw new BadRequestException(`Loan amount must be between GHS ${minLoan} and GHS ${maxLoan}`);
    }
    if (dto.annualInterestRate > maxRate) {
      throw new BadRequestException(
        `Interest rate ${dto.annualInterestRate}% exceeds BoG maximum of ${maxRate}% per Digital Credit Directive 2025`,
      );
    }

    // Calculate simple interest schedule
    const interestResult = this.interestCalc.calculateSimpleInterest(
      dto.principalAmountGHS,
      dto.annualInterestRate,
      dto.termMonths,
      false, // isCompounding = false — REQUIRED
    );

    const aprResult = this.interestCalc.calculateAPR(
      dto.principalAmountGHS,
      dto.annualInterestRate,
      dto.termMonths,
      dto.processingFeeGHS  ?? 0,
      dto.insurancePremiumGHS ?? 0,
      0,
    );

    const startDate = new Date();
    const schedule  = this.interestCalc.generateRepaymentSchedule(
      dto.principalAmountGHS,
      dto.annualInterestRate,
      dto.termMonths,
      startDate,
      dto.repaymentFrequency,
    );

    const loanNumber = await this.generateLoanNumber();

    const loan = await this.prisma.loan.create({
      data: {
        loanNumber,
        customerId:            dto.customerId,
        productId:             dto.productId,
        type:                  dto.type,
        status:                LoanStatus.PENDING_APPROVAL,
        principalAmountGHS:    dto.principalAmountGHS,
        approvedAmountGHS:     dto.principalAmountGHS,
        disbursedAmountGHS:    0,
        outstandingPrincipal:  dto.principalAmountGHS,
        interestType:          'SIMPLE',
        annualInterestRate:    dto.annualInterestRate,
        monthlyInterestRate:   interestResult.monthlyInterestRate,
        totalInterestGHS:      interestResult.totalInterest,
        totalRepayableGHS:     interestResult.totalRepayable,
        termMonths:            dto.termMonths,
        repaymentFrequency:    dto.repaymentFrequency,
        disbursementChannel:   dto.disbursementChannel,
        disbursementAccount:   dto.disbursementAccount,
        purpose:               dto.purpose,
        isSecured:             dto.isSecured,
        branchCode:            dto.branchCode,
        officerUserId:         initiatorUserId,
        processingFeeGHS:      dto.processingFeeGHS  ?? 0,
        insurancePremiumGHS:   dto.insurancePremiumGHS ?? 0,
        otherFeesGHS:          0,
        apr:                   aprResult.aprPercent,
        totalPaidGHS:          0,
        totalPrincipalPaidGHS: 0,
        totalInterestPaidGHS:  0,
        totalPenaltiesPaidGHS: 0,
        daysPassedDue:         0,
        npaClassification:     'PERFORMING',
        provisionAmount:       0,
        isRestructured:        false,
        restructuringCount:    0,
        collateralValueGHS:    0,
        ltv:                   0,
        isBlacklisted:         false,
        tags:                  [],
        repaymentSchedule: {
          create: schedule.installments.map((s) => ({
            installmentNumber:  s.installmentNumber,
            dueDate:            s.dueDate,
            principalComponent: s.principalComponent,
            interestComponent:  s.interestComponent,
            totalInstallment:   s.totalInstallment,
            balanceAfter:       s.balanceAfter,
            status:             'PENDING',
          })),
        },
      },
    });

    await this.auditLog.log({
      action:       'LOAN_ORIGINATED',
      resourceId:   loan.id,
      resourceType: 'LOAN',
      userId:       initiatorUserId,
      details: {
        loanNumber,
        customerId:          dto.customerId,
        principalAmountGHS:  dto.principalAmountGHS,
        annualInterestRate:  dto.annualInterestRate,
        interestType:        'SIMPLE',
        termMonths:          dto.termMonths,
        totalInterestGHS:    interestResult.totalInterest,
        apr:                 aprResult.aprPercent,
      },
    });

    this.logger.log(`Loan originated: ${loanNumber} (${loan.id}) for customer ${dto.customerId}`);
    return { loanId: loan.id, loanNumber };
  }

  // ─── Approve Loan ─────────────────────────────────────────────────────────────

  async approveLoan(
    loanId: string,
    approvedAmountGHS: number,
    approverUserId: string,
    notes?: string,
  ): Promise<void> {
    const loan = await this.getLoanOrThrow(loanId);

    if (loan.status !== LoanStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Loan cannot be approved from status ${loan.status}`);
    }

    if (approvedAmountGHS > (loan.principalAmountGHS as number)) {
      throw new BadRequestException('Approved amount cannot exceed requested amount');
    }

    await this.prisma.loan.update({
      where: { id: loanId },
      data: {
        status:           LoanStatus.APPROVED,
        approvedAmountGHS,
        approvedBy:       approverUserId,
        approvedAt:       new Date(),
        notes:            notes ?? null,
        updatedAt:        new Date(),
      },
    });

    await this.auditLog.log({
      action:       'LOAN_APPROVED',
      resourceId:   loanId,
      resourceType: 'LOAN',
      userId:       approverUserId,
      details: {
        loanNumber:        loan.loanNumber,
        approvedAmountGHS,
        notes,
      },
    });

    this.logger.log(`Loan ${loan.loanNumber} approved by ${approverUserId}`);
  }

  // ─── Disburse via GhIPSS ─────────────────────────────────────────────────────

  async disburseLoan(
    loanId: string,
    disbursedByUserId: string,
  ): Promise<{ transactionRef: string }> {
    const loan = await this.getLoanOrThrow(loanId);

    if (loan.status !== LoanStatus.APPROVED) {
      throw new BadRequestException(`Loan must be APPROVED before disbursement. Current: ${loan.status}`);
    }

    const ghipssBaseUrl  = this.configService.get<string>('ghana.ghipss.baseUrl');
    const ghipssEndpoint = this.configService.get<string>('ghana.ghipss.interbank');

    let transactionRef: string;
    let disbursementStatus: string;

    try {
      // Determine disbursement channel
      if (loan.disbursementChannel === DisbursementChannel.GHIPSS ||
          loan.disbursementChannel === DisbursementChannel.BANK_TRANSFER) {
        const response = await axios.post(
          `${ghipssBaseUrl}${ghipssEndpoint}`,
          {
            amount:          loan.approvedAmountGHS,
            currency:        'GHS',
            recipientAccount: loan.disbursementAccount,
            reference:       `LOAN-${loan.loanNumber}`,
            narration:       `Loan disbursement — ${loan.loanNumber}`,
            institutionCode: this.configService.get<string>('ghana.bog.institutionLicenseNumber'),
          },
          {
            timeout: this.configService.get<number>('ghana.ghipss.timeout', 30000),
            headers: { 'X-API-Key': process.env.GHIPSS_API_KEY },
          },
        );

        transactionRef     = response.data.transactionReference ?? `GHIPSS-${Date.now()}`;
        disbursementStatus = 'COMPLETED';
      } else {
        // Mobile money or other channel — mock for now
        transactionRef     = `MOMO-${loan.loanNumber}-${Date.now()}`;
        disbursementStatus = 'COMPLETED';
      }
    } catch (error) {
      const errMsg = (error instanceof Error) ? error.message : String(error);
      this.logger.error(`Disbursement failed for loan ${loan.loanNumber}: ${errMsg}`);

      await this.prisma.disbursementRecord.create({
        data: {
          loanId,
          disbursedAt:       new Date(),
          amount:            loan.approvedAmountGHS as number,
          channel:           loan.disbursementChannel as string,
          recipientAccount:  loan.disbursementAccount as string,
          transactionRef:    `FAILED-${Date.now()}`,
          status:            'FAILED',
          failureReason:     errMsg,
        },
      });

      throw new UnprocessableEntityException(`Disbursement failed: ${errMsg}`);
    }

    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + (loan.termMonths as number));

    await this.prisma.loan.update({
      where: { id: loanId },
      data: {
        status:               LoanStatus.ACTIVE,
        disbursedAmountGHS:   loan.approvedAmountGHS,
        outstandingPrincipal: loan.approvedAmountGHS,
        disbursedAt:          new Date(),
        maturityDate,
        updatedAt:            new Date(),
      },
    });

    await this.prisma.disbursementRecord.create({
      data: {
        loanId,
        disbursedAt:      new Date(),
        amount:           loan.approvedAmountGHS as number,
        channel:          loan.disbursementChannel as string,
        recipientAccount: loan.disbursementAccount as string,
        transactionRef,
        status:           disbursementStatus,
        confirmedAt:      new Date(),
      },
    });

    await this.auditLog.log({
      action:       'LOAN_DISBURSED',
      resourceId:   loanId,
      resourceType: 'LOAN',
      userId:       disbursedByUserId,
      details: {
        loanNumber:     loan.loanNumber,
        amount:         loan.approvedAmountGHS,
        channel:        loan.disbursementChannel,
        transactionRef,
      },
    });

    this.logger.log(`Loan ${loan.loanNumber} disbursed. Ref: ${transactionRef}`);
    return { transactionRef };
  }

  // ─── Record Repayment ────────────────────────────────────────────────────────

  async recordRepayment(
    dto: RecordRepaymentDto,
    recordedByUserId: string,
  ): Promise<{ installmentsPaid: number; outstandingBalance: number }> {
    const loan = await this.getLoanOrThrow(dto.loanId);

    if (!['ACTIVE', 'WATCHLIST', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS', 'RESTRUCTURED'].includes(loan.status as string)) {
      throw new BadRequestException(`Cannot record repayment for loan with status ${loan.status}`);
    }

    if (dto.amountPaidGHS <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    // Get pending installments ordered by due date
    const pendingInstallments = await this.prisma.loanRepaymentSchedule.findMany({
      where: {
        loanId: dto.loanId,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
      },
      orderBy: { dueDate: 'asc' },
    });

    if (pendingInstallments.length === 0) {
      throw new BadRequestException('No pending installments found. Loan may already be fully repaid.');
    }

    let remainingPayment = dto.amountPaidGHS;
    let installmentsPaid = 0;
    let principalPaid    = 0;
    let interestPaid     = 0;

    for (const installment of pendingInstallments) {
      if (remainingPayment <= 0) break;

      const outstanding = (installment.totalInstallment as number) - ((installment.paidAmount as number) ?? 0);
      const paymentForThis = Math.min(remainingPayment, outstanding);
      const newPaidAmount  = ((installment.paidAmount as number) ?? 0) + paymentForThis;

      const newStatus = newPaidAmount >= (installment.totalInstallment as number)
        ? 'PAID' : 'PARTIAL';

      await this.prisma.loanRepaymentSchedule.update({
        where: { id: installment.id },
        data: {
          paidAmount: newPaidAmount,
          paidAt:     newStatus === 'PAID' ? dto.paymentDate : null,
          status:     newStatus,
        },
      });

      // Allocate: interest first, then principal
      const interestShare  = (installment.interestComponent as number) / (installment.totalInstallment as number);
      interestPaid  += paymentForThis * interestShare;
      principalPaid += paymentForThis * (1 - interestShare);

      remainingPayment -= paymentForThis;
      if (newStatus === 'PAID') installmentsPaid++;
    }

    // Update loan totals
    const newPrincipalPaid = (loan.totalPrincipalPaidGHS as number) + principalPaid;
    const newInterestPaid  = (loan.totalInterestPaidGHS  as number) + interestPaid;
    const newTotalPaid     = (loan.totalPaidGHS          as number) + dto.amountPaidGHS;
    const newOutstanding   = Math.max(0, (loan.outstandingPrincipal as number) - principalPaid);

    const isFullyRepaid = newOutstanding <= 0.01; // Tolerance for rounding

    await this.prisma.loan.update({
      where: { id: dto.loanId },
      data: {
        totalPaidGHS:          this.round2(newTotalPaid),
        totalPrincipalPaidGHS: this.round2(newPrincipalPaid),
        totalInterestPaidGHS:  this.round2(newInterestPaid),
        outstandingPrincipal:  this.round2(newOutstanding),
        lastPaymentDate:       dto.paymentDate,
        lastPaymentAmount:     dto.amountPaidGHS,
        status:                isFullyRepaid ? LoanStatus.CLOSED : loan.status,
        closedAt:              isFullyRepaid ? dto.paymentDate : null,
        daysPassedDue:         0, // Reset on payment
        updatedAt:             new Date(),
      },
    });

    await this.auditLog.log({
      action:       'LOAN_REPAYMENT_RECORDED',
      resourceId:   dto.loanId,
      resourceType: 'LOAN',
      userId:       recordedByUserId,
      details: {
        loanNumber:       loan.loanNumber,
        amountPaidGHS:    dto.amountPaidGHS,
        principalPaid:    this.round2(principalPaid),
        interestPaid:     this.round2(interestPaid),
        transactionRef:   dto.transactionRef,
        outstandingAfter: this.round2(newOutstanding),
        installmentsPaid,
        isFullyRepaid,
      },
    });

    if (isFullyRepaid) {
      this.logger.log(`Loan ${loan.loanNumber} FULLY REPAID by customer ${loan.customerId}`);
    }

    return { installmentsPaid, outstandingBalance: this.round2(newOutstanding) };
  }

  // ─── Collections Workflow ─────────────────────────────────────────────────────

  async initiateCollectionAction(
    dto: CollectionActionDto,
    initiatedByUserId: string,
  ): Promise<void> {
    const loan = await this.getLoanOrThrow(dto.loanId);

    if ((loan.daysPassedDue as number) <= 0) {
      throw new BadRequestException('Loan is not overdue. Collection actions require positive DPD.');
    }

    await this.prisma.collectionAction.create({
      data: {
        loanId:          dto.loanId,
        actionType:      dto.actionType,
        notes:           dto.notes,
        officerId:       dto.officerId,
        nextActionDate:  dto.nextActionDate ?? null,
        performedAt:     new Date(),
        performedBy:     initiatedByUserId,
      },
    });

    await this.auditLog.log({
      action:       'COLLECTION_ACTION_INITIATED',
      resourceId:   dto.loanId,
      resourceType: 'LOAN',
      userId:       initiatedByUserId,
      details: {
        loanNumber:   loan.loanNumber,
        actionType:   dto.actionType,
        daysOverdue:  loan.daysPassedDue,
        notes:        dto.notes,
      },
      severity: dto.actionType === 'LEGAL_NOTICE' || dto.actionType === 'WRITTEN_OFF' ? 'HIGH' : 'MEDIUM',
    });

    this.logger.log(`Collection action ${dto.actionType} for loan ${loan.loanNumber}`);
  }

  // ─── Update NPA Classification ────────────────────────────────────────────────

  async updateNpaClassification(loanId: string, systemUserId: string): Promise<void> {
    const loan = await this.getLoanOrThrow(loanId);
    if (!['ACTIVE', 'WATCHLIST', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS'].includes(loan.status as string)) return;

    const dpd    = loan.daysPassedDue as number;
    let npa: string;
    let provision: number;
    const outstanding = loan.outstandingPrincipal as number;

    if (dpd >= 360) {
      npa = 'LOSS';       provision = outstanding * 1.00;
    } else if (dpd >= 180) {
      npa = 'DOUBTFUL';   provision = outstanding * 0.50;
    } else if (dpd >= 90) {
      npa = 'SUBSTANDARD'; provision = outstanding * 0.20;
    } else if (dpd >= 30) {
      npa = 'WATCHLIST';  provision = outstanding * 0.03;
    } else {
      npa = 'PERFORMING'; provision = outstanding * 0.01;
    }

    const loanStatusMap: Record<string, LoanStatus> = {
      PERFORMING:  LoanStatus.ACTIVE,
      WATCHLIST:   LoanStatus.WATCHLIST,
      SUBSTANDARD: LoanStatus.SUBSTANDARD,
      DOUBTFUL:    LoanStatus.DOUBTFUL,
      LOSS:        LoanStatus.LOSS,
    };

    await this.prisma.loan.update({
      where: { id: loanId },
      data: {
        npaClassification: npa,
        provisionAmount:   this.round2(provision),
        status:            loanStatusMap[npa],
        updatedAt:         new Date(),
      },
    });

    await this.auditLog.log({
      action:       'LOAN_NPA_UPDATED',
      resourceId:   loanId,
      resourceType: 'LOAN',
      userId:       systemUserId,
      details: {
        loanNumber:       loan.loanNumber,
        daysPassedDue:    dpd,
        npaClassification: npa,
        provisionAmount:  this.round2(provision),
      },
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async getLoanOrThrow(loanId: string): Promise<Record<string, unknown>> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId, deletedAt: null },
    });
    if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);
    return loan as Record<string, unknown>;
  }

  private async generateLoanNumber(): Promise<string> {
    const year  = new Date().getFullYear();
    const count = await this.prisma.loan.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    return `GHL-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

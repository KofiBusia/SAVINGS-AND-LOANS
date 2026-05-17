import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';
import { InterestCalculatorService } from './interest-calculator.service';
import { LoanStatus, RestructuringType, RepaymentFrequency } from './loan.entity';
import axios from 'axios';

export interface HardshipAssessment {
  customerId:                 string;
  loanId:                     string;
  assessmentDate:             Date;
  hardshipType:               'JOB_LOSS' | 'MEDICAL' | 'BUSINESS_FAILURE' | 'NATURAL_DISASTER' | 'OTHER';
  hardshipDescription:        string;
  incomeChangePercent:        number;
  supportingDocuments:        string[];
  affordableMonthlyPaymentGHS: number;
  recommendedRestructuringType: RestructuringType;
  assessedBy:                 string;
  notes?:                     string;
}

export interface RestructuringRequest {
  loanId:                    string;
  type:                      RestructuringType;
  hardshipAssessmentId:      string;
  newInterestRate?:          number;   // If RATE_REDUCTION
  additionalTermMonths?:     number;   // If TERM_EXTENSION
  paymentHolidayMonths?:     number;   // If PAYMENT_HOLIDAY
  principalReductionGHS?:    number;   // If PRINCIPAL_REDUCTION — requires BoG approval
  reason:                    string;
  requestedBy:               string;
}

export interface BoGRestructuringApproval {
  bogApprovalRef:   string;
  approvalDate:     Date;
  approvalType:     string;
  conditions?:      string[];
  expiryDate?:      Date;
}

export interface RestructuringResult {
  restructuringId:        string;
  loanId:                 string;
  loanNumber:             string;
  type:                   RestructuringType;
  previousTermMonths:     number;
  newTermMonths:          number;
  previousInterestRate:   number;
  newInterestRate:        number;
  previousMonthlyPayment: number;
  newMonthlyPayment:      number;
  totalInterestImpact:    number;    // Difference in total interest
  bogApprovalRequired:    boolean;
  bogApprovalRef?:        string;
  newScheduleGeneratedAt: Date;
}

@Injectable()
export class RestructuringService {
  private readonly logger = new Logger(RestructuringService.name);

  // Maximum restructurings allowed per loan lifetime per BoG
  private readonly MAX_RESTRUCTURINGS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly interestCalc: InterestCalculatorService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Conduct Hardship Assessment ─────────────────────────────────────────────

  async conductHardshipAssessment(
    assessment: HardshipAssessment,
    officerUserId: string,
  ): Promise<{ assessmentId: string }> {
    const loan = await this.getLoanOrThrow(assessment.loanId);

    if (!['ACTIVE', 'WATCHLIST', 'SUBSTANDARD', 'DOUBTFUL'].includes(loan.status as string)) {
      throw new BadRequestException(
        `Hardship assessment requires loan to be in an active/delinquent state. Current: ${loan.status}`,
      );
    }

    const record = await this.prisma.hardshipAssessment.create({
      data: {
        customerId:                  assessment.customerId,
        loanId:                      assessment.loanId,
        assessmentDate:              assessment.assessmentDate,
        hardshipType:                assessment.hardshipType,
        hardshipDescription:         assessment.hardshipDescription,
        incomeChangePercent:         assessment.incomeChangePercent,
        supportingDocuments:         assessment.supportingDocuments,
        affordableMonthlyPaymentGHS: assessment.affordableMonthlyPaymentGHS,
        recommendedType:             assessment.recommendedRestructuringType,
        assessedBy:                  assessment.assessedBy,
        notes:                       assessment.notes ?? null,
        status:                      'COMPLETED',
      },
    });

    await this.auditLog.log({
      action:       'HARDSHIP_ASSESSMENT_COMPLETED',
      resourceId:   assessment.loanId,
      resourceType: 'LOAN',
      userId:       officerUserId,
      details: {
        assessmentId:       record.id,
        loanNumber:         loan.loanNumber,
        hardshipType:       assessment.hardshipType,
        recommendedType:    assessment.recommendedRestructuringType,
      },
    });

    this.logger.log(`Hardship assessment ${record.id} completed for loan ${loan.loanNumber}`);
    return { assessmentId: record.id };
  }

  // ─── Initiate Restructuring Request ──────────────────────────────────────────

  async initiateRestructuring(
    request: RestructuringRequest,
    initiatorUserId: string,
  ): Promise<{ restructuringId: string; bogApprovalRequired: boolean }> {
    const loan = await this.getLoanOrThrow(request.loanId);

    // Check restructuring frequency limit
    if ((loan.restructuringCount as number) >= this.MAX_RESTRUCTURINGS) {
      throw new ForbiddenException(
        `Loan ${loan.loanNumber} has already been restructured ${loan.restructuringCount} time(s). ` +
        `Maximum of ${this.MAX_RESTRUCTURINGS} restructurings allowed per BoG guidelines.`,
      );
    }

    // Validate hardship assessment exists
    const hardshipAssessment = await this.prisma.hardshipAssessment.findUnique({
      where: { id: request.hardshipAssessmentId },
    });

    if (!hardshipAssessment) {
      throw new NotFoundException(
        `Hardship assessment ${request.hardshipAssessmentId} not found. Hardship assessment is mandatory for restructuring.`,
      );
    }

    if ((hardshipAssessment.loanId as string) !== request.loanId) {
      throw new BadRequestException('Hardship assessment does not belong to this loan');
    }

    // Validate restructuring parameters
    this.validateRestructuringParams(request, loan);

    // BoG approval required per Digital Credit Directive 2025
    const bogApprovalRequired = true;

    const restructuring = await this.prisma.loanRestructuring.create({
      data: {
        loanId:               request.loanId,
        type:                 request.type,
        hardshipAssessmentId: request.hardshipAssessmentId,
        newInterestRate:      request.newInterestRate ?? null,
        additionalTermMonths: request.additionalTermMonths ?? null,
        paymentHolidayMonths: request.paymentHolidayMonths ?? null,
        principalReductionGHS: request.principalReductionGHS ?? null,
        reason:               request.reason,
        requestedBy:          request.requestedBy,
        status:               'PENDING_BOG_APPROVAL',
        bogApprovalRequired:  true,
        initiatedAt:          new Date(),
        initiatedBy:          initiatorUserId,
      },
    });

    await this.prisma.loan.update({
      where: { id: request.loanId },
      data: { status: LoanStatus.RESTRUCTURED, updatedAt: new Date() },
    });

    await this.auditLog.log({
      action:       'LOAN_RESTRUCTURING_INITIATED',
      resourceId:   request.loanId,
      resourceType: 'LOAN',
      userId:       initiatorUserId,
      details: {
        restructuringId:    restructuring.id,
        loanNumber:         loan.loanNumber,
        type:               request.type,
        bogApprovalRequired,
        reason:             request.reason,
      },
      severity: 'HIGH',
    });

    // Notify BoG compliance team
    await this.submitBoGRestructuringNotification(loan.loanNumber as string, restructuring.id, request.type);

    this.logger.warn(
      `Loan restructuring initiated: ${restructuring.id} for loan ${loan.loanNumber}. BoG approval required.`,
    );

    return { restructuringId: restructuring.id, bogApprovalRequired };
  }

  // ─── Record BoG Approval ──────────────────────────────────────────────────────

  async recordBoGApproval(
    restructuringId: string,
    approval: BoGRestructuringApproval,
    officerUserId: string,
  ): Promise<void> {
    const restructuring = await this.prisma.loanRestructuring.findUnique({
      where: { id: restructuringId },
    });

    if (!restructuring) {
      throw new NotFoundException(`Restructuring request ${restructuringId} not found`);
    }

    if (restructuring.status !== 'PENDING_BOG_APPROVAL') {
      throw new BadRequestException(`Restructuring is not pending BoG approval. Status: ${restructuring.status}`);
    }

    await this.prisma.loanRestructuring.update({
      where: { id: restructuringId },
      data: {
        status:          'BOG_APPROVED',
        bogApprovalRef:  approval.bogApprovalRef,
        bogApprovalDate: approval.approvalDate,
        bogConditions:   approval.conditions ?? [],
        updatedAt:       new Date(),
      },
    });

    await this.auditLog.log({
      action:       'BOG_RESTRUCTURING_APPROVAL_RECORDED',
      resourceId:   restructuring.loanId as string,
      resourceType: 'LOAN',
      userId:       officerUserId,
      details: {
        restructuringId,
        bogApprovalRef:  approval.bogApprovalRef,
        approvalDate:    approval.approvalDate,
      },
      severity: 'HIGH',
    });

    this.logger.log(
      `BoG approval recorded for restructuring ${restructuringId}: ref=${approval.bogApprovalRef}`,
    );
  }

  // ─── Apply Restructuring ──────────────────────────────────────────────────────

  async applyRestructuring(
    restructuringId: string,
    appliedByUserId: string,
  ): Promise<RestructuringResult> {
    const restructuring = await this.prisma.loanRestructuring.findUnique({
      where: { id: restructuringId },
    });

    if (!restructuring) {
      throw new NotFoundException(`Restructuring ${restructuringId} not found`);
    }

    if (restructuring.status !== 'BOG_APPROVED') {
      throw new BadRequestException(
        `Cannot apply restructuring without BoG approval. Status: ${restructuring.status}`,
      );
    }

    const loan = await this.getLoanOrThrow(restructuring.loanId as string);

    const previousTermMonths   = loan.termMonths as number;
    const previousInterestRate = loan.annualInterestRate as number;
    const previousPrincipal    = loan.outstandingPrincipal as number;

    // Calculate new parameters based on restructuring type
    let newTermMonths       = previousTermMonths;
    let newInterestRate     = previousInterestRate;
    let newPrincipal        = previousPrincipal;
    let paymentHolidayEnd: Date | null = null;

    switch (restructuring.type) {
      case RestructuringType.TERM_EXTENSION:
        newTermMonths += (restructuring.additionalTermMonths as number) ?? 0;
        break;

      case RestructuringType.RATE_REDUCTION:
        newInterestRate = (restructuring.newInterestRate as number) ?? previousInterestRate;
        if (newInterestRate > previousInterestRate) {
          throw new BadRequestException('Rate reduction must result in a lower interest rate');
        }
        break;

      case RestructuringType.PAYMENT_HOLIDAY:
        const holidayMonths = (restructuring.paymentHolidayMonths as number) ?? 0;
        paymentHolidayEnd = new Date();
        paymentHolidayEnd.setMonth(paymentHolidayEnd.getMonth() + holidayMonths);
        newTermMonths += holidayMonths; // Extend term by holiday months
        break;

      case RestructuringType.PRINCIPAL_REDUCTION:
        newPrincipal -= (restructuring.principalReductionGHS as number) ?? 0;
        if (newPrincipal <= 0) {
          throw new BadRequestException('Principal reduction cannot exceed outstanding balance');
        }
        break;

      case RestructuringType.COMBINATION:
        if (restructuring.additionalTermMonths) newTermMonths   += restructuring.additionalTermMonths as number;
        if (restructuring.newInterestRate)       newInterestRate  = restructuring.newInterestRate as number;
        if (restructuring.principalReductionGHS) newPrincipal   -= restructuring.principalReductionGHS as number;
        break;
    }

    // Generate new simple interest schedule
    const newInterestResult = this.interestCalc.calculateSimpleInterest(
      newPrincipal,
      newInterestRate,
      newTermMonths,
      false, // No compounding — REGULATORY REQUIREMENT
    );

    const newScheduleStart = paymentHolidayEnd ?? new Date();
    const newSchedule      = this.interestCalc.generateRepaymentSchedule(
      newPrincipal,
      newInterestRate,
      newTermMonths,
      newScheduleStart,
    );

    // Archive old schedule, create new
    await this.prisma.loanRepaymentSchedule.updateMany({
      where: { loanId: loan.id as string, status: 'PENDING' },
      data:  { status: 'RESTRUCTURED', updatedAt: new Date() },
    });

    await this.prisma.loanRepaymentSchedule.createMany({
      data: newSchedule.installments.map((s) => ({
        loanId:             loan.id as string,
        installmentNumber:  s.installmentNumber,
        dueDate:            s.dueDate,
        principalComponent: s.principalComponent,
        interestComponent:  s.interestComponent,
        totalInstallment:   s.totalInstallment,
        balanceAfter:       s.balanceAfter,
        status:             'PENDING',
        isRestructured:     true,
      })),
    });

    const previousOldInterest = loan.totalInterestGHS as number;
    const interestImpact      = newInterestResult.totalInterest - previousOldInterest;

    await this.prisma.loan.update({
      where: { id: loan.id as string },
      data: {
        termMonths:           newTermMonths,
        annualInterestRate:   newInterestRate,
        outstandingPrincipal: newPrincipal,
        totalInterestGHS:     newInterestResult.totalInterest,
        totalRepayableGHS:    newInterestResult.totalRepayable,
        isRestructured:       true,
        restructuringCount:   (loan.restructuringCount as number) + 1,
        bogRestructuringRef:  restructuring.bogApprovalRef as string,
        paymentHolidayEnd,
        updatedAt:            new Date(),
      },
    });

    await this.prisma.loanRestructuring.update({
      where: { id: restructuringId },
      data: {
        status:          'APPLIED',
        appliedAt:       new Date(),
        appliedBy:       appliedByUserId,
        previousTermMonths,
        newTermMonths,
        previousInterestRate,
        newInterestRate,
        previousPrincipal,
        newPrincipal,
      },
    });

    await this.auditLog.log({
      action:       'LOAN_RESTRUCTURING_APPLIED',
      resourceId:   loan.id as string,
      resourceType: 'LOAN',
      userId:       appliedByUserId,
      details: {
        restructuringId,
        loanNumber:           loan.loanNumber,
        type:                 restructuring.type,
        previousTermMonths,
        newTermMonths,
        previousInterestRate,
        newInterestRate,
        previousPrincipal,
        newPrincipal,
        bogApprovalRef:       restructuring.bogApprovalRef,
      },
      severity: 'HIGH',
    });

    this.logger.warn(
      `Restructuring applied: loan ${loan.loanNumber}, type=${restructuring.type}, ` +
      `term ${previousTermMonths}→${newTermMonths}mo, rate ${previousInterestRate}→${newInterestRate}%`,
    );

    return {
      restructuringId,
      loanId:                 loan.id as string,
      loanNumber:             loan.loanNumber as string,
      type:                   restructuring.type as RestructuringType,
      previousTermMonths,
      newTermMonths,
      previousInterestRate,
      newInterestRate,
      previousMonthlyPayment: this.round2((loan.totalRepayableGHS as number) / (loan.termMonths as number)),
      newMonthlyPayment:      this.round2(newInterestResult.totalRepayable / newTermMonths),
      totalInterestImpact:    this.round2(interestImpact),
      bogApprovalRequired:    true,
      bogApprovalRef:         restructuring.bogApprovalRef as string,
      newScheduleGeneratedAt: new Date(),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private validateRestructuringParams(
    request: RestructuringRequest,
    loan: Record<string, unknown>,
  ): void {
    switch (request.type) {
      case RestructuringType.TERM_EXTENSION:
        if (!request.additionalTermMonths || request.additionalTermMonths <= 0) {
          throw new BadRequestException('TERM_EXTENSION requires additionalTermMonths > 0');
        }
        const maxTerm = this.configService.get<number>('ghana.regulatoryLimits.maxLoanTermMonths', 60);
        const newTerm = (loan.termMonths as number) + request.additionalTermMonths;
        if (newTerm > maxTerm) {
          throw new BadRequestException(`New term ${newTerm} months exceeds maximum ${maxTerm} months`);
        }
        break;

      case RestructuringType.RATE_REDUCTION:
        if (!request.newInterestRate) {
          throw new BadRequestException('RATE_REDUCTION requires newInterestRate');
        }
        if (request.newInterestRate <= 0) {
          throw new BadRequestException('New interest rate must be positive');
        }
        break;

      case RestructuringType.PAYMENT_HOLIDAY:
        if (!request.paymentHolidayMonths || request.paymentHolidayMonths <= 0) {
          throw new BadRequestException('PAYMENT_HOLIDAY requires paymentHolidayMonths > 0');
        }
        if (request.paymentHolidayMonths > 6) {
          throw new BadRequestException('Payment holiday cannot exceed 6 months');
        }
        break;

      case RestructuringType.PRINCIPAL_REDUCTION:
        if (!request.principalReductionGHS || request.principalReductionGHS <= 0) {
          throw new BadRequestException('PRINCIPAL_REDUCTION requires principalReductionGHS > 0');
        }
        if (request.principalReductionGHS >= (loan.outstandingPrincipal as number)) {
          throw new BadRequestException('Principal reduction cannot exceed outstanding balance');
        }
        break;
    }
  }

  private async getLoanOrThrow(loanId: string): Promise<Record<string, unknown>> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId, deletedAt: null },
    });
    if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);
    return loan as Record<string, unknown>;
  }

  private async submitBoGRestructuringNotification(
    loanNumber: string,
    restructuringId: string,
    type: string,
  ): Promise<void> {
    // Notify compliance team — in production, this would queue a BoG notification
    this.logger.warn(
      `BoG RESTRUCTURING NOTIFICATION: Loan ${loanNumber}, ID: ${restructuringId}, Type: ${type}. ` +
      `Awaiting BoG approval before application.`,
    );
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

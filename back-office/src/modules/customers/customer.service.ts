import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';
import {
  CustomerStatus,
  KycStatus,
  AmlRiskLevel,
  CustomerType,
  EmploymentStatus,
  Gender,
} from './customer.entity';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateCustomerDto {
  type: CustomerType;
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: Date;
  gender: Gender;
  nationality: string;
  email: string;
  phoneNumber: string;
  alternatePhone?: string;
  employmentStatus: EmploymentStatus;
  employer?: string;
  jobTitle?: string;
  monthlyIncomeGHS?: number;
  branchCode: string;
  referralCode?: string;
}

export interface UpdateCustomerDto {
  email?: string;
  phoneNumber?: string;
  alternatePhone?: string;
  employer?: string;
  jobTitle?: string;
  monthlyIncomeGHS?: number;
  notes?: string;
  tags?: string[];
}

export interface CustomerSearchParams {
  query?: string;           // Free-text search
  status?: CustomerStatus;
  kycStatus?: KycStatus;
  amlRiskLevel?: AmlRiskLevel;
  branchCode?: string;
  isPep?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PepScreeningResult {
  isPep: boolean;
  isSanctioned: boolean;
  matchScore?: number;
  matchDetails?: unknown;
  screenedAt: Date;
  provider: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Create Customer ─────────────────────────────────────────────────────────

  async createCustomer(
    dto: CreateCustomerDto,
    createdByUserId: string,
  ): Promise<{ id: string; customerNumber: string }> {
    // Check for duplicate email or phone
    const existing = await this.prisma.customer.findFirst({
      where: {
        OR: [
          { email: dto.email.toLowerCase().trim() },
          { phoneNumber: this.normalizePhone(dto.phoneNumber) },
        ],
        deletedAt: null,
      },
    });

    if (existing) {
      const field = existing.email === dto.email.toLowerCase().trim() ? 'email' : 'phone number';
      throw new ConflictException(`A customer with this ${field} already exists`);
    }

    // Validate phone number (Ghana format)
    const normalizedPhone = this.normalizePhone(dto.phoneNumber);
    if (!this.isValidGhanaPhone(normalizedPhone)) {
      throw new BadRequestException(
        'Invalid Ghana phone number. Must start with +233 or 0 followed by 9 digits',
      );
    }

    const customerNumber = await this.generateCustomerNumber();

    const customer = await this.prisma.customer.create({
      data: {
        customerNumber,
        type:             dto.type,
        status:           CustomerStatus.PENDING_KYC,
        firstName:        dto.firstName.trim(),
        middleName:       dto.middleName?.trim(),
        lastName:         dto.lastName.trim(),
        dateOfBirth:      dto.dateOfBirth,
        gender:           dto.gender,
        nationality:      dto.nationality,
        email:            dto.email.toLowerCase().trim(),
        phoneNumber:      normalizedPhone,
        alternatePhone:   dto.alternatePhone ? this.normalizePhone(dto.alternatePhone) : null,
        employmentStatus: dto.employmentStatus,
        employer:         dto.employer,
        jobTitle:         dto.jobTitle,
        monthlyIncomeGHS: dto.monthlyIncomeGHS,
        kycStatus:        KycStatus.NOT_STARTED,
        amlRiskLevel:     AmlRiskLevel.LOW,
        amlRiskScore:     0,
        isPep:            false,
        isSanctioned:     false,
        eddRequired:      false,
        hasBeneficialOwners: false,
        marketingConsent:    false,
        isBlacklisted:       false,
        onboardedBy:         createdByUserId,
        branchCode:          dto.branchCode,
        referralCode:        dto.referralCode,
        tags:             [],
      },
    });

    await this.auditLog.log({
      action:     'CUSTOMER_CREATED',
      resourceId: customer.id,
      resourceType: 'CUSTOMER',
      userId:     createdByUserId,
      details: {
        customerNumber: customer.customerNumber,
        type:           dto.type,
        branchCode:     dto.branchCode,
      },
    });

    this.logger.log(`Customer created: ${customer.customerNumber} (${customer.id}) by ${createdByUserId}`);

    return { id: customer.id, customerNumber: customer.customerNumber };
  }

  // ─── Get Customer by ID ───────────────────────────────────────────────────────

  async getCustomerById(customerId: string, requestingUserId: string): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
      include: {
        kycRecords:         true,
        consentRecords:     true,
        beneficialOwners:   true,
        loans:              { where: { deletedAt: null }, take: 10, orderBy: { createdAt: 'desc' } },
        savingsAccounts:    { where: { deletedAt: null }, take: 10 },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    await this.auditLog.log({
      action:       'CUSTOMER_VIEWED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       requestingUserId,
      details:      { customerNumber: customer.customerNumber },
    });

    // Redact sensitive fields for audit trail
    return this.redactSensitiveFields(customer);
  }

  // ─── Update Customer ──────────────────────────────────────────────────────────

  async updateCustomer(
    customerId: string,
    dto: UpdateCustomerDto,
    updatedByUserId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    if (customer.status === CustomerStatus.CLOSED || customer.status === CustomerStatus.BLACKLISTED) {
      throw new ForbiddenException(`Cannot update customer with status ${customer.status}`);
    }

    const updateData: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};

    if (dto.email && dto.email !== customer.email) {
      updateData.email = dto.email.toLowerCase().trim();
      changes.email = { from: customer.email, to: updateData.email };
    }

    if (dto.phoneNumber) {
      const normalizedPhone = this.normalizePhone(dto.phoneNumber);
      if (normalizedPhone !== customer.phoneNumber) {
        updateData.phoneNumber = normalizedPhone;
        changes.phoneNumber = { from: customer.phoneNumber, to: normalizedPhone };
      }
    }

    if (dto.monthlyIncomeGHS !== undefined) {
      updateData.monthlyIncomeGHS = dto.monthlyIncomeGHS;
      changes.monthlyIncomeGHS = {
        from: customer.monthlyIncomeGHS,
        to: dto.monthlyIncomeGHS,
      };
    }

    if (Object.keys(updateData).length === 0) {
      return; // No changes
    }

    updateData.updatedAt = new Date();

    await this.prisma.customer.update({
      where: { id: customerId },
      data:  updateData,
    });

    await this.auditLog.log({
      action:       'CUSTOMER_UPDATED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       updatedByUserId,
      details:      { customerNumber: customer.customerNumber, changes },
    });

    this.logger.log(`Customer ${customer.customerNumber} updated by ${updatedByUserId}`);
  }

  // ─── KYC Status Transition ────────────────────────────────────────────────────

  async transitionKycStatus(
    customerId: string,
    toStatus: KycStatus,
    transitionData: Record<string, unknown>,
    officerUserId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const fromStatus = customer.kycStatus as KycStatus;
    this.validateKycTransition(fromStatus, toStatus);

    const updateData: Record<string, unknown> = {
      kycStatus: toStatus,
      updatedAt: new Date(),
    };

    // Status-specific field updates
    if (toStatus === KycStatus.COMPLETED) {
      updateData.kycCompletedAt = new Date();
      updateData.kycExpiresAt   = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
      updateData.status         = CustomerStatus.PENDING_ACTIVATION;
    }

    if (toStatus === KycStatus.REJECTED) {
      updateData.status = CustomerStatus.SUSPENDED;
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data:  updateData,
    });

    await this.auditLog.log({
      action:       'KYC_STATUS_TRANSITION',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: {
        customerNumber: customer.customerNumber,
        fromStatus,
        toStatus,
        transitionData,
      },
    });

    this.logger.log(
      `KYC transition for ${customer.customerNumber}: ${fromStatus} → ${toStatus} by ${officerUserId}`,
    );
  }

  // ─── Activate Customer ────────────────────────────────────────────────────────

  async activateCustomer(customerId: string, officerUserId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    if (customer.kycStatus !== KycStatus.COMPLETED) {
      throw new BadRequestException('Customer KYC must be completed before activation');
    }

    if (customer.status !== CustomerStatus.PENDING_ACTIVATION) {
      throw new BadRequestException(`Customer cannot be activated from status ${customer.status}`);
    }

    if (customer.isSanctioned) {
      throw new ForbiddenException('Cannot activate sanctioned customer');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        status:          CustomerStatus.ACTIVE,
        lastActivityAt:  new Date(),
        updatedAt:       new Date(),
      },
    });

    await this.auditLog.log({
      action:       'CUSTOMER_ACTIVATED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details:      { customerNumber: customer.customerNumber },
    });

    this.logger.log(`Customer ${customer.customerNumber} activated by ${officerUserId}`);
  }

  // ─── Suspend / Blacklist ──────────────────────────────────────────────────────

  async suspendCustomer(
    customerId: string,
    reason: string,
    officerUserId: string,
  ): Promise<void> {
    await this.updateCustomerStatus(
      customerId,
      CustomerStatus.SUSPENDED,
      reason,
      officerUserId,
      'CUSTOMER_SUSPENDED',
    );
  }

  async blacklistCustomer(
    customerId: string,
    reason: string,
    officerUserId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        status:           CustomerStatus.BLACKLISTED,
        isBlacklisted:    true,
        blacklistReason:  reason,
        updatedAt:        new Date(),
      },
    });

    await this.auditLog.log({
      action:       'CUSTOMER_BLACKLISTED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: {
        customerNumber: customer.customerNumber,
        reason,
      },
      severity: 'HIGH',
    });

    this.logger.warn(`Customer ${customer.customerNumber} BLACKLISTED by ${officerUserId}. Reason: ${reason}`);
  }

  // ─── PEP Screening ───────────────────────────────────────────────────────────

  async performPepScreening(
    customerId: string,
    officerUserId: string,
  ): Promise<PepScreeningResult> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    this.logger.log(`PEP screening for customer ${customer.customerNumber}`);

    // In production: call World-Check / Refinitiv API
    // This is a structured placeholder with the correct interface
    const screeningResult: PepScreeningResult = {
      isPep:          false,
      isSanctioned:   false,
      matchScore:     0,
      matchDetails:   null,
      screenedAt:     new Date(),
      provider:       'WORLD_CHECK',
    };

    const nextScreeningDate = new Date();
    nextScreeningDate.setDate(nextScreeningDate.getDate() + 180); // Rescreen in 6 months

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        isPep:             screeningResult.isPep,
        isSanctioned:      screeningResult.isSanctioned,
        amlLastScreenedAt: screeningResult.screenedAt,
        eddRequired:       screeningResult.isPep || screeningResult.isSanctioned,
        updatedAt:         new Date(),
      },
    });

    await this.prisma.amlScreeningRecord.create({
      data: {
        customerId,
        screenedAt:    screeningResult.screenedAt,
        provider:      screeningResult.provider,
        isPep:         screeningResult.isPep,
        isSanctioned:  screeningResult.isSanctioned,
        isAdverseMedia: false,
        matchDetails:  screeningResult.matchDetails ?? {},
        riskScore:     screeningResult.matchScore ?? 0,
        nextScreeningDue: nextScreeningDate,
      },
    });

    await this.auditLog.log({
      action:       'PEP_SCREENING_COMPLETED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: {
        customerNumber: customer.customerNumber,
        isPep:          screeningResult.isPep,
        isSanctioned:   screeningResult.isSanctioned,
        provider:       screeningResult.provider,
      },
    });

    return screeningResult;
  }

  // ─── Search Customers ─────────────────────────────────────────────────────────

  async searchCustomers(
    params: CustomerSearchParams,
    requestingUserId: string,
  ): Promise<{ customers: unknown[]; total: number; page: number; limit: number }> {
    const page  = params.page  ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };

    if (params.status)       where.status = params.status;
    if (params.kycStatus)    where.kycStatus = params.kycStatus;
    if (params.amlRiskLevel) where.amlRiskLevel = params.amlRiskLevel;
    if (params.branchCode)   where.branchCode = params.branchCode;
    if (params.isPep !== undefined) where.isPep = params.isPep;

    if (params.query) {
      where.OR = [
        { customerNumber: { contains: params.query, mode: 'insensitive' } },
        { firstName:      { contains: params.query, mode: 'insensitive' } },
        { lastName:       { contains: params.query, mode: 'insensitive' } },
        { email:          { contains: params.query, mode: 'insensitive' } },
        { phoneNumber:    { contains: params.query } },
      ];
    }

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { [params.sortBy ?? 'createdAt']: params.sortOrder ?? 'desc' },
        select: {
          id:             true,
          customerNumber: true,
          type:           true,
          status:         true,
          firstName:      true,
          lastName:       true,
          email:          true,
          phoneNumber:    true,
          kycStatus:      true,
          amlRiskLevel:   true,
          isPep:          true,
          branchCode:     true,
          createdAt:      true,
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    await this.auditLog.log({
      action:       'CUSTOMER_SEARCH',
      resourceId:   'BULK',
      resourceType: 'CUSTOMER',
      userId:       requestingUserId,
      details:      { params, resultsCount: customers.length },
    });

    return { customers, total, page, limit };
  }

  // ─── Soft Delete Customer ─────────────────────────────────────────────────────

  async deleteCustomer(
    customerId: string,
    reason: string,
    officerUserId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
      include: { loans: { where: { deletedAt: null } } },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const activeLoans = customer.loans.filter(
      (l: { status: string }) => !['CLOSED', 'WRITTEN_OFF'].includes(l.status),
    );

    if (activeLoans.length > 0) {
      throw new ForbiddenException(
        `Cannot delete customer with ${activeLoans.length} active loan(s). Close all loans first.`,
      );
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        deletedAt: new Date(),
        status:    CustomerStatus.CLOSED,
        updatedAt: new Date(),
      },
    });

    await this.auditLog.log({
      action:       'CUSTOMER_DELETED',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: {
        customerNumber: customer.customerNumber,
        reason,
      },
      severity: 'HIGH',
    });

    this.logger.warn(`Customer ${customer.customerNumber} soft-deleted by ${officerUserId}. Reason: ${reason}`);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private validateKycTransition(from: KycStatus, to: KycStatus): void {
    const validTransitions: Partial<Record<KycStatus, KycStatus[]>> = {
      [KycStatus.NOT_STARTED]:           [KycStatus.GHANA_CARD_SCAN],
      [KycStatus.GHANA_CARD_SCAN]:       [KycStatus.LIVENESS_CHECK, KycStatus.REJECTED],
      [KycStatus.LIVENESS_CHECK]:        [KycStatus.ADDRESS_VERIFICATION, KycStatus.REJECTED],
      [KycStatus.ADDRESS_VERIFICATION]:  [KycStatus.INCOME_DECLARATION, KycStatus.REJECTED],
      [KycStatus.INCOME_DECLARATION]:    [KycStatus.PEP_SCREENING],
      [KycStatus.PEP_SCREENING]:         [KycStatus.RISK_CLASSIFICATION, KycStatus.REJECTED],
      [KycStatus.RISK_CLASSIFICATION]:   [KycStatus.EDD_REQUIRED, KycStatus.BENEFICIAL_OWNERSHIP],
      [KycStatus.EDD_REQUIRED]:          [KycStatus.EDD_IN_PROGRESS],
      [KycStatus.EDD_IN_PROGRESS]:       [KycStatus.BENEFICIAL_OWNERSHIP, KycStatus.REJECTED],
      [KycStatus.BENEFICIAL_OWNERSHIP]:  [KycStatus.CONSENT_CAPTURE],
      [KycStatus.CONSENT_CAPTURE]:       [KycStatus.PRE_AGREEMENT_DISPLAY],
      [KycStatus.PRE_AGREEMENT_DISPLAY]: [KycStatus.ESIGNATURE],
      [KycStatus.ESIGNATURE]:            [KycStatus.COMPLETED],
    };

    const allowed = validTransitions[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid KYC state transition: ${from} → ${to}. Allowed transitions: ${allowed.join(', ')}`,
      );
    }
  }

  private async updateCustomerStatus(
    customerId: string,
    status: CustomerStatus,
    reason: string,
    officerUserId: string,
    auditAction: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { status, updatedAt: new Date() },
    });

    await this.auditLog.log({
      action:       auditAction,
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: { customerNumber: customer.customerNumber, reason, newStatus: status },
    });
  }

  private normalizePhone(phone: string): string {
    const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
    if (cleaned.startsWith('0')) {
      return `+233${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('233')) {
      return `+${cleaned}`;
    }
    return cleaned;
  }

  private isValidGhanaPhone(phone: string): boolean {
    return /^\+233[235679]\d{8}$/.test(phone);
  }

  private async generateCustomerNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.customer.count({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01`),
          lt:  new Date(`${year + 1}-01-01`),
        },
      },
    });
    return `GH-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private redactSensitiveFields(customer: unknown): unknown {
    const c = customer as Record<string, unknown>;
    const { ghanaCardNumber, ...rest } = c;
    // Redact Ghana card number — only hash is accessible
    void ghanaCardNumber;
    return {
      ...rest,
      ghanaCardNumber: '[REDACTED - see ghanaCardHash]',
    };
  }
}

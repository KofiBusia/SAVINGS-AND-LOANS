import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../compliance/audit-log.service';

export interface UboRecord {
  id?: string;
  customerId: string;
  fullName: string;
  dateOfBirth: Date;
  nationalityCountry: string;  // ISO-3166-1 alpha-2
  ghanaCardNumber?: string;    // For Ghanaian UBOs â€” stored as hash
  passportNumber?: string;     // For foreign UBOs â€” stored as hash
  ownershipPercentage: number;
  controlType: 'DIRECT' | 'INDIRECT' | 'NOMINEE' | 'VOTING_RIGHTS';
  addressCountry: string;
  addressDetails: string;
  isPep: boolean;
  isSanctioned: boolean;
  sourceFundsDescription: string;
}

export interface UboVerificationResult {
  uboId: string;
  verified: boolean;
  verificationMethod: string;
  verificationRef?: string;
  verifiedAt: Date;
  failureReason?: string;
}

export interface BeneficialOwnershipReport {
  customerId: string;
  customerNumber: string;
  totalUboCount: number;
  uboThresholdPercent: number;
  totalOwnershipAccountedFor: number;
  ubos: UboSummary[];
  disclosureCompletedAt: Date;
  complianceStatus: 'COMPLIANT' | 'INCOMPLETE' | 'OVER_THRESHOLD' | 'REQUIRES_EDD';
  eddRequired: boolean;
  eddTriggers: string[];
}

export interface UboSummary {
  id: string;
  fullName: string;
  ownershipPercentage: number;
  controlType: string;
  nationalityCountry: string;
  verificationStatus: string;
  isPep: boolean;
  isSanctioned: boolean;
}

@Injectable()
export class BeneficialOwnershipService {
  private readonly logger = new Logger(BeneficialOwnershipService.name);

  // AML Act 1044: 25% beneficial ownership threshold
  private readonly UBO_THRESHOLD_PERCENT = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  // â”€â”€â”€ Register UBO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async registerUbo(
    dto: UboRecord,
    registeredByUserId: string,
  ): Promise<{ uboId: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId},
      include: { beneficialOwners: { where: { isActive: true } } },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }

    // Validate ownership percentage
    this.validateOwnershipPercentage(dto.ownershipPercentage);

    // Check 25% threshold requirement (AML Act 1044)
    if (dto.ownershipPercentage < this.UBO_THRESHOLD_PERCENT) {
      throw new BadRequestException(
        `UBO ownership percentage (${dto.ownershipPercentage}%) is below the mandatory disclosure threshold of ${this.UBO_THRESHOLD_PERCENT}%. ` +
        `Per AML Act 1044, only persons owning or controlling â‰¥25% must be declared as UBOs.`,
      );
    }

    // Check total ownership doesn't exceed 100%
    const existingOwnership = (customer.beneficialOwners as Array<{ ownershipPercentage: number }>).reduce(
      (sum: number, ubo: { ownershipPercentage: number }) => sum + ubo.ownershipPercentage,
      0,
    );

    if (existingOwnership + dto.ownershipPercentage > 100) {
      throw new UnprocessableEntityException(
        `Total ownership would exceed 100%. Current total: ${existingOwnership}%, adding: ${dto.ownershipPercentage}%`,
      );
    }

    // Check for duplicate UBO (by name + DOB combination)
    const duplicateCheck = await this.prisma.beneficialOwner.findFirst({
      where: {
        customerId:   dto.customerId,
        fullName:     dto.fullName,
        dateOfBirth:  dto.dateOfBirth,
        isActive:     true,
      },
    });

    if (duplicateCheck) {
      throw new ConflictError(
        `UBO ${dto.fullName} (DOB: ${dto.dateOfBirth.toISOString().split('T')[0]}) is already registered for this customer`,
      );
    }

    const ubo = await this.prisma.beneficialOwner.create({
      data: {
        customerId:               dto.customerId,
        fullName:                 dto.fullName,
        dateOfBirth:              dto.dateOfBirth,
        nationalityCountry:       dto.nationalityCountry,
        ownershipPercentage:      dto.ownershipPercentage,
        controlType:              dto.controlType,
        addressCountry:           dto.addressCountry,
        addressDetails:           dto.addressDetails,
        isPep:                    dto.isPep,
        isSanctioned:             dto.isSanctioned,
        sourceFundsDescription:   dto.sourceFundsDescription,
        verificationStatus:       'PENDING',
        isActive:                 true,
        disclosedAt:              new Date(),
        disclosedBy:              registeredByUserId,
      },
    });

    // Update customer UBO flag
    await this.prisma.customer.update({
      where: { id: dto.customerId },
      data: { hasBeneficialOwners: true, updatedAt: new Date() },
    });

    await this.auditLog.log({
      action:       'UBO_REGISTERED',
      resourceId:   dto.customerId,
      resourceType: 'BENEFICIAL_OWNER',
      userId:       registeredByUserId,
      details: {
        uboId:               ubo.id,
        fullName:            dto.fullName,
        ownershipPercentage: dto.ownershipPercentage,
        controlType:         dto.controlType,
        isPep:               dto.isPep,
      },
    });

    this.logger.log(
      `UBO registered: ${dto.fullName} (${dto.ownershipPercentage}%) for customer ${dto.customerId}`,
    );

    // Auto-trigger EDD if UBO is PEP or sanctioned
    if (dto.isPep || dto.isSanctioned) {
      await this.triggerUboEdd(dto.customerId, ubo.id, dto.isPep ? 'UBO_IS_PEP' : 'UBO_IS_SANCTIONED', registeredByUserId);
    }

    return { uboId: ubo.id };
  }

  // â”€â”€â”€ Verify UBO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async verifyUbo(
    uboId: string,
    verificationMethod: string,
    verificationRef: string,
    officerUserId: string,
  ): Promise<UboVerificationResult> {
    const ubo = await this.prisma.beneficialOwner.findUnique({
      where: { id: uboId },
    });

    if (!ubo) {
      throw new NotFoundException(`UBO ${uboId} not found`);
    }

    if (ubo.verificationStatus === 'VERIFIED') {
      throw new BadRequestException(`UBO ${uboId} is already verified`);
    }

    const verifiedAt = new Date();

    await this.prisma.beneficialOwner.update({
      where: { id: uboId },
      data: {
        verificationStatus: 'VERIFIED',
        verificationMethod,
        verificationRef,
        verifiedAt,
        verifiedBy: officerUserId,
      },
    });

    const result: UboVerificationResult = {
      uboId,
      verified:           true,
      verificationMethod,
      verificationRef,
      verifiedAt,
    };

    await this.auditLog.log({
      action:       'UBO_VERIFIED',
      resourceId:   ubo.customerId,
      resourceType: 'BENEFICIAL_OWNER',
      userId:       officerUserId,
      details: {
        uboId,
        fullName:           ubo.fullName,
        verificationMethod,
        verificationRef,
      },
    });

    // Check if all UBOs are now verified â€” update customer record
    await this.checkAndUpdateUboCompletionStatus(ubo.customerId, officerUserId);

    return result;
  }

  // â”€â”€â”€ Get Beneficial Ownership Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getBeneficialOwnershipReport(
    customerId: string,
    requestingUserId: string,
  ): Promise<BeneficialOwnershipReport> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId},
      include: {
        beneficialOwners: {
          where: { isActive: true },
          orderBy: { ownershipPercentage: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const ubos = customer.beneficialOwners as Array<{
      id: string;
      fullName: string;
      ownershipPercentage: number;
      controlType: string;
      nationalityCountry: string;
      verificationStatus: string;
      isPep: boolean;
      isSanctioned: boolean;
    }>;

    const totalOwnership = ubos.reduce((sum, ubo) => sum + ubo.ownershipPercentage, 0);

    const eddTriggers: string[] = [];
    if (ubos.some((u) => u.isPep)) eddTriggers.push('UBO_IS_PEP');
    if (ubos.some((u) => u.isSanctioned)) eddTriggers.push('UBO_IS_SANCTIONED');
    if (ubos.some((u) => u.nationalityCountry === 'KP' || u.nationalityCountry === 'IR')) {
      eddTriggers.push('UBO_HIGH_RISK_NATIONALITY');
    }

    let complianceStatus: BeneficialOwnershipReport['complianceStatus'] = 'COMPLIANT';
    if (ubos.length === 0 && customer.type === 'BUSINESS') {
      complianceStatus = 'INCOMPLETE';
    } else if (totalOwnership > 100) {
      complianceStatus = 'OVER_THRESHOLD';
    } else if (eddTriggers.length > 0) {
      complianceStatus = 'REQUIRES_EDD';
    }

    await this.auditLog.log({
      action:       'UBO_REPORT_ACCESSED',
      resourceId:   customerId,
      resourceType: 'BENEFICIAL_OWNER',
      userId:       requestingUserId,
      details:      { customerNumber: customer.customerNumber },
    });

    return {
      customerId,
      customerNumber:               customer.customerNumber,
      totalUboCount:                ubos.length,
      uboThresholdPercent:          this.UBO_THRESHOLD_PERCENT,
      totalOwnershipAccountedFor:   totalOwnership,
      ubos: ubos.map((u) => ({
        id:                  u.id,
        fullName:            u.fullName,
        ownershipPercentage: u.ownershipPercentage,
        controlType:         u.controlType,
        nationalityCountry:  u.nationalityCountry,
        verificationStatus:  u.verificationStatus,
        isPep:               u.isPep,
        isSanctioned:        u.isSanctioned,
      })),
      disclosureCompletedAt: customer.uboVerifiedAt ?? new Date(),
      complianceStatus,
      eddRequired:  eddTriggers.length > 0,
      eddTriggers,
    };
  }

  // â”€â”€â”€ Detect 25% Threshold Violations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async detectThresholdViolations(customerId: string): Promise<{
    hasViolations: boolean;
    violations: string[];
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId},
      include: { beneficialOwners: { where: { isActive: true } } },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const violations: string[] = [];
    const ubos = customer.beneficialOwners as Array<{
      fullName: string;
      ownershipPercentage: number;
      verificationStatus: string;
    }>;

    for (const ubo of ubos) {
      if (ubo.ownershipPercentage < this.UBO_THRESHOLD_PERCENT) {
        violations.push(
          `UBO ${ubo.fullName} ownership (${ubo.ownershipPercentage}%) is below 25% threshold â€” should not be declared as UBO`,
        );
      }

      if (ubo.verificationStatus === 'PENDING') {
        violations.push(
          `UBO ${ubo.fullName} has not been verified â€” identity verification required per AML Act 1044`,
        );
      }
    }

    // For business accounts: check if beneficial owners exist
    if (customer.type === 'BUSINESS' && ubos.length === 0) {
      violations.push(
        'Business customer has no declared UBOs. Per AML Act 1044, all persons owning or controlling â‰¥25% must be declared.',
      );
    }

    return {
      hasViolations: violations.length > 0,
      violations,
    };
  }

  // â”€â”€â”€ Remove UBO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async removeUbo(
    uboId: string,
    reason: string,
    officerUserId: string,
  ): Promise<void> {
    const ubo = await this.prisma.beneficialOwner.findUnique({
      where: { id: uboId },
    });

    if (!ubo) {
      throw new NotFoundException(`UBO ${uboId} not found`);
    }

    // Soft delete â€” never hard delete for compliance
    await this.prisma.beneficialOwner.update({
      where: { id: uboId },
      data: {
        isActive:     false,
        removedAt:    new Date(),
        removedBy:    officerUserId,
        removalReason: reason,
      },
    });

    await this.auditLog.log({
      action:       'UBO_REMOVED',
      resourceId:   ubo.customerId,
      resourceType: 'BENEFICIAL_OWNER',
      userId:       officerUserId,
      details: {
        uboId,
        fullName: ubo.fullName,
        reason,
      },
      severity: 'MEDIUM',
    });

    this.logger.warn(`UBO ${uboId} (${ubo.fullName}) removed from customer ${ubo.customerId}. Reason: ${reason}`);
  }

  // â”€â”€â”€ Private Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private validateOwnershipPercentage(percentage: number): void {
    if (percentage < 0 || percentage > 100) {
      throw new BadRequestException('Ownership percentage must be between 0 and 100');
    }
    if (!Number.isFinite(percentage)) {
      throw new BadRequestException('Ownership percentage must be a finite number');
    }
    // Round to 2 decimal places
    const rounded = Math.round(percentage * 100) / 100;
    if (Math.abs(rounded - percentage) > 0.001) {
      throw new BadRequestException('Ownership percentage must have at most 2 decimal places');
    }
  }

  private async triggerUboEdd(
    customerId: string,
    uboId: string,
    trigger: string,
    officerUserId: string,
  ): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { eddRequired: true, updatedAt: new Date() },
    });

    await this.auditLog.log({
      action:       'EDD_TRIGGERED_BY_UBO',
      resourceId:   customerId,
      resourceType: 'CUSTOMER',
      userId:       officerUserId,
      details: { uboId, trigger },
      severity:     'HIGH',
    });

    this.logger.warn(`EDD triggered for customer ${customerId} due to UBO trigger: ${trigger}`);
  }

  private async checkAndUpdateUboCompletionStatus(
    customerId: string,
    officerUserId: string,
  ): Promise<void> {
    const pendingUbos = await this.prisma.beneficialOwner.count({
      where: {
        customerId,
        isActive:           true,
        verificationStatus: 'PENDING',
      },
    });

    if (pendingUbos === 0) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { uboVerifiedAt: new Date(), updatedAt: new Date() },
      });

      await this.auditLog.log({
        action:       'UBO_DISCLOSURE_COMPLETED',
        resourceId:   customerId,
        resourceType: 'CUSTOMER',
        userId:       officerUserId,
        details:      { allUbosVerified: true },
      });
    }
  }
}

// Local error class to avoid circular imports
class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

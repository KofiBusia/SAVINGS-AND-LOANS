import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { validateGhanaCard } from '../../../../shared/src/utils/ghana-validators';
import { assertValidKycTransition } from '../../../../shared/src/schemas/kycWorkflow.schema';
import { RegulatoryError, RegulatoryErrorCode, ValidationError, ValidationErrorCode } from '../../../../shared/src/constants/errors';
import { AML_1044, DCD_2025 } from '../../../../shared/src/constants/compliance';
import type { Customer, KycStatus, PepScreeningResult } from '../../../../shared/src/interfaces/Customer';

/**
 * KYC/AML State Machine Service - AML Act 1044 Compliant
 *
 * Enforces the mandatory 12-step KYC onboarding flow:
 * ghanaCardScan → livenessCheck → addressVerification → incomeDeclaration →
 * pepScreening → riskClassification → [eddTriggerIfHighRisk] →
 * beneficialOwnershipCapture → consentCapture → preAgreementDisplay →
 * eSignature → accountActivation
 *
 * Each step:
 * 1. Validates preconditions and current state
 * 2. Executes the action
 * 3. Creates an immutable SHA-256 hash-chained audit entry
 * 4. Returns the new state or throws if the transition is invalid
 */
@Injectable()
export class KycAmlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * STEP 1: Ghana Card scan and NIA verification.
   * Ghana Card is the SOLE accepted identity document (NIA policy + AML Act 1044).
   */
  async ghanaCardScan(
    customerId: string,
    ghanaCardData: {
      cardNumber: string;
      dateOfBirth: string;
      expiryDate: string;
      niaReferenceCode: string;
      livenessScore: number;
      verificationMethod: 'OCR_PLUS_NIA' | 'NIA_DIRECT' | 'OFFLINE_CACHED';
    },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_GHANA_CARD');

    // Validate Ghana Card format (NIA policy: GHA-XXXXXXXX-X)
    validateGhanaCard(ghanaCardData.cardNumber);

    // Check liveness score meets minimum (80%)
    if (ghanaCardData.livenessScore < 80) {
      throw new ValidationError(
        ValidationErrorCode.INVALID_GHANA_CARD,
        `Liveness score ${ghanaCardData.livenessScore} below minimum threshold of 80. Please retry.`,
      );
    }

    // Check card expiry
    if (new Date(ghanaCardData.expiryDate) < new Date()) {
      throw new ValidationError(
        ValidationErrorCode.INVALID_GHANA_CARD,
        'Ghana Card is expired. Customer must present a valid Ghana Card.',
      );
    }

    // Check for duplicate Ghana Card (one person, one account policy)
    const { hashGhanaCard } = await import('../../../../shared/src/utils/crypto');
    const cardHash = hashGhanaCard(ghanaCardData.cardNumber, process.env.BIOMETRIC_SALT ?? 'default_salt');
    const existing = await this.prisma.customer.findFirst({ where: { ghanaCardHash: cardHash } });
    if (existing && existing.id !== customerId) {
      throw new RegulatoryError(
        RegulatoryErrorCode.GHANA_CARD_REQUIRED,
        'This Ghana Card is already registered to another account.',
      );
    }

    const updatedCustomer = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        kycStatus: 'PENDING_LIVENESS',
        ghanaCardHash: cardHash,
        ghanaCardRecord: {
          ...ghanaCardData,
          verifiedAt: new Date(),
        },
      },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: {
        fromState: 'PENDING_GHANA_CARD',
        toState: 'PENDING_LIVENESS',
        verificationMethod: ghanaCardData.verificationMethod,
        niaReferenceCode: ghanaCardData.niaReferenceCode,
        livenessScore: ghanaCardData.livenessScore,
        cardMasked: `GHA-****${ghanaCardData.cardNumber.split('-')[1].slice(4)}-${ghanaCardData.cardNumber.split('-')[2]}`,
      },
      ipAddress,
    });

    return updatedCustomer as unknown as Customer;
  }

  /**
   * STEP 2: Liveness check verification (biometric confirmation).
   */
  async livenessCheck(
    customerId: string,
    livenessResult: { passed: boolean; score: number; providerReference: string },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_LIVENESS');

    if (!livenessResult.passed || livenessResult.score < 80) {
      await this.auditLog.log({
        action: 'KYC_STATE_CHANGE',
        userId: actorUserId,
        customerId,
        entityType: 'CUSTOMER',
        entityId: customerId,
        metadata: { step: 'LIVENESS_CHECK', result: 'FAILED', score: livenessResult.score },
        ipAddress,
      });
      throw new RegulatoryError(
        RegulatoryErrorCode.KYC_INCOMPLETE,
        `Liveness check failed (score: ${livenessResult.score}). Customer must be physically present.`,
      );
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { kycStatus: 'PENDING_ADDRESS' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: { fromState: 'PENDING_LIVENESS', toState: 'PENDING_ADDRESS', livenessScore: livenessResult.score },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 3: Address verification with GPS and photo evidence.
   */
  async addressVerification(
    customerId: string,
    addressData: {
      region: string;
      district: string;
      town: string;
      streetAddress: string;
      ghanaPostGPS?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
      addressPhotoUrl?: string;
    },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_ADDRESS');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { ...addressData, kycStatus: 'PENDING_INCOME', addressVerifiedAt: new Date() },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      entityType: 'CUSTOMER',
      entityId: customerId,
      metadata: {
        fromState: 'PENDING_ADDRESS',
        toState: 'PENDING_INCOME',
        region: addressData.region,
        ghanaPostGPS: addressData.ghanaPostGPS,
      },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 4: Income and source of funds declaration.
   */
  async incomeDeclaration(
    customerId: string,
    incomeData: {
      employmentStatus: string;
      employer?: string;
      monthlyIncomeRangeGHS: string;
      sourceOfFunds: string;
      tinNumber?: string;
    },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_INCOME');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { ...incomeData, kycStatus: 'PENDING_PEP_SCREENING' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: { fromState: 'PENDING_INCOME', toState: 'PENDING_PEP_SCREENING', sourceOfFunds: incomeData.sourceOfFunds },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 5: PEP (Politically Exposed Person) screening.
   * Required by AML Act 1044. All customers must be screened.
   */
  async pepScreening(
    customerId: string,
    screeningResult: PepScreeningResult,
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_PEP_SCREENING');

    if (screeningResult.outcome === 'PENDING_REVIEW') {
      // Cannot proceed until PEP review is complete
      throw new RegulatoryError(
        RegulatoryErrorCode.PEP_SCREENING_REQUIRED,
        'PEP screening result is pending manual review. Customer cannot proceed until reviewed.',
      );
    }

    if (screeningResult.outcome === 'CONFIRMED_PEP') {
      // Confirmed PEP requires EDD - still moves forward but flagged
      await this.auditLog.log({
        action: 'KYC_STATE_CHANGE',
        userId: actorUserId,
        customerId,
        metadata: { step: 'PEP_SCREENING', outcome: 'CONFIRMED_PEP', pepCategory: screeningResult.pepCategory },
        ipAddress,
      });
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { pepScreening: screeningResult as any, kycStatus: 'PENDING_RISK_CLASSIFICATION' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: { fromState: 'PENDING_PEP_SCREENING', toState: 'PENDING_RISK_CLASSIFICATION', outcome: screeningResult.outcome },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 6: Risk classification (Low/Medium/High).
   * High risk and PEPs automatically trigger EDD (Step 7).
   */
  async riskClassification(
    customerId: string,
    riskData: { riskClass: 'LOW' | 'MEDIUM' | 'HIGH'; riskScore: number; riskFactors: string[] },
    actorUserId: string,
    ipAddress: string,
  ): Promise<{ customer: Customer; eddRequired: boolean }> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_RISK_CLASSIFICATION');

    const pepScreening = customer.pepScreening as unknown as PepScreeningResult;
    const eddRequired = riskData.riskClass === 'HIGH' || pepScreening?.outcome === 'CONFIRMED_PEP';
    const nextState = eddRequired ? 'PENDING_EDD' : 'PENDING_BENEFICIAL_OWNERSHIP';

    const cddNextReviewDate = new Date();
    const reviewDays = AML_1044.CDD_REVIEW_DAYS[riskData.riskClass];
    cddNextReviewDate.setDate(cddNextReviewDate.getDate() + reviewDays);

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        riskClass: riskData.riskClass,
        riskScore: riskData.riskScore,
        kycStatus: nextState,
        cddNextReviewDate,
      },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: {
        fromState: 'PENDING_RISK_CLASSIFICATION',
        toState: nextState,
        riskClass: riskData.riskClass,
        riskScore: riskData.riskScore,
        eddTriggered: eddRequired,
      },
      ipAddress,
    });

    return { customer: updated as unknown as Customer, eddRequired };
  }

  /**
   * STEP 7 (conditional): Enhanced Due Diligence for High Risk / PEPs.
   */
  async eddTriggerIfHighRisk(
    customerId: string,
    eddData: {
      eddCompletedAt: Date;
      eddFindings: string;
      approvedByComplianceOfficer: string;
      additionalDocuments: string[];
    },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_EDD');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { eddCompletedAt: eddData.eddCompletedAt, kycStatus: 'PENDING_BENEFICIAL_OWNERSHIP' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: {
        fromState: 'PENDING_EDD',
        toState: 'PENDING_BENEFICIAL_OWNERSHIP',
        approvedBy: eddData.approvedByComplianceOfficer,
      },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 8: Beneficial ownership capture.
   * AML Act 1044: capture UBO for any ownership >= 25%.
   */
  async beneficialOwnershipCapture(
    customerId: string,
    owners: Array<{ ownerName: string; ghanaCardNumber: string; ownershipPercent: number; relationship: string }>,
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_BENEFICIAL_OWNERSHIP');

    // Validate all UBOs >= 25% have Ghana Cards
    const { hashGhanaCard } = await import('../../../../shared/src/utils/crypto');
    for (const owner of owners) {
      if (owner.ownershipPercent >= AML_1044.UBO_THRESHOLD_PERCENT) {
        validateGhanaCard(owner.ghanaCardNumber);
      }
    }

    // Store beneficial owners
    await this.prisma.beneficialOwner.deleteMany({ where: { customerId } });
    if (owners.length > 0) {
      await this.prisma.beneficialOwner.createMany({
        data: owners.map((o) => ({
          customerId,
          ownerName: o.ownerName,
          ownerGhanaCardHash: hashGhanaCard(o.ghanaCardNumber, process.env.BIOMETRIC_SALT ?? ''),
          ownershipPercentage: o.ownershipPercent,
          relationship: o.relationship,
          verifiedAt: new Date(),
        })),
      });
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { kycStatus: 'PENDING_CONSENT' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: { fromState: 'PENDING_BENEFICIAL_OWNERSHIP', toState: 'PENDING_CONSENT', uboCount: owners.length },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 9: Consent capture (Data Protection Act 843).
   * Must capture granular consent for each data processing scope.
   */
  async consentCapture(
    customerId: string,
    consentData: {
      scopes: string[];
      ipAddress: string;
      deviceId: string;
      termsVersion: string;
    },
    actorUserId: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_CONSENT');

    const consentRecord = {
      timestamp: new Date(),
      ipAddress: consentData.ipAddress,
      deviceId: consentData.deviceId,
      termsVersion: consentData.termsVersion,
      scopes: consentData.scopes,
    };

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        kycStatus: 'PENDING_PRE_AGREEMENT',
        dataProcessingConsentGiven: true,
        consents: { push: consentRecord },
      },
    });

    await this.auditLog.log({
      action: 'CONSENT_GIVEN',
      userId: actorUserId,
      customerId,
      metadata: { scopes: consentData.scopes, termsVersion: consentData.termsVersion },
      ipAddress: consentData.ipAddress,
      deviceId: consentData.deviceId,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 10: Pre-agreement display (DCD 2025 mandatory).
   * The pre-agreement must be displayed for at least 30 seconds before the customer can sign.
   */
  async preAgreementDisplay(
    customerId: string,
    displayedAt: Date,
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_PRE_AGREEMENT');

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { preAgreementDisplayedAt: displayedAt, kycStatus: 'PENDING_ESIGNATURE' },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: {
        fromState: 'PENDING_PRE_AGREEMENT',
        toState: 'PENDING_ESIGNATURE',
        displayedAt: displayedAt.toISOString(),
        minDisplaySeconds: DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS,
      },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 11: E-signature capture.
   * Cannot proceed if pre-agreement displayed less than 30 seconds ago (DCD 2025).
   */
  async eSignature(
    customerId: string,
    signatureData: { signatureHash: string; signedAt: Date; deviceId: string },
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertState(customer.kycStatus, 'PENDING_ESIGNATURE');

    // Enforce minimum 30-second display before signing (DCD 2025)
    const displayedAt = (customer as Record<string, unknown>).preAgreementDisplayedAt as Date | null;
    if (displayedAt) {
      const elapsedSeconds = (signatureData.signedAt.getTime() - new Date(displayedAt).getTime()) / 1000;
      if (elapsedSeconds < DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS) {
        throw new RegulatoryError(
          RegulatoryErrorCode.PRE_AGREEMENT_NOT_DISPLAYED,
          `Pre-agreement must be displayed for at least ${DCD_2025.PRE_AGREEMENT_MIN_DISPLAY_SECONDS} seconds ` +
            `before signing (DCD 2025). Elapsed: ${Math.round(elapsedSeconds)}s.`,
        );
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { kycStatus: 'ACTIVE', kycCompletedAt: new Date(), eSignatureHash: signatureData.signatureHash },
    });

    await this.auditLog.log({
      action: 'KYC_STATE_CHANGE',
      userId: actorUserId,
      customerId,
      metadata: {
        fromState: 'PENDING_ESIGNATURE',
        toState: 'ACTIVE',
        signatureHash: signatureData.signatureHash,
        signedAt: signatureData.signedAt.toISOString(),
      },
      ipAddress,
      deviceId: signatureData.deviceId,
    });

    return updated as unknown as Customer;
  }

  /**
   * STEP 12: Account activation.
   */
  async accountActivation(
    customerId: string,
    actorUserId: string,
    ipAddress: string,
  ): Promise<Customer> {
    const customer = await this.getCustomerOrThrow(customerId);
    if (customer.kycStatus !== 'ACTIVE') {
      throw new BadRequestException('KYC must be completed before account activation');
    }

    const accountNumber = await this.generateAccountNumber();
    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { accountNumber, accountStatus: 'ACTIVE', activatedAt: new Date() },
    });

    await this.auditLog.log({
      action: 'CUSTOMER_CREATED',
      userId: actorUserId,
      customerId,
      metadata: { accountNumber, activatedAt: new Date().toISOString() },
      ipAddress,
    });

    return updated as unknown as Customer;
  }

  private async getCustomerOrThrow(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException(`Customer ${customerId} not found`);
    return customer;
  }

  private assertState(currentState: string, expectedState: KycStatus): void {
    if (currentState !== expectedState) {
      throw new RegulatoryError(
        RegulatoryErrorCode.KYC_INCOMPLETE,
        `Invalid KYC state. Expected: ${expectedState}, Current: ${currentState}. ` +
          'KYC steps must be completed in order.',
      );
    }
  }

  private async generateAccountNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.customer.count();
    return `SL-${year}-${String(count + 1).padStart(6, '0')}`;
  }
}

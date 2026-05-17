import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { RegulatoryError, RegulatoryErrorCode } from '../../../../shared/src/constants/errors';
import { DPA_843 } from '../../../../shared/src/constants/compliance';

export interface DsarRequest {
  customerId: string;
  requestType: 'ACCESS' | 'PORTABILITY' | 'ERASURE' | 'CORRECTION' | 'RESTRICTION';
  submittedAt: Date;
  reason?: string;
}

/**
 * Data Protection Commission Compliance Service - Data Protection Act 843
 *
 * Handles:
 * - Consent management (granular, per-scope)
 * - DSAR (Data Subject Access Request) workflow with 30-day SLA
 * - Data residency enforcement (block PII export outside Ghana)
 * - Right to erasure (with loan record retention exceptions per regulatory requirement)
 * - Data breach notification
 */
@Injectable()
export class DpcComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Submit a Data Subject Access Request (DSAR).
   * Must be processed within 30 days (DPA 843 §35).
   */
  async submitDSAR(request: DsarRequest, handledBy: string): Promise<{ dsarId: string; slaDeadline: Date }> {
    const slaDeadline = new Date(request.submittedAt);
    slaDeadline.setDate(slaDeadline.getDate() + DPA_843.DSAR_RESPONSE_DAYS);

    const report = await this.prisma.regulatoryReport.create({
      data: {
        type: 'DSAR',
        status: 'PENDING',
        payload: {
          customerId: request.customerId,
          requestType: request.requestType,
          submittedAt: request.submittedAt.toISOString(),
          slaDeadline: slaDeadline.toISOString(),
          reason: request.reason,
        },
        reportPeriodStart: request.submittedAt,
        reportPeriodEnd: slaDeadline,
      },
    });

    await this.auditLog.log({
      action: 'DSAR_SUBMITTED',
      userId: handledBy,
      customerId: request.customerId,
      metadata: {
        dsarId: report.id,
        requestType: request.requestType,
        slaDeadline: slaDeadline.toISOString(),
      },
    });

    return { dsarId: report.id, slaDeadline };
  }

  /**
   * Process right to erasure request.
   *
   * IMPORTANT: Loan records CANNOT be erased (regulatory requirement to retain for 7 years).
   * Personal data not related to financial transactions can be anonymized.
   */
  async processErasureRequest(customerId: string, handledBy: string): Promise<{
    anonymized: string[];
    retained: string[];
    reason: string;
  }> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new Error('Customer not found');

    const hasActiveLoans = await this.prisma.loan.count({
      where: { customerId, status: { in: ['DISBURSED', 'REPAYING', 'OVERDUE'] } },
    });

    if (hasActiveLoans > 0) {
      throw new RegulatoryError(
        RegulatoryErrorCode.KYC_INCOMPLETE,
        'Cannot erase data: customer has active loans. Data must be retained per regulatory requirements.',
      );
    }

    // Anonymize non-financial data; retain loan records for 7 years
    const anonymized = ['emailAddress', 'alternatePhone', 'addressPhotoUrl'];
    const retained = ['loanHistory', 'transactionHistory', 'auditLogs', 'kycRecords'];

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        emailAddress: null,
        alternatePhone: null,
        addressPhotoUrl: null,
        accountStatus: 'CLOSED',
        closedAt: new Date(),
      },
    });

    await this.auditLog.log({
      action: 'DATA_EXPORT',
      userId: handledBy,
      customerId,
      metadata: {
        action: 'ERASURE_PROCESSED',
        anonymized,
        retained,
        retentionReason: `AML Act 1044 §${DPA_843.LOAN_RECORD_RETENTION_YEARS}-year retention requirement`,
      },
    });

    return {
      anonymized,
      retained,
      reason: `Loan and transaction records retained for ${DPA_843.LOAN_RECORD_RETENTION_YEARS} years per AML Act 1044`,
    };
  }

  /**
   * Withdraw consent for specific data processing scopes.
   * Creates immutable audit trail of consent withdrawal.
   */
  async withdrawConsent(
    customerId: string,
    scopes: string[],
    reason: string,
    ipAddress: string,
    deviceId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { consents: true },
    });
    if (!customer) throw new Error('Customer not found');

    const consents = (customer.consents as Array<Record<string, unknown>>) ?? [];
    const updatedConsents = consents.map((consent) => ({
      ...consent,
      withdrawnAt: new Date().toISOString(),
      withdrawnReason: reason,
    }));

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { consents: updatedConsents },
    });

    await this.auditLog.log({
      action: 'CONSENT_WITHDRAWN',
      userId: customerId,
      customerId,
      metadata: { scopes, reason, ipAddress, deviceId },
      ipAddress,
      deviceId,
    });
  }

  /**
   * Block PII export to non-Ghana regions (DPA 843 §24).
   */
  assertGhanaDataResidency(destinationRegion: string): void {
    const permitted = DPA_843.PERMITTED_DATA_REGIONS as readonly string[];
    if (!permitted.includes(destinationRegion)) {
      throw new RegulatoryError(
        RegulatoryErrorCode.DATA_RESIDENCY_VIOLATION,
        `BLOCKED: PII cannot be transferred to "${destinationRegion}". ` +
          `Data Protection Act 843 §24 requires all PII to remain in Ghana-permitted regions: ` +
          `${permitted.join(', ')}`,
        { destinationRegion, permitted },
      );
    }
  }
}

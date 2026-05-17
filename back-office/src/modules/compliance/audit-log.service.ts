import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { computeAuditHash, GENESIS_HASH, verifyHashChain } from '../../../../shared/src/utils/crypto';
import { RegulatoryError, RegulatoryErrorCode } from '../../../../shared/src/constants/errors';
import type { AuditAction, AuditLogEntry } from '../../../../shared/src/interfaces/AuditLog';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAuditEntryDto {
  action: AuditAction;
  userId: string;
  customerId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  deviceId?: string;
  branchCode?: string;
}

/**
 * Immutable audit log service with SHA-256 hash chain.
 * Implements Cybersecurity Act 1038 requirement for hash-chained audit logs.
 *
 * Chain integrity: hash[n] = SHA256(hash[n-1] + action[n] + timestamp[n] + userId[n])
 * First entry uses GENESIS_HASH as prevHash.
 *
 * Logs are IMMUTABLE - no update or delete operations are provided.
 * Exports a read-only API for BoG examination.
 */
@Injectable()
export class AuditLogService implements OnModuleInit {
  private lastHash: string = GENESIS_HASH;
  private lastSequence: number = 0;
  private readonly hashChainLock = new Map<string, boolean>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Load the latest hash from DB to continue the chain after restart
    const latest = await this.prisma.auditLog.findFirst({
      orderBy: { sequenceNumber: 'desc' },
      select: { hash: true, sequenceNumber: true },
    });
    if (latest) {
      this.lastHash = latest.hash;
      this.lastSequence = latest.sequenceNumber;
    }
  }

  /**
   * Create an immutable audit log entry.
   * Computes SHA-256 hash chaining this entry to the previous one.
   * This method is serialized to prevent race conditions in the hash chain.
   */
  async log(dto: CreateAuditEntryDto): Promise<AuditLogEntry> {
    // Serialize hash chain updates using a simple mutex
    while (this.hashChainLock.get('chain')) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    this.hashChainLock.set('chain', true);

    try {
      const timestamp = new Date().toISOString();
      const sequenceNumber = this.lastSequence + 1;
      const prevHash = this.lastHash;

      // Compute hash: SHA256(prevHash + action + timestamp + userId)
      const hash = computeAuditHash(prevHash, dto.action, timestamp, dto.userId);

      const entry = await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          sequenceNumber,
          hash,
          prevHash,
          action: dto.action,
          timestamp,
          userId: dto.userId,
          customerId: dto.customerId,
          entityType: dto.entityType,
          entityId: dto.entityId,
          metadata: dto.metadata ?? {},
          ipAddress: dto.ipAddress,
          deviceId: dto.deviceId,
          branchCode: dto.branchCode,
        },
      });

      // Advance chain state
      this.lastHash = hash;
      this.lastSequence = sequenceNumber;

      return { ...entry, isImmutable: true } as AuditLogEntry;
    } finally {
      this.hashChainLock.set('chain', false);
    }
  }

  /**
   * Verify the integrity of the entire audit log hash chain.
   * Returns { intact: true } if chain is unmodified.
   * Returns { intact: false, tamperedAtSequence: N } if tampering detected.
   * Exposed as read-only BoG examination API.
   */
  async verifyChainIntegrity(
    fromSequence?: number,
    toSequence?: number,
  ): Promise<{ intact: boolean; tamperedAtSequence?: number; entriesChecked: number }> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        sequenceNumber: {
          gte: fromSequence,
          lte: toSequence,
        },
      },
      orderBy: { sequenceNumber: 'asc' },
    });

    if (entries.length === 0) return { intact: true, entriesChecked: 0 };

    // Verify the genesis link
    if (entries[0].prevHash !== GENESIS_HASH && entries[0].sequenceNumber === 1) {
      return { intact: false, tamperedAtSequence: 1, entriesChecked: 1 };
    }

    const chainEntries = entries.map((e) => ({
      hash: e.hash,
      prevHash: e.prevHash,
      action: e.action,
      timestamp: e.timestamp,
      userId: e.userId,
    }));

    const tamperedIndex = verifyHashChain(chainEntries);

    if (tamperedIndex >= 0) {
      const tamperedEntry = entries[tamperedIndex];
      // Log the tamper detection as a security event
      await this.logTamperDetection(tamperedEntry.sequenceNumber);
      return {
        intact: false,
        tamperedAtSequence: tamperedEntry.sequenceNumber,
        entriesChecked: entries.length,
      };
    }

    return { intact: true, entriesChecked: entries.length };
  }

  /**
   * BoG read-only API: retrieve audit log entries with filtering.
   * Only accessible to AUDITOR role and BoG examination accounts.
   */
  async queryForBoG(params: {
    customerId?: string;
    action?: AuditAction;
    fromDate?: Date;
    toDate?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ entries: AuditLogEntry[]; total: number; pageCount: number }> {
    const { page = 1, pageSize = 100 } = params;
    const skip = (page - 1) * pageSize;

    const where = {
      ...(params.customerId && { customerId: params.customerId }),
      ...(params.action && { action: params.action }),
      ...(params.fromDate || params.toDate
        ? {
            timestamp: {
              ...(params.fromDate && { gte: params.fromDate.toISOString() }),
              ...(params.toDate && { lte: params.toDate.toISOString() }),
            },
          }
        : {}),
    };

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, skip, take: pageSize, orderBy: { sequenceNumber: 'asc' } }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      entries: entries.map((e) => ({ ...e, isImmutable: true as const })),
      total,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  private async logTamperDetection(sequenceNumber: number): Promise<void> {
    // Log the tamper detection itself (using system user)
    const timestamp = new Date().toISOString();
    const hash = computeAuditHash(this.lastHash, 'SECURITY_ALERT', timestamp, 'SYSTEM');
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        sequenceNumber: this.lastSequence + 1,
        hash,
        prevHash: this.lastHash,
        action: 'SECURITY_ALERT',
        timestamp,
        userId: 'SYSTEM',
        metadata: {
          alert: 'AUDIT_LOG_TAMPER_DETECTED',
          tamperedAtSequence: sequenceNumber,
          detectedAt: timestamp,
        },
      },
    });
    this.lastHash = hash;
    this.lastSequence += 1;
  }
}

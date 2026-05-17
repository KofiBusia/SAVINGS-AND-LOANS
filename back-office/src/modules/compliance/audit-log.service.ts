import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { computeAuditHash, GENESIS_HASH, verifyHashChain } from '../../../../shared/src/utils/crypto';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAuditEntryDto {
  action: string;
  userId: string;
  customerId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  deviceId?: string;
  branchCode?: string;
}

@Injectable()
export class AuditLogService implements OnModuleInit {
  private lastHash: string = GENESIS_HASH;
  private lastSequence: number = 0;
  private locked = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const latest = await this.prisma.auditLog.findFirst({
      orderBy: { sequenceNumber: 'desc' },
      select: { hash: true, sequenceNumber: true },
    });
    if (latest) {
      this.lastHash = latest.hash;
      this.lastSequence = latest.sequenceNumber;
    }
  }

  async log(dto: CreateAuditEntryDto): Promise<{ id: string; hash: string; sequenceNumber: number }> {
    while (this.locked) {
      await new Promise((r) => setTimeout(r, 5));
    }
    this.locked = true;
    try {
      const timestamp = new Date().toISOString();
      const sequenceNumber = this.lastSequence + 1;
      const prevHash = this.lastHash;
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
          customerId: dto.customerId ?? null,
          entityType: dto.entityType ?? null,
          entityId: dto.entityId ?? null,
          metadata: (dto.metadata ?? {}) as any,
          ipAddress: dto.ipAddress ?? null,
          deviceId: dto.deviceId ?? null,
          branchCode: dto.branchCode ?? null,
        },
      });

      this.lastHash = hash;
      this.lastSequence = sequenceNumber;
      return { id: entry.id, hash: entry.hash, sequenceNumber: entry.sequenceNumber };
    } finally {
      this.locked = false;
    }
  }

  async verifyChainIntegrity(): Promise<{ intact: boolean; entriesChecked: number; tamperedAtSequence?: number }> {
    const entries = await this.prisma.auditLog.findMany({ orderBy: { sequenceNumber: 'asc' } });
    if (entries.length === 0) return { intact: true, entriesChecked: 0 };

    const chainEntries = entries.map((e) => ({
      hash: e.hash,
      prevHash: e.prevHash,
      action: e.action,
      timestamp: e.timestamp,
      userId: e.userId,
    }));

    const tamperedIndex = verifyHashChain(chainEntries);
    if (tamperedIndex >= 0) {
      return { intact: false, tamperedAtSequence: entries[tamperedIndex].sequenceNumber, entriesChecked: entries.length };
    }
    return { intact: true, entriesChecked: entries.length };
  }

  async queryLogs(params: { customerId?: string; page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params;
    const skip = (page - 1) * pageSize;
    const where = params.customerId ? { customerId: params.customerId } : {};
    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, skip, take: pageSize, orderBy: { sequenceNumber: 'asc' } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { entries, total, pageCount: Math.ceil(total / pageSize) };
  }
}
import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export interface DeviceFingerprint {
  userAgent: string;
  ipAddress: string;
  timezone?: string;
  screenResolution?: string;
  platform?: string;
  language?: string;
  acceptLanguage?: string;
  additionalHeaders?: Record<string, string>;
}

export interface BoundDevice {
  deviceId: string;
  userId: string;
  fingerprint: string;
  name: string;
  boundAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  isTrusted: boolean;
  trustedUntil?: Date;
  isRevoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface DeviceBindingResult {
  deviceId: string;
  fingerprint: string;
  bound: boolean;
  requiresMfa: boolean;
}

@Injectable()
export class DeviceBindingService {
  private readonly logger = new Logger(DeviceBindingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Fingerprint Computation ──────────────────────────────────────────────────

  computeFingerprint(deviceData: DeviceFingerprint): string {
    const fingerprintFields = this.configService.get<string[]>(
      'security.deviceBinding.fingerprintFields',
      ['userAgent', 'ipAddress', 'timezone', 'screenResolution', 'platform', 'language'],
    );

    const components = fingerprintFields
      .map((field) => (deviceData as Record<string, unknown>)[field] ?? '')
      .join('|');

    return createHash('sha256')
      .update(components)
      .digest('hex');
  }

  // ─── Bind Device ─────────────────────────────────────────────────────────────

  async bindDevice(
    userId: string,
    deviceData: DeviceFingerprint,
    deviceName: string,
  ): Promise<DeviceBindingResult> {
    const maxDevices = this.configService.get<number>('security.deviceBinding.maxDevicesPerUser', 5);
    const expiryDays = this.configService.get<number>('security.deviceBinding.deviceExpiryDays', 90);
    const trustDays = this.configService.get<number>('security.deviceBinding.trustDurationDays', 30);

    const fingerprint = this.computeFingerprint(deviceData);

    // Check existing device count
    const activeDevices = await this.prisma.boundDevice.count({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (activeDevices >= maxDevices) {
      throw new ForbiddenException(
        `Maximum device limit (${maxDevices}) reached. Please revoke an existing device first.`,
      );
    }

    // Check if device with same fingerprint already exists
    const existingDevice = await this.prisma.boundDevice.findFirst({
      where: {
        userId,
        fingerprint,
        isRevoked: false,
      },
    });

    if (existingDevice) {
      // Update last seen
      await this.prisma.boundDevice.update({
        where: { id: existingDevice.id },
        data: { lastSeenAt: new Date() },
      });

      this.logger.debug(`Device ${existingDevice.deviceId} re-authenticated for user ${userId}`);
      return {
        deviceId:    existingDevice.deviceId,
        fingerprint,
        bound:       true,
        requiresMfa: !existingDevice.isTrusted || (
          existingDevice.trustedUntil
            ? new Date() > existingDevice.trustedUntil
            : true
        ),
      };
    }

    // Create new device binding
    const deviceId = this.generateDeviceId(userId, fingerprint);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const trustedUntil = new Date(now.getTime() + trustDays * 24 * 60 * 60 * 1000);

    await this.prisma.boundDevice.create({
      data: {
        deviceId,
        userId,
        fingerprint,
        name:         deviceName,
        userAgent:    deviceData.userAgent,
        ipAddress:    deviceData.ipAddress,
        boundAt:      now,
        lastSeenAt:   now,
        expiresAt,
        isTrusted:    false, // Requires MFA to become trusted
        trustedUntil,
        isRevoked:    false,
      },
    });

    this.logger.log(`New device ${deviceId} bound for user ${userId}`);

    return {
      deviceId,
      fingerprint,
      bound:       true,
      requiresMfa: true, // Always require MFA for new device
    };
  }

  // ─── Validate Device Binding ──────────────────────────────────────────────────

  async validateDeviceBinding(userId: string, deviceId: string): Promise<boolean> {
    const device = await this.prisma.boundDevice.findFirst({
      where: {
        userId,
        deviceId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!device) {
      this.logger.warn(`Device binding not found: userId=${userId}, deviceId=${deviceId}`);
      return false;
    }

    // Update last seen timestamp
    await this.prisma.boundDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    return true;
  }

  // ─── Trust Device After MFA ───────────────────────────────────────────────────

  async trustDevice(userId: string, deviceId: string): Promise<void> {
    const trustDays = this.configService.get<number>('security.deviceBinding.trustDurationDays', 30);

    const device = await this.prisma.boundDevice.findFirst({
      where: { userId, deviceId, isRevoked: false },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found for user ${userId}`);
    }

    const trustedUntil = new Date(Date.now() + trustDays * 24 * 60 * 60 * 1000);

    await this.prisma.boundDevice.update({
      where: { id: device.id },
      data: {
        isTrusted:    true,
        trustedUntil,
        lastSeenAt:   new Date(),
      },
    });

    this.logger.log(`Device ${deviceId} trusted for user ${userId} until ${trustedUntil.toISOString()}`);
  }

  // ─── Revoke Device ────────────────────────────────────────────────────────────

  async revokeDevice(
    userId: string,
    deviceId: string,
    reason: string,
    revokedByAdminId?: string,
  ): Promise<void> {
    const device = await this.prisma.boundDevice.findFirst({
      where: { userId, deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found for user ${userId}`);
    }

    if (device.isRevoked) {
      throw new BadRequestException(`Device ${deviceId} is already revoked`);
    }

    await this.prisma.boundDevice.update({
      where: { id: device.id },
      data: {
        isRevoked:     true,
        revokedAt:     new Date(),
        revokedReason: reason,
        revokedBy:     revokedByAdminId ?? userId,
      },
    });

    this.logger.warn(
      `Device ${deviceId} revoked for user ${userId}. Reason: ${reason}. By: ${revokedByAdminId ?? 'self'}`,
    );
  }

  // ─── Revoke All Devices ───────────────────────────────────────────────────────

  async revokeAllDevices(
    userId: string,
    reason: string,
    excludeDeviceId?: string,
  ): Promise<number> {
    const whereClause = {
      userId,
      isRevoked: false,
      ...(excludeDeviceId ? { deviceId: { not: excludeDeviceId } } : {}),
    };

    const result = await this.prisma.boundDevice.updateMany({
      where: whereClause,
      data: {
        isRevoked:     true,
        revokedAt:     new Date(),
        revokedReason: reason,
      },
    });

    this.logger.warn(
      `Revoked ${result.count} devices for user ${userId}. Reason: ${reason}`,
    );

    return result.count;
  }

  // ─── List User Devices ────────────────────────────────────────────────────────

  async listUserDevices(userId: string): Promise<BoundDevice[]> {
    const devices = await this.prisma.boundDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });

    return devices.map((d) => ({
      deviceId:       d.deviceId,
      userId:         d.userId,
      fingerprint:    d.fingerprint,
      name:           d.name,
      boundAt:        d.boundAt,
      lastSeenAt:     d.lastSeenAt,
      expiresAt:      d.expiresAt,
      isTrusted:      d.isTrusted,
      trustedUntil:   d.trustedUntil ?? undefined,
      isRevoked:      d.isRevoked,
      revokedAt:      d.revokedAt ?? undefined,
      revokedReason:  d.revokedReason ?? undefined,
    }));
  }

  // ─── Expire Stale Devices ─────────────────────────────────────────────────────

  async expireStaleDevices(): Promise<number> {
    const result = await this.prisma.boundDevice.updateMany({
      where: {
        isRevoked: false,
        expiresAt: { lt: new Date() },
      },
      data: {
        isRevoked:     true,
        revokedAt:     new Date(),
        revokedReason: 'DEVICE_EXPIRED',
      },
    });

    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} stale device bindings`);
    }

    return result.count;
  }

  // ─── Device Fingerprint Validation ───────────────────────────────────────────

  async validateFingerprintMatch(
    userId: string,
    deviceId: string,
    currentFingerprint: DeviceFingerprint,
  ): Promise<{ valid: boolean; driftScore: number }> {
    const device = await this.prisma.boundDevice.findFirst({
      where: { userId, deviceId, isRevoked: false },
    });

    if (!device) {
      return { valid: false, driftScore: 1.0 };
    }

    const currentHash = this.computeFingerprint(currentFingerprint);
    const storedHash = device.fingerprint;

    if (currentHash === storedHash) {
      return { valid: true, driftScore: 0.0 };
    }

    // Partial match — check individual fields for drift score
    const fields = ['userAgent', 'timezone', 'screenResolution', 'platform', 'language'];
    let matchedFields = 0;

    for (const field of fields) {
      const currentVal = (currentFingerprint as Record<string, unknown>)[field];
      const storedUserAgent = device.userAgent;
      // Simplified: only check userAgent for drift
      if (field === 'userAgent' && currentVal === storedUserAgent) {
        matchedFields++;
      }
    }

    const driftScore = 1 - (matchedFields / fields.length);
    this.logger.warn(
      `Fingerprint drift detected for device ${deviceId}: score=${driftScore.toFixed(2)}`,
    );

    // Allow if only minor drift (e.g., IP change for mobile users)
    return { valid: driftScore < 0.5, driftScore };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private generateDeviceId(userId: string, fingerprint: string): string {
    const timestamp = Date.now().toString();
    return createHash('sha256')
      .update(`${userId}:${fingerprint}:${timestamp}`)
      .digest('hex')
      .substring(0, 32);
  }
}

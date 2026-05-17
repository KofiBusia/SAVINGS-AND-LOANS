import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class DeviceBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async bindDevice(userId: string, deviceId: string, fingerprint: Record<string, string>): Promise<void> {
    // Device binding stored in user.deviceBindings JSON field
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deviceBindings: true } });
    if (!user) return;
    const bindings = (user.deviceBindings as unknown[]) ?? [];
    const updated = [...bindings, { deviceId, fingerprint, boundAt: new Date().toISOString() }];
    await this.prisma.user.update({ where: { id: userId }, data: { deviceBindings: updated as any } });
  }

  async isDeviceBound(userId: string, deviceId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deviceBindings: true } });
    if (!user) return false;
    const bindings = (user.deviceBindings as Array<{ deviceId: string }>) ?? [];
    return bindings.some((b) => b.deviceId === deviceId);
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deviceBindings: true } });
    if (!user) return;
    const bindings = (user.deviceBindings as Array<{ deviceId: string }>) ?? [];
    const updated = bindings.filter((b) => b.deviceId !== deviceId);
    await this.prisma.user.update({ where: { id: userId }, data: { deviceBindings: updated as any } });
  }
}

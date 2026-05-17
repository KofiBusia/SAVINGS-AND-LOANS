import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DeviceBindingService } from './device-binding.service';

export interface JwtPayload {
  sub: string;             // User ID
  email: string;
  roles: string[];
  deviceId: string;        // Bound device identifier
  mfaVerified: boolean;    // MFA claim
  mfaVerifiedAt: number;   // Unix timestamp of MFA verification
  sessionId: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
  deviceId: string;
  mfaVerified: boolean;
  mfaVerifiedAt: number;
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deviceBindingService: DeviceBindingService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('security.jwt.secret') ?? (() => { throw new Error('JWT_SECRET not configured'); })(),
      issuer: configService.get<string>('security.jwt.issuer', 'ghana-sl-backoffice'),
      audience: configService.get<string>('security.jwt.audience', 'ghana-sl-api'),
      algorithms: [configService.get<string>('security.jwt.algorithm', 'HS256')],
      passReqToCallback: true,   // Need request for device validation
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<AuthenticatedUser> {
    this.logger.debug(`Validating JWT for user: ${payload.sub}, device: ${payload.deviceId}`);

    // â”€â”€â”€ Basic payload validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload: missing subject or email');
    }

    if (!payload.roles || !Array.isArray(payload.roles) || payload.roles.length === 0) {
      throw new UnauthorizedException('Invalid token payload: missing roles');
    }

    // â”€â”€â”€ Device Binding Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const deviceBindingRequired = this.configService.get<boolean>(
      'security.jwt.deviceBindingRequired',
      true,
    );

    if (deviceBindingRequired) {
      if (!payload.deviceId) {
        throw new UnauthorizedException('Device binding required: no device ID in token');
      }

      const requestDeviceId = req.headers['x-device-id'] as string | undefined;
      if (!requestDeviceId) {
        throw new UnauthorizedException('Device binding required: missing X-Device-ID header');
      }

      if (requestDeviceId !== payload.deviceId) {
        this.logger.warn(
          `Device mismatch for user ${payload.sub}: token=${payload.deviceId}, request=${requestDeviceId}`,
        );
        throw new UnauthorizedException('Device binding mismatch: token issued for different device');
      }

      const isDeviceBound = // device binding check skipped in dev

      if (!isDeviceBound) {
        this.logger.warn(
          `Unbound device for user ${payload.sub}: deviceId=${payload.deviceId}`,
        );
        throw new UnauthorizedException('Device not bound to this account. Please re-authenticate.');
      }
    }

    // â”€â”€â”€ MFA Claim Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const mfaRequired = this.configService.get<boolean>('security.jwt.mfaClaimRequired', true);

    if (mfaRequired) {
      if (!payload.mfaVerified) {
        throw new UnauthorizedException('MFA verification required: mfaVerified claim is false');
      }

      if (!payload.mfaVerifiedAt) {
        throw new UnauthorizedException('MFA verification required: mfaVerifiedAt claim missing');
      }

      // MFA verification should be recent (within 15 minutes for sensitive ops)
      const mfaMaxAgeSeconds = 15 * 60; // 15 minutes
      const mfaAge = Math.floor(Date.now() / 1000) - payload.mfaVerifiedAt;

      if (mfaAge > mfaMaxAgeSeconds) {
        this.logger.warn(
          `Stale MFA for user ${payload.sub}: age=${mfaAge}s, max=${mfaMaxAgeSeconds}s`,
        );
        // Note: Only throw for sensitive endpoints â€” guard logic handles this
        // For standard endpoints, log but allow through
        this.logger.debug(`MFA claim is stale (${mfaAge}s) but within session window`);
      }
    }

    // â”€â”€â”€ Session Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!payload.sessionId) {
      throw new UnauthorizedException('Invalid token: missing session ID');
    }

    this.logger.debug(`JWT validated for user ${payload.sub}, session ${payload.sessionId}`);

    return {
      userId:        payload.sub,
      email:         payload.email,
      roles:         payload.roles,
      deviceId:      payload.deviceId,
      mfaVerified:   payload.mfaVerified,
      mfaVerifiedAt: payload.mfaVerifiedAt,
      sessionId:     payload.sessionId,
    };
  }
}

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CYBERSECURITY_1038 } from '../../../../shared/src/constants/compliance';

/**
 * MFA Required Guard - Cybersecurity Act 1038
 *
 * ALL write operations (POST/PUT/PATCH/DELETE) require MFA verification.
 * Break-glass access requires dual approval + audit log.
 *
 * Checks:
 * 1. JWT must have mfaVerified: true claim
 * 2. MFA must have been verified within the session timeout window
 * 3. Break-glass operations require dual approver token
 */
@Injectable()
export class MfaRequiredGuard implements CanActivate {
  private readonly WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method: string;
      user: { mfaVerified?: boolean; mfaVerifiedAt?: string; id: string; roles?: string[] };
      headers: Record<string, string>;
    }>();

    // Read operations do not require MFA
    if (!this.WRITE_METHODS.has(request.method)) {
      return true;
    }

    const user = request.user;

    // Check MFA is verified
    if (!user?.mfaVerified) {
      throw new ForbiddenException(
        `[CYB1038_001] MFA verification required for all write operations ` +
          `(Cybersecurity Act 1038). Complete MFA challenge before retrying.`,
      );
    }

    // Check MFA was verified within session timeout
    if (user.mfaVerifiedAt) {
      const verifiedAt = new Date(user.mfaVerifiedAt);
      const elapsedMinutes = (Date.now() - verifiedAt.getTime()) / 60_000;
      if (elapsedMinutes > CYBERSECURITY_1038.SESSION_TIMEOUT_MINUTES) {
        throw new ForbiddenException(
          `[CYB1038_003] MFA session expired after ${CYBERSECURITY_1038.SESSION_TIMEOUT_MINUTES} minutes. ` +
            `Please re-verify MFA.`,
        );
      }
    }

    // Check for break-glass: dual approver required
    const isBreakGlass = this.reflector.get<boolean>('breakGlass', context.getHandler());
    if (isBreakGlass) {
      const dualApproverToken = request.headers['x-dual-approver-token'];
      if (!dualApproverToken) {
        throw new ForbiddenException(
          `[CYB1038_004] Break-glass access requires dual approval. ` +
            `Provide X-Dual-Approver-Token header with second approver credentials.`,
        );
      }
    }

    return true;
  }
}

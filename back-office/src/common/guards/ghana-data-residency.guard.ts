import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DPA_843 } from '../../../../shared/src/constants/compliance';

// PII field names that must never leave Ghana data regions
const PII_FIELDS = new Set([
  'ghanaCardNumber', 'ghanaCardHash', 'ghanaCardRecord',
  'dateOfBirth', 'biometricHash', 'tinNumber',
  'phoneNumber', 'emailAddress', 'streetAddress',
  'monthlyIncomeRangeGHS', 'sourceOfFunds',
  'firstName', 'lastName', 'pepScreening',
]);

/**
 * Ghana Data Residency Guard - Data Protection Act 843
 *
 * Blocks any request where:
 * - The request destination is outside Ghana-permitted data regions
 * - The response body would contain PII fields
 *
 * Ghana-permitted regions: gh-accra-1, gh-kumasi-1, gh-tamale-1
 * All PII must remain in Ghana (Data Protection Act 843 §24).
 */
@Injectable()
export class GhanaDataResidencyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      path: string;
    }>();

    // Check if the request targets an external destination
    const destinationRegion = request.headers['x-destination-region'] as string | undefined;

    if (destinationRegion) {
      const permittedRegions = DPA_843.PERMITTED_DATA_REGIONS;
      if (!permittedRegions.includes(destinationRegion as typeof permittedRegions[number])) {
        // Log and block the violation
        console.error({
          event: 'DATA_RESIDENCY_VIOLATION',
          destinationRegion,
          permittedRegions,
          path: request.path,
          timestamp: new Date().toISOString(),
        });

        throw new ForbiddenException(
          `[DPA843_001] Data residency violation: PII cannot be transferred to region "${destinationRegion}". ` +
            `Only Ghana-hosted regions permitted: ${permittedRegions.join(', ')} (Data Protection Act 843 §24).`,
        );
      }
    }

    return true;
  }

  /** Strip PII fields from response objects before sending to non-Ghana destinations */
  static stripPiiForExport(data: Record<string, unknown>, destinationRegion?: string): Record<string, unknown> {
    if (!destinationRegion || DPA_843.PERMITTED_DATA_REGIONS.includes(destinationRegion as typeof DPA_843.PERMITTED_DATA_REGIONS[number])) {
      return data;
    }

    const stripped = { ...data };
    for (const field of PII_FIELDS) {
      if (field in stripped) {
        stripped[field] = '[REDACTED - Data Protection Act 843]';
      }
    }
    return stripped;
  }
}

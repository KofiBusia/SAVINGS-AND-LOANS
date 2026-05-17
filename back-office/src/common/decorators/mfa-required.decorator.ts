import { SetMetadata } from '@nestjs/common';
export const MFA_REQUIRED_KEY = 'mfaRequired';
export const MfaRequired = () => SetMetadata(MFA_REQUIRED_KEY, true);

import type { RiskClass } from '../constants/compliance';

export type KycStatus =
  | 'PENDING_GHANA_CARD'
  | 'PENDING_LIVENESS'
  | 'PENDING_ADDRESS'
  | 'PENDING_INCOME'
  | 'PENDING_PEP_SCREENING'
  | 'PENDING_RISK_CLASSIFICATION'
  | 'PENDING_EDD'
  | 'PENDING_BENEFICIAL_OWNERSHIP'
  | 'PENDING_CONSENT'
  | 'PENDING_PRE_AGREEMENT'
  | 'PENDING_ESIGNATURE'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REJECTED';

export interface GhanaCardRecord {
  cardNumber: string;           // GHA-XXXXXXXX-X (stored encrypted, indexed by hash)
  cardNumberHash: string;       // SHA-256(appSalt + cardNumber) for lookup
  dateOfBirth: string;          // YYYY-MM-DD
  expiryDate: string;           // YYYY-MM-DD
  biometricHashEncrypted: string;
  verifiedAt: Date;
  verificationMethod: 'OCR_PLUS_NIA' | 'NIA_DIRECT' | 'OFFLINE_CACHED';
  niaReferenceCode: string;
  livenessScore: number;        // 0-100, must be >= 80 to pass
}

export interface ConsentRecord {
  timestamp: Date;
  ipAddress: string;
  deviceId: string;
  termsVersion: string;
  scopes: string[];
  withdrawnAt?: Date;
  withdrawnReason?: string;
}

export interface PepScreeningResult {
  screenedAt: Date;
  isPep: boolean;
  pepCategory?: 'DOMESTIC' | 'FOREIGN' | 'INTERNATIONAL_ORGANISATION';
  matchedListName?: string;
  matchScore?: number;
  reviewedBy?: string;
  reviewedAt?: Date;
  outcome: 'CLEARED' | 'CONFIRMED_PEP' | 'FALSE_POSITIVE' | 'PENDING_REVIEW';
}

export interface Customer {
  id: string;
  customerCode: string;         // e.g. SL-2024-000001
  ghanaCardHash: string;        // indexed, never store raw card number
  ghanaCardRecord: GhanaCardRecord;

  // Personal info (all encrypted at rest)
  firstName: string;
  lastName: string;
  otherNames?: string;
  dateOfBirth: Date;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  nationality: string;          // ISO 3166-1 alpha-3

  // Contact
  phoneNumber: string;          // +233XXXXXXXXX format
  alternatePhone?: string;
  emailAddress?: string;

  // Address
  region: string;
  district: string;
  town: string;
  streetAddress: string;
  ghanaPostGPS?: string;        // e.g. GA-123-4567
  addressVerifiedAt?: Date;
  addressPhotoUrl?: string;

  // KYC/AML
  kycStatus: KycStatus;
  kycCompletedAt?: Date;
  riskClass: RiskClass;
  riskScore: number;            // 0-100
  pepScreening: PepScreeningResult;
  eddCompletedAt?: Date;        // Enhanced Due Diligence
  cddNextReviewDate: Date;

  // Employment / Income
  employmentStatus: 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';
  employer?: string;
  monthlyIncomeRangeGHS?: string;
  sourceOfFunds: string;
  businessType?: string;
  tinNumber?: string;           // Ghana Tax Identification Number

  // Consent (Data Protection Act 843)
  consents: ConsentRecord[];
  dataProcessingConsentGiven: boolean;

  // Account
  accountNumber: string;
  accountStatus: 'ACTIVE' | 'DORMANT' | 'SUSPENDED' | 'CLOSED';
  activatedAt?: Date;
  closedAt?: Date;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  branchCode?: string;
  fieldAgentId?: string;
}

export interface BeneficialOwner {
  id: string;
  customerId: string;
  ownerName: string;
  ownerGhanaCardHash: string;
  ownershipPercentage: number;  // Must capture if >= 25% (AML Act 1044)
  verifiedAt: Date;
  relationship: string;
}

/**
 * Customer entity — mirrors the Prisma schema.
 * This file provides typed interfaces and enums for use throughout the application.
 * The authoritative schema is in src/database/schema.prisma.
 */

export enum CustomerStatus {
  PENDING_KYC        = 'PENDING_KYC',
  KYC_IN_PROGRESS    = 'KYC_IN_PROGRESS',
  PENDING_ACTIVATION = 'PENDING_ACTIVATION',
  ACTIVE             = 'ACTIVE',
  SUSPENDED          = 'SUSPENDED',
  DORMANT            = 'DORMANT',
  CLOSED             = 'CLOSED',
  BLACKLISTED        = 'BLACKLISTED',
}

export enum KycStatus {
  NOT_STARTED              = 'NOT_STARTED',
  GHANA_CARD_SCAN          = 'GHANA_CARD_SCAN',
  LIVENESS_CHECK           = 'LIVENESS_CHECK',
  ADDRESS_VERIFICATION     = 'ADDRESS_VERIFICATION',
  INCOME_DECLARATION       = 'INCOME_DECLARATION',
  PEP_SCREENING            = 'PEP_SCREENING',
  RISK_CLASSIFICATION      = 'RISK_CLASSIFICATION',
  EDD_REQUIRED             = 'EDD_REQUIRED',
  EDD_IN_PROGRESS          = 'EDD_IN_PROGRESS',
  BENEFICIAL_OWNERSHIP     = 'BENEFICIAL_OWNERSHIP',
  CONSENT_CAPTURE          = 'CONSENT_CAPTURE',
  PRE_AGREEMENT_DISPLAY    = 'PRE_AGREEMENT_DISPLAY',
  ESIGNATURE               = 'ESIGNATURE',
  COMPLETED                = 'COMPLETED',
  REJECTED                 = 'REJECTED',
}

export enum AmlRiskLevel {
  LOW       = 'LOW',
  MEDIUM    = 'MEDIUM',
  HIGH      = 'HIGH',
  VERY_HIGH = 'VERY_HIGH',
}

export enum CustomerType {
  INDIVIDUAL  = 'INDIVIDUAL',
  SOLE_TRADER = 'SOLE_TRADER',
  BUSINESS    = 'BUSINESS',
  COOPERATIVE = 'COOPERATIVE',
  GROUP       = 'GROUP',
}

export enum IdentityDocumentType {
  GHANA_CARD      = 'GHANA_CARD',
  PASSPORT        = 'PASSPORT',
  VOTERS_ID       = 'VOTERS_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  NHIS_CARD       = 'NHIS_CARD',
}

export enum Gender {
  MALE             = 'MALE',
  FEMALE           = 'FEMALE',
  NON_BINARY       = 'NON_BINARY',
  PREFER_NOT_TO_SAY = 'PREFER_NOT_TO_SAY',
}

export enum EmploymentStatus {
  EMPLOYED          = 'EMPLOYED',
  SELF_EMPLOYED     = 'SELF_EMPLOYED',
  UNEMPLOYED        = 'UNEMPLOYED',
  STUDENT           = 'STUDENT',
  RETIRED           = 'RETIRED',
  INFORMAL_SECTOR   = 'INFORMAL_SECTOR',
}

export interface CustomerAddress {
  ghanaPostGps?: string;       // Ghana Post GPS code (required where available)
  streetAddress: string;
  town: string;
  district: string;
  region: string;
  country: string;             // Must be 'GH' for primary address
  isVerified: boolean;
  verifiedAt?: Date;
  verificationMethod?: string; // NIA, site_visit, utility_bill, etc.
}

export interface KycDocument {
  id: string;
  type: string;
  documentNumber: string;
  documentHash: string;        // SHA-256 of document image — not the image itself
  issuedBy: string;
  issuedDate: Date;
  expiryDate?: Date;
  uploadedAt: Date;
  verifiedAt?: Date;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  rejectionReason?: string;
}

export interface AmlScreeningResult {
  screenedAt: Date;
  provider: string;             // WORLD_CHECK, REFINITIV, etc.
  isPep: boolean;
  isSanctioned: boolean;
  isAdverseMedia: boolean;
  matchDetails?: unknown;
  riskScore: number;
  nextScreeningDue: Date;
}

export interface ConsentRecord {
  id: string;
  consentType: string;          // TERMS_AND_CONDITIONS, PRIVACY_POLICY, CREDIT_BUREAU_CHECK, etc.
  version: string;
  grantedAt: Date;
  revokedAt?: Date;
  isActive: boolean;
  consentText: string;
  ipAddress: string;
  deviceId: string;
  eSignatureHash?: string;
}

export interface BeneficialOwner {
  id: string;
  fullName: string;
  dateOfBirth: Date;
  nationalityCountry: string;
  ghanaCardHash?: string;
  ownershipPercentage: number; // Must be >= 25% to trigger UBO disclosure
  controlType: 'DIRECT' | 'INDIRECT' | 'NOMINEE' | 'VOTING_RIGHTS';
  verifiedAt?: Date;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED';
}

export interface Customer {
  id: string;
  customerNumber: string;        // Unique customer number (e.g., GH-2024-000001)
  type: CustomerType;
  status: CustomerStatus;

  // ─── Personal Information (PII — Ghana-only residency) ──────────────────────
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: Date;
  gender: Gender;
  nationality: string;
  email: string;
  phoneNumber: string;           // Ghana format: +233XXXXXXXXX
  alternatePhone?: string;

  // ─── Ghana Card (NIA) ────────────────────────────────────────────────────────
  ghanaCardNumber?: string;      // Stored as HASH — never plaintext in DB
  ghanaCardHash?: string;        // SHA-256(ghana_card_number + institution_salt)
  niaBiometricVerified: boolean;
  niaVerificationRef?: string;   // NIA transaction reference
  niaVerifiedAt?: Date;

  // ─── Address ─────────────────────────────────────────────────────────────────
  primaryAddress: CustomerAddress;
  mailingAddress?: CustomerAddress;

  // ─── Employment & Income ──────────────────────────────────────────────────────
  employmentStatus: EmploymentStatus;
  employer?: string;
  jobTitle?: string;
  monthlyIncomeGHS?: number;
  annualIncomeGHS?: number;
  incomeVerified: boolean;

  // ─── KYC ──────────────────────────────────────────────────────────────────────
  kycStatus: KycStatus;
  kycCompletedAt?: Date;
  kycExpiresAt?: Date;
  kycRefreshDueAt?: Date;
  kycDocuments: KycDocument[];

  // ─── AML / Risk ──────────────────────────────────────────────────────────────
  amlRiskLevel: AmlRiskLevel;
  amlRiskScore: number;          // 0–100
  amlLastScreenedAt?: Date;
  amlScreeningResults: AmlScreeningResult[];
  isPep: boolean;                // Politically Exposed Person
  pepDetails?: unknown;
  isSanctioned: boolean;
  sanctionDetails?: unknown;
  eddRequired: boolean;
  eddCompletedAt?: Date;

  // ─── Beneficial Ownership (AML Act 1044, 25% threshold) ──────────────────────
  hasBeneficialOwners: boolean;
  beneficialOwners: BeneficialOwner[];
  uboVerifiedAt?: Date;

  // ─── Consent ──────────────────────────────────────────────────────────────────
  consentRecords: ConsentRecord[];
  termsAcceptedAt?: Date;
  privacyPolicyAcceptedAt?: Date;
  marketingConsent: boolean;
  creditBureauConsentAt?: Date;

  // ─── E-Signature ──────────────────────────────────────────────────────────────
  eSignatureHash?: string;       // SHA-256 of signed agreement
  eSignedAt?: Date;
  eSignatureIpAddress?: string;

  // ─── Credit Bureau ────────────────────────────────────────────────────────────
  creditScore?: number;
  creditBureauReportDate?: Date;
  creditBureauReference?: string;
  isBlacklisted: boolean;
  blacklistReason?: string;

  // ─── Metadata ─────────────────────────────────────────────────────────────────
  onboardedBy: string;           // Staff user ID
  branchCode: string;
  referralCode?: string;
  tags: string[];
  notes?: string;

  // ─── Timestamps ───────────────────────────────────────────────────────────────
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;              // Soft delete — loans prevent hard delete
  lastActivityAt?: Date;
}

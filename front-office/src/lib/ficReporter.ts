/**
 * FIC (Financial Intelligence Centre) Report Generator
 *
 * Handles Suspicious Transaction Reports (STR) and
 * Currency Transaction Reports (CTR) under:
 * - Anti-Money Laundering Act 2020 (Act 1044)
 * - FIC Reporting Guidelines 2023
 *
 * STR: Must be filed within 3 business days of detection
 * CTR: Must be filed within 24 hours for transactions >= GHS 10,000
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrActivityType =
  | 'structuring'
  | 'layering'
  | 'unusual_pattern'
  | 'pep_related'
  | 'sanctions_evasion'
  | 'terrorism_financing'
  | 'drug_trafficking'
  | 'fraud'
  | 'tax_evasion'
  | 'embezzlement'
  | 'other';

export interface FicSubject {
  type: 'individual' | 'business' | 'unknown';
  fullName: string;
  dateOfBirth?: string;
  nationalId?: string;
  nationality?: string;
  address?: string;
  phoneNumber?: string;
  occupation?: string;
  employer?: string;
  businessRegistrationNumber?: string;
  isPep?: boolean;
  isSanctioned?: boolean;
}

export interface SuspiciousTransaction {
  transactionId: string;
  transactionDate: string;
  amount: number;
  currency: 'GHS' | 'USD' | 'EUR' | 'GBP';
  amountInGhs: number;
  transactionType: string;
  fromAccount?: string;
  toAccount?: string;
  paymentMethod: string;
  description?: string;
}

export interface StrReport {
  reportType: 'STR';
  reportId: string;
  institutionName: string;
  institutionLicenseNumber: string;
  institutionBranchCode: string;
  preparedBy: string;
  preparedByRole: string;
  supervisorApproval: string;

  subject: FicSubject;
  accountNumbers: string[];
  transactions: SuspiciousTransaction[];
  totalAmountGhs: number;

  activityType: StrActivityType;
  activityDescription: string;
  detectionDate: string;
  reportingDate: string;
  deadlineDate: string; // detectionDate + 3 business days

  existingCustomer: boolean;
  customerSince?: string;
  kycDocumentType?: string;
  kycDocumentNumber?: string;

  actionTaken: string;
  accountFrozen: boolean;
  frozenAt?: string;

  attachments: string[];
  narrative: string;
  internalCaseNumber: string;
}

export interface CtrReport {
  reportType: 'CTR';
  reportId: string;
  institutionName: string;
  institutionLicenseNumber: string;
  institutionBranchCode: string;
  preparedBy: string;
  transactionDate: string;
  reportingDate: string;
  deadlineDate: string; // transactionDate + 24 hours

  subject: FicSubject;
  accountNumber: string;
  transactionType: 'deposit' | 'withdrawal' | 'wire_transfer' | 'currency_exchange';
  amount: number;
  currency: string;
  amountInGhs: number;
  paymentMethod: string;
  transactionReference: string;
  businessPurpose?: string;
  sourceOfFunds?: string;
}

export type FicReport = StrReport | CtrReport;

export interface FilingResult {
  success: boolean;
  filingId?: string;
  ficReferenceNumber?: string;
  submittedAt?: string;
  acknowledgementReceived?: boolean;
  error?: string;
  errorCode?: string;
  pendingDueToOffline?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CTR_THRESHOLD_GHS = 10_000;
const STR_DEADLINE_BUSINESS_DAYS = 3;
const CTR_DEADLINE_HOURS = 24;

// ─── Deadline Calculators ─────────────────────────────────────────────────────

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

export function calculateStrDeadline(detectionDate: Date): Date {
  return addBusinessDays(detectionDate, STR_DEADLINE_BUSINESS_DAYS);
}

export function calculateCtrDeadline(transactionDate: Date): Date {
  return new Date(transactionDate.getTime() + CTR_DEADLINE_HOURS * 60 * 60 * 1000);
}

export function isStrOverdue(report: StrReport): boolean {
  return new Date(report.deadlineDate) < new Date() && !report.reportType;
}

export function isCtrRequired(amountGhs: number): boolean {
  return amountGhs >= CTR_THRESHOLD_GHS;
}

export function isStrDeadlineSoon(report: StrReport, hoursThreshold = 12): boolean {
  const deadline = new Date(report.deadlineDate);
  const hoursRemaining = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursRemaining > 0 && hoursRemaining <= hoursThreshold;
}

// ─── Report ID Generator ──────────────────────────────────────────────────────

export function generateReportId(type: 'STR' | 'CTR'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const seq = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  const institution = (process.env.NEXT_PUBLIC_INSTITUTION_CODE ?? 'GHSL').substring(0, 4).toUpperCase();
  return `${institution}-${type}-${year}${month}${day}-${seq}`;
}

// ─── STR Builder ─────────────────────────────────────────────────────────────

export interface CreateStrParams {
  subject: FicSubject;
  accountNumbers: string[];
  transactions: SuspiciousTransaction[];
  activityType: StrActivityType;
  activityDescription: string;
  narrative: string;
  detectionDate: string;
  branchCode: string;
  preparedBy: string;
  preparedByRole: string;
  supervisorApproval: string;
  accountFrozen?: boolean;
  frozenAt?: string;
  attachments?: string[];
  existingCustomer?: boolean;
  customerSince?: string;
  kycDocumentType?: string;
  kycDocumentNumber?: string;
}

export function buildStrReport(params: CreateStrParams): StrReport {
  const detectionDate = new Date(params.detectionDate);
  const deadline = calculateStrDeadline(detectionDate);

  return {
    reportType: 'STR',
    reportId: generateReportId('STR'),
    institutionName: process.env.NEXT_PUBLIC_INSTITUTION_NAME ?? 'Ghana SL Ltd',
    institutionLicenseNumber: process.env.NEXT_PUBLIC_BOG_LICENSE ?? '',
    institutionBranchCode: params.branchCode,
    preparedBy: params.preparedBy,
    preparedByRole: params.preparedByRole,
    supervisorApproval: params.supervisorApproval,
    subject: params.subject,
    accountNumbers: params.accountNumbers,
    transactions: params.transactions,
    totalAmountGhs: params.transactions.reduce((s, t) => s + t.amountInGhs, 0),
    activityType: params.activityType,
    activityDescription: params.activityDescription,
    detectionDate: params.detectionDate,
    reportingDate: new Date().toISOString(),
    deadlineDate: deadline.toISOString(),
    existingCustomer: params.existingCustomer ?? false,
    customerSince: params.customerSince,
    kycDocumentType: params.kycDocumentType,
    kycDocumentNumber: params.kycDocumentNumber,
    actionTaken: params.accountFrozen ? 'Account frozen pending FIC investigation' : 'Monitoring in progress',
    accountFrozen: params.accountFrozen ?? false,
    frozenAt: params.frozenAt,
    attachments: params.attachments ?? [],
    narrative: params.narrative,
    internalCaseNumber: `CASE-AML-${Date.now()}`,
  };
}

// ─── CTR Builder ──────────────────────────────────────────────────────────────

export interface CreateCtrParams {
  subject: FicSubject;
  accountNumber: string;
  transactionType: CtrReport['transactionType'];
  amount: number;
  currency: string;
  amountInGhs: number;
  paymentMethod: string;
  transactionReference: string;
  transactionDate: string;
  branchCode: string;
  preparedBy: string;
  businessPurpose?: string;
  sourceOfFunds?: string;
}

export function buildCtrReport(params: CreateCtrParams): CtrReport {
  if (params.amountInGhs < CTR_THRESHOLD_GHS) {
    throw new Error(`CTR not required: amount GHS ${params.amountInGhs} is below threshold GHS ${CTR_THRESHOLD_GHS}`);
  }

  const txDate = new Date(params.transactionDate);
  const deadline = calculateCtrDeadline(txDate);

  return {
    reportType: 'CTR',
    reportId: generateReportId('CTR'),
    institutionName: process.env.NEXT_PUBLIC_INSTITUTION_NAME ?? 'Ghana SL Ltd',
    institutionLicenseNumber: process.env.NEXT_PUBLIC_BOG_LICENSE ?? '',
    institutionBranchCode: params.branchCode,
    preparedBy: params.preparedBy,
    transactionDate: params.transactionDate,
    reportingDate: new Date().toISOString(),
    deadlineDate: deadline.toISOString(),
    subject: params.subject,
    accountNumber: params.accountNumber,
    transactionType: params.transactionType,
    amount: params.amount,
    currency: params.currency,
    amountInGhs: params.amountInGhs,
    paymentMethod: params.paymentMethod,
    transactionReference: params.transactionReference,
    businessPurpose: params.businessPurpose,
    sourceOfFunds: params.sourceOfFunds,
  };
}

// ─── Filing ───────────────────────────────────────────────────────────────────

/**
 * Submits an STR or CTR to FIC via our backend.
 * Backend handles the actual FIC API call and maintains filing audit trail.
 */
export async function fileReport(report: FicReport): Promise<FilingResult> {
  try {
    const response = await fetch('/api/compliance/fic/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { errorCode?: string; error?: string };
      return {
        success: false,
        error: err.error ?? `FIC filing failed: HTTP ${response.status}`,
        errorCode: err.errorCode,
      };
    }

    return response.json() as Promise<FilingResult>;
  } catch (err) {
    // If offline, queue for later submission
    if (!navigator.onLine) {
      await queueOfflineFiling(report);
      return {
        success: false,
        pendingDueToOffline: true,
        error: 'Offline — report queued for submission when connection is restored',
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Filing failed',
      errorCode: 'NETWORK_ERROR',
    };
  }
}

// ─── Offline Queue ────────────────────────────────────────────────────────────

const FIC_QUEUE_KEY = 'fic-pending-reports';

interface QueuedFicReport {
  report: FicReport;
  queuedAt: string;
  attempts: number;
}

async function queueOfflineFiling(report: FicReport): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const existing: QueuedFicReport[] = JSON.parse(localStorage.getItem(FIC_QUEUE_KEY) ?? '[]');
  existing.push({ report, queuedAt: new Date().toISOString(), attempts: 0 });
  localStorage.setItem(FIC_QUEUE_KEY, JSON.stringify(existing));
}

export async function flushPendingFicReports(): Promise<{ flushed: number; failed: number }> {
  if (typeof localStorage === 'undefined') return { flushed: 0, failed: 0 };
  const queue: QueuedFicReport[] = JSON.parse(localStorage.getItem(FIC_QUEUE_KEY) ?? '[]');
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedFicReport[] = [];

  for (const item of queue) {
    const result = await fileReport(item.report);
    if (result.success) {
      flushed++;
    } else if (result.pendingDueToOffline) {
      remaining.push({ ...item, attempts: item.attempts + 1 });
      failed++;
    } else if (item.attempts < 5) {
      remaining.push({ ...item, attempts: item.attempts + 1 });
      failed++;
    }
    // Drop after 5 failed attempts (manual intervention needed)
  }

  localStorage.setItem(FIC_QUEUE_KEY, JSON.stringify(remaining));
  return { flushed, failed };
}

export function getPendingFicReportCount(): number {
  if (typeof localStorage === 'undefined') return 0;
  const queue: QueuedFicReport[] = JSON.parse(localStorage.getItem(FIC_QUEUE_KEY) ?? '[]');
  return queue.length;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { CTR_THRESHOLD_GHS, STR_DEADLINE_BUSINESS_DAYS, CTR_DEADLINE_HOURS };

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KycStatus = 'verified' | 'pending' | 'expired' | 'not_started' | 'rejected' | 'edd_required';
export type ReportStatus = 'submitted' | 'pending' | 'overdue' | 'not_required';

export interface KycInfo {
  status: KycStatus;
  lastVerifiedAt?: string;
  expiresAt?: string;
  daysUntilExpiry?: number;
  niaBiometricMatch?: boolean;
  pepMatch: boolean;
  sanctionsMatch: boolean;
  eddRequired: boolean;
  eddCompletedAt?: string;
}

export interface PendingReport {
  reportType: string;
  dueDate: string;
  periodCovered: string;
  status: ReportStatus;
  daysOverdue?: number;
  regulatoryBody: 'BoG' | 'FIC' | 'DPC';
}

export interface ComplianceAlert {
  alertId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  message: string;
  createdAt: string;
  dueBy?: string;
}

export interface DataResidencyStatus {
  allDataInGhana: boolean;
  violations: Array<{
    dataType: string;
    location: string;
    detectedAt: string;
  }>;
}

export interface ComplianceState {
  // KYC
  kyc: KycInfo;
  // Reports
  pendingReports: PendingReport[];
  overdueReportCount: number;
  nextReportDueAt?: string;
  // Alerts
  alertCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  recentAlerts: ComplianceAlert[];
  // AML
  strPendingCount: number;
  ctrPendingCount: number;
  // Data
  dataResidency: DataResidencyStatus;
  // Consent
  consentExpiredCount: number;
  // Overall
  isCompliant: boolean;
  complianceScore: number; // 0-100
  lastCheckedAt: string;
}

interface UseGhanaComplianceOptions {
  customerId?: string;
  branchCode?: string;
  refreshIntervalSeconds?: number;
}

const fetcher = (url: string) =>
  fetch(url, { headers: { 'Cache-Control': 'no-cache' } }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

// ─── KYC Status helpers ───────────────────────────────────────────────────────

function isKycExpiringSoon(kyc: KycInfo): boolean {
  return kyc.daysUntilExpiry !== undefined && kyc.daysUntilExpiry > 0 && kyc.daysUntilExpiry <= 30;
}

function isKycExpired(kyc: KycInfo): boolean {
  return kyc.status === 'expired';
}

function getKycSeverity(kyc: KycInfo): 'ok' | 'warning' | 'critical' {
  if (isKycExpired(kyc) || kyc.pepMatch || kyc.sanctionsMatch) return 'critical';
  if (isKycExpiringSoon(kyc) || kyc.eddRequired) return 'warning';
  return 'ok';
}

// ─── Report helpers ───────────────────────────────────────────────────────────

function getNextDueReport(reports: PendingReport[]): PendingReport | undefined {
  const pending = reports.filter((r) => r.status === 'pending' || r.status === 'overdue');
  if (pending.length === 0) return undefined;
  return pending.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGhanaCompliance(options: UseGhanaComplianceOptions = {}) {
  const { customerId, branchCode, refreshIntervalSeconds = 60 } = options;

  const baseUrl = customerId
    ? `/api/compliance/customer/${customerId}`
    : `/api/compliance${branchCode ? `?branch=${branchCode}` : ''}`;

  const { data: complianceData, error, isLoading, mutate } = useSWR<ComplianceState>(
    baseUrl,
    fetcher,
    {
      refreshInterval: refreshIntervalSeconds * 1000,
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
      onError: (err) => {
        console.error('[useGhanaCompliance] fetch error:', err);
      },
    }
  );

  // ── Computed values ────────────────────────────────────────────────────────

  const kycSeverity = complianceData ? getKycSeverity(complianceData.kyc) : 'ok';
  const kycExpiringSoon = complianceData ? isKycExpiringSoon(complianceData.kyc) : false;
  const kycExpired = complianceData ? isKycExpired(complianceData.kyc) : false;
  const nextDueReport = complianceData ? getNextDueReport(complianceData.pendingReports) : undefined;

  const hasBlockingIssues = Boolean(
    complianceData &&
    (complianceData.kyc.sanctionsMatch ||
      complianceData.kyc.pepMatch ||
      complianceData.kyc.status === 'rejected' ||
      complianceData.alertCounts.critical > 0)
  );

  const requiresImmediateAction = Boolean(
    complianceData &&
    (complianceData.overdueReportCount > 0 ||
      complianceData.strPendingCount > 0 ||
      complianceData.dataResidency.violations.length > 0)
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  const triggerKycRefresh = useCallback(async () => {
    if (!customerId) return;
    await fetch(`/api/kyc/${customerId}/refresh`, { method: 'POST' });
    await mutate();
  }, [customerId, mutate]);

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      await fetch(`/api/compliance/alerts/${alertId}/acknowledge`, { method: 'POST' });
      await mutate();
    },
    [mutate]
  );

  const markReportSubmitted = useCallback(
    async (reportType: string, period: string) => {
      await fetch('/api/compliance/reports/mark-submitted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, period }),
      });
      await mutate();
    },
    [mutate]
  );

  const checkDataResidency = useCallback(async () => {
    const res = await fetch('/api/compliance/data-residency/check', { method: 'POST' });
    const result = await res.json();
    await mutate();
    return result as DataResidencyStatus;
  }, [mutate]);

  const getExpiringKycCustomers = useCallback(async (daysAhead = 30) => {
    const res = await fetch(`/api/compliance/kyc/expiring?days=${daysAhead}`);
    return res.json() as Promise<Array<{ customerId: string; fullName: string; expiresAt: string }>>;
  }, []);

  return {
    // Raw data
    complianceState: complianceData,
    isLoading,
    error: error as Error | undefined,

    // KYC
    kyc: complianceData?.kyc,
    kycSeverity,
    kycExpiringSoon,
    kycExpired,

    // Reports
    pendingReports: complianceData?.pendingReports ?? [],
    overdueReportCount: complianceData?.overdueReportCount ?? 0,
    nextDueReport,

    // Alerts
    alertCounts: complianceData?.alertCounts ?? { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    recentAlerts: complianceData?.recentAlerts ?? [],

    // AML
    strPendingCount: complianceData?.strPendingCount ?? 0,
    ctrPendingCount: complianceData?.ctrPendingCount ?? 0,

    // Data residency
    dataResidency: complianceData?.dataResidency,

    // Overall
    isCompliant: complianceData?.isCompliant ?? false,
    complianceScore: complianceData?.complianceScore ?? 0,
    hasBlockingIssues,
    requiresImmediateAction,

    // Actions
    triggerKycRefresh,
    acknowledgeAlert,
    markReportSubmitted,
    checkDataResidency,
    getExpiringKycCustomers,
    refresh: mutate,
  };
}

// ─── Standalone utility exports ───────────────────────────────────────────────

export { isKycExpiringSoon, isKycExpired, getKycSeverity };

/**
 * Returns the BoG reporting deadline for a given month.
 * Per BoG guidelines: monthly returns due by 15th of following month.
 */
export function getBogReportingDeadline(year: number, month: number): Date {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return new Date(nextYear, nextMonth - 1, 15, 23, 59, 59);
}

/**
 * Returns the FIC STR deadline (3 business days from detection).
 */
export function getFicStrDeadline(detectedAt: Date): Date {
  let businessDays = 0;
  const date = new Date(detectedAt);
  while (businessDays < 3) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) businessDays++;
  }
  return date;
}

/**
 * Returns the CTR deadline (24 hours from transaction).
 */
export function getFicCtrDeadline(transactionAt: Date): Date {
  return new Date(transactionAt.getTime() + 24 * 60 * 60 * 1000);
}

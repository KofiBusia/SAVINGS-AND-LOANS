'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  Bell,
  Shield,
  Clock,
  Database,
  FileText,
  Flag,
  CheckCircle,
  XCircle,
  ChevronRight,
  RefreshCw,
  Filter,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertCategory =
  | 'str_trigger'
  | 'ctr_threshold'
  | 'expired_kyc'
  | 'overdue_bog_report'
  | 'data_residency'
  | 'aml_flag'
  | 'pep_match'
  | 'sanctions_match'
  | 'edd_required'
  | 'consent_expired'
  | 'dpc_breach'
  | 'system_access'
  | 'unusual_transaction';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'escalated' | 'false_positive';

export interface ComplianceAlert {
  alertId: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  entityType: 'customer' | 'loan' | 'report' | 'system' | 'transaction';
  entityId: string;
  entityName?: string;
  status: AlertStatus;
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  assignedTo?: string;
  dueBy?: string;
  regulatoryDeadline?: string;
  actionRequired: string;
  autoResolvable: boolean;
  tags: string[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── Alert Config ─────────────────────────────────────────────────────────────

const ALERT_CONFIG: Record<
  AlertCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  str_trigger: { label: 'STR Trigger', icon: Flag, color: 'text-red-600' },
  ctr_threshold: { label: 'CTR Threshold', icon: AlertTriangle, color: 'text-orange-600' },
  expired_kyc: { label: 'Expired KYC', icon: Clock, color: 'text-yellow-600' },
  overdue_bog_report: { label: 'Overdue BoG Report', icon: FileText, color: 'text-red-600' },
  data_residency: { label: 'Data Residency', icon: Database, color: 'text-purple-600' },
  aml_flag: { label: 'AML Flag', icon: Shield, color: 'text-red-700' },
  pep_match: { label: 'PEP Match', icon: AlertTriangle, color: 'text-red-700' },
  sanctions_match: { label: 'Sanctions Match', icon: XCircle, color: 'text-red-800' },
  edd_required: { label: 'EDD Required', icon: Shield, color: 'text-orange-600' },
  consent_expired: { label: 'Consent Expired', icon: Clock, color: 'text-yellow-600' },
  dpc_breach: { label: 'DPC Breach', icon: Database, color: 'text-purple-700' },
  system_access: { label: 'System Access', icon: Shield, color: 'text-gray-700' },
  unusual_transaction: { label: 'Unusual Transaction', icon: AlertTriangle, color: 'text-orange-600' },
};

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; className: string; priority: number }> = {
  critical: { label: 'CRITICAL', className: 'bg-red-100 text-red-800 border border-red-300', priority: 4 },
  high: { label: 'HIGH', className: 'bg-orange-100 text-orange-800 border border-orange-200', priority: 3 },
  medium: { label: 'MEDIUM', className: 'bg-yellow-100 text-yellow-800 border border-yellow-200', priority: 2 },
  low: { label: 'LOW', className: 'bg-gray-100 text-gray-700 border border-gray-200', priority: 1 },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const { label, className } = SEVERITY_CONFIG[severity];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${className}`}>{label}</span>
  );
}

function StatusBadge({ status }: { status: AlertStatus }) {
  const map: Record<AlertStatus, { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-red-50 text-red-700' },
    acknowledged: { label: 'Acknowledged', className: 'bg-blue-50 text-blue-700' },
    resolved: { label: 'Resolved', className: 'bg-green-50 text-green-700' },
    escalated: { label: 'Escalated', className: 'bg-orange-50 text-orange-700' },
    false_positive: { label: 'False Positive', className: 'bg-gray-50 text-gray-500' },
  };
  const { label, className } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  onEscalate,
  onFalsePositive,
}: {
  alert: ComplianceAlert;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onEscalate: (id: string) => void;
  onFalsePositive: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = ALERT_CONFIG[alert.category];
  const Icon = config.icon;

  const isOverdue =
    alert.regulatoryDeadline && new Date(alert.regulatoryDeadline) < new Date();
  const isDueSoon =
    alert.dueBy &&
    new Date(alert.dueBy).getTime() - Date.now() < 24 * 60 * 60 * 1000 &&
    new Date(alert.dueBy) > new Date();

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-all ${
        alert.severity === 'critical'
          ? 'border-red-300 shadow-sm shadow-red-100'
          : alert.severity === 'high'
          ? 'border-orange-200'
          : 'border-gray-200'
      } ${alert.status === 'resolved' || alert.status === 'false_positive' ? 'opacity-60' : ''}`}
    >
      <div className="p-4 bg-white">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg flex-shrink-0 ${alert.severity === 'critical' ? 'bg-red-100' : alert.severity === 'high' ? 'bg-orange-100' : 'bg-gray-100'}`}>
            <Icon className={`w-4 h-4 ${config.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{config.label}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                <SeverityBadge severity={alert.severity} />
                <StatusBadge status={alert.status} />
              </div>
            </div>

            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
              {alert.description}
            </p>

            {/* Entity ref */}
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
              <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                {alert.entityType}: {alert.entityName ?? alert.entityId}
              </span>
              <span>
                {new Date(alert.createdAt).toLocaleString('en-GH', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </div>

            {/* Deadlines */}
            {(isOverdue || isDueSoon) && (
              <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-orange-600'}`}>
                <Clock className="w-3.5 h-3.5" />
                {isOverdue
                  ? `OVERDUE — Regulatory deadline was ${new Date(alert.regulatoryDeadline!).toLocaleDateString()}`
                  : `Due soon: ${new Date(alert.dueBy!).toLocaleDateString()}`}
              </div>
            )}

            {/* Action Required */}
            <div className="mt-2 p-2 bg-blue-50 rounded-lg">
              <p className="text-xs font-semibold text-blue-800">Action Required:</p>
              <p className="text-xs text-blue-700">{alert.actionRequired}</p>
            </div>

            {/* Tags */}
            {alert.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {alert.tags.map((tag) => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {(alert.status === 'open' || alert.status === 'acknowledged') && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
            {alert.status === 'open' && (
              <button
                onClick={() => onAcknowledge(alert.alertId)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium hover:bg-blue-100"
              >
                <Bell className="w-3 h-3" />
                Acknowledge
              </button>
            )}
            <button
              onClick={() => onResolve(alert.alertId)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 font-medium hover:bg-green-100"
            >
              <CheckCircle className="w-3 h-3" />
              Resolve
            </button>
            <button
              onClick={() => onEscalate(alert.alertId)}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700 font-medium hover:bg-orange-100"
            >
              <AlertTriangle className="w-3 h-3" />
              Escalate
            </button>
            {alert.autoResolvable && (
              <button
                onClick={() => onFalsePositive(alert.alertId)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500 font-medium hover:bg-gray-100"
              >
                <XCircle className="w-3 h-3" />
                False Positive
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-600 ml-auto"
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              View Entity
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Summary Counters ─────────────────────────────────────────────────────────

function AlertSummary({ alerts }: { alerts: ComplianceAlert[] }) {
  const open = alerts.filter((a) => a.status === 'open');
  const critical = open.filter((a) => a.severity === 'critical').length;
  const high = open.filter((a) => a.severity === 'high').length;
  const regulatory = open.filter((a) =>
    ['overdue_bog_report', 'str_trigger', 'dpc_breach'].includes(a.category)
  ).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Total Open', value: open.length, color: 'text-gray-900', bg: 'bg-white' },
        { label: 'Critical', value: critical, color: 'text-red-700', bg: 'bg-red-50' },
        { label: 'High Severity', value: high, color: 'text-orange-600', bg: 'bg-orange-50' },
        { label: 'Regulatory', value: regulatory, color: 'text-purple-700', bg: 'bg-purple-50' },
      ].map(({ label, value, color, bg }) => (
        <div key={label} className={`${bg} border border-gray-200 rounded-xl p-4 text-center`}>
          <p className="text-xs text-gray-500">{label}</p>
          <p className={`text-2xl font-bold ${color} mt-1`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface ComplianceAlertsProps {
  branchCode?: string;
  maxItems?: number;
  autoRefreshSeconds?: number;
}

export function ComplianceAlerts({
  branchCode,
  maxItems = 50,
  autoRefreshSeconds = 30,
}: ComplianceAlertsProps) {
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'open'>('open');
  const [searchQuery, setSearchQuery] = useState('');

  const url = `/api/compliance/alerts?${branchCode ? `branch=${branchCode}&` : ''}limit=${maxItems}`;
  const { data: alerts, mutate: refreshAlerts, isLoading } = useSWR<ComplianceAlert[]>(
    url,
    fetcher,
    { refreshInterval: autoRefreshSeconds * 1000 }
  );

  const handleAction = useCallback(async (alertId: string, action: string) => {
    await fetch(`/api/compliance/alerts/${alertId}/${action}`, { method: 'POST' });
    await refreshAlerts();
  }, [refreshAlerts]);

  const filtered = (alerts ?? [])
    .filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (
        searchQuery &&
        !a.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !a.entityName?.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !a.entityId.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const pa = SEVERITY_CONFIG[a.severity].priority;
      const pb = SEVERITY_CONFIG[b.severity].priority;
      if (pa !== pb) return pb - pa;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const criticalAndOverdue = filtered.filter(
    (a) =>
      a.severity === 'critical' &&
      a.status === 'open' &&
      a.regulatoryDeadline &&
      new Date(a.regulatoryDeadline) < new Date()
  );

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="w-6 h-6 text-red-600" />
          Compliance Alerts
        </h1>
        <button
          onClick={() => refreshAlerts()}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          aria-label="Refresh alerts"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Critical Banner */}
      {criticalAndOverdue.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-600 text-white rounded-xl shadow-md" role="alert">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-sm">
              {criticalAndOverdue.length} CRITICAL REGULATORY OVERDUE ALERT{criticalAndOverdue.length > 1 ? 'S' : ''}
            </p>
            <p className="text-xs text-red-200 mt-0.5">
              Immediate action required. Failure to resolve may result in regulatory sanctions.
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      {alerts && <AlertSummary alerts={alerts} />}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-medium text-gray-600">Filters</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-400 w-full">Status:</span>
          {(['open', 'acknowledged', 'resolved', 'escalated', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-400 w-full">Severity:</span>
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${severityFilter === s ? 'bg-red-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search alerts…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search compliance alerts"
        />
      </div>

      {/* Alert List */}
      <div className="space-y-2" role="list" aria-label="Compliance alerts">
        {isLoading && (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 bg-white rounded-xl border border-gray-200 text-gray-400">
            <CheckCircle className="w-8 h-8 mb-2 text-green-400" />
            <p className="text-sm">No alerts matching your filters</p>
          </div>
        )}
        {filtered.map((alert) => (
          <div key={alert.alertId} role="listitem">
            <AlertCard
              alert={alert}
              onAcknowledge={(id) => handleAction(id, 'acknowledge')}
              onResolve={(id) => handleAction(id, 'resolve')}
              onEscalate={(id) => handleAction(id, 'escalate')}
              onFalsePositive={(id) => handleAction(id, 'false-positive')}
            />
          </div>
        ))}
      </div>

      {/* Regulatory Footer Note */}
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
        <p className="font-medium text-gray-700 mb-1">Regulatory Obligations</p>
        <p>STR reports must be filed with FIC within 3 days of detection. CTR reports for transactions exceeding GHS 10,000 must be filed within 24 hours. BoG monthly returns are due by the 15th of the following month. Failure to comply may result in sanctions under the Anti-Money Laundering Act 2020 (Act 1044) and BoG Licensing Requirements.</p>
      </div>
    </div>
  );
}

export default ComplianceAlerts;

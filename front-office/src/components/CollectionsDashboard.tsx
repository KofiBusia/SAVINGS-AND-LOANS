'use client';

import React, { useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Phone,
  MapPin,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingDown,
  User,
  DollarSign,
  Filter,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ParBucket = '1-30' | '31-60' | '61-90' | '91-180' | '180+';
type CollectionStatus = 'pending' | 'in_progress' | 'paid' | 'promise_to_pay' | 'escalated' | 'written_off';

interface OverdueLoan {
  loanId: string;
  customerId: string;
  customerName: string;
  phoneNumber: string;
  address: string;
  region: string;
  outstandingBalance: number;
  overdueAmount: number;
  daysOverdue: number;
  parBucket: ParBucket;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  assignedAgentId?: string;
  assignedAgentName?: string;
  collectionStatus: CollectionStatus;
  nextCallScheduled?: string;
  lastContactAttempt?: string;
  promiseDate?: string;
  promiseAmount?: number;
  notes?: string;
  escalatedToSupervisor?: boolean;
}

interface FieldAgent {
  agentId: string;
  name: string;
  region: string;
  activeAssignments: number;
  capacity: number;
}

interface ParSummary {
  bucket: ParBucket;
  count: number;
  totalOutstanding: number;
  percentage: number;
}

interface CollectionStats {
  totalOverdue: number;
  totalOverdueAmount: number;
  totalPortfolio: number;
  par30: number;
  par90: number;
  collectedToday: number;
  collectedThisMonth: number;
  promisedThisWeek: number;
}

interface RecordPaymentForm {
  loanId: string;
  amount: number;
  method: 'cash' | 'momo' | 'bank_transfer';
  reference: string;
  notes?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── PAR Bucket Badge ─────────────────────────────────────────────────────────

function ParBucketBadge({ bucket }: { bucket: ParBucket }) {
  const map: Record<ParBucket, string> = {
    '1-30': 'bg-yellow-100 text-yellow-700',
    '31-60': 'bg-orange-100 text-orange-700',
    '61-90': 'bg-red-100 text-red-700',
    '91-180': 'bg-red-200 text-red-800 font-bold',
    '180+': 'bg-red-300 text-red-900 font-bold',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${map[bucket]}`}>
      PAR {bucket}d
    </span>
  );
}

function CollectionStatusBadge({ status }: { status: CollectionStatus }) {
  const map: Record<CollectionStatus, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-gray-100 text-gray-600' },
    in_progress: { label: 'In Progress', className: 'bg-blue-100 text-blue-700' },
    paid: { label: 'Paid', className: 'bg-green-100 text-green-700' },
    promise_to_pay: { label: 'Promise', className: 'bg-yellow-100 text-yellow-700' },
    escalated: { label: 'Escalated', className: 'bg-orange-100 text-orange-700' },
    written_off: { label: 'Written Off', className: 'bg-red-100 text-red-600' },
  };
  const { label, className } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: CollectionStats }) {
  const parRate = stats.totalPortfolio > 0 ? (stats.totalOverdueAmount / stats.totalPortfolio) * 100 : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        {
          label: 'Total Overdue',
          value: `GHS ${stats.totalOverdueAmount.toLocaleString()}`,
          sub: `${stats.totalOverdue} loans`,
          color: 'text-red-600',
          bg: 'bg-red-50',
          Icon: AlertTriangle,
        },
        {
          label: 'PAR Rate',
          value: `${parRate.toFixed(2)}%`,
          sub: `PAR30: ${stats.par30.toFixed(1)}%`,
          color: parRate > 5 ? 'text-red-600' : parRate > 3 ? 'text-yellow-600' : 'text-green-600',
          bg: 'bg-white',
          Icon: TrendingDown,
        },
        {
          label: 'Collected Today',
          value: `GHS ${stats.collectedToday.toLocaleString()}`,
          sub: 'Today',
          color: 'text-green-600',
          bg: 'bg-green-50',
          Icon: CheckCircle,
        },
        {
          label: 'Collected This Month',
          value: `GHS ${stats.collectedThisMonth.toLocaleString()}`,
          sub: 'Month-to-date',
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          Icon: DollarSign,
        },
      ].map(({ label, value, sub, color, bg, Icon }) => (
        <div key={label} className={`${bg} border border-gray-200 rounded-xl p-4`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500">{label}</p>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <p className={`text-lg font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-400">{sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── PAR Summary Bar ──────────────────────────────────────────────────────────

function ParSummaryBar({ buckets }: { buckets: ParSummary[] }) {
  const total = buckets.reduce((s, b) => s + b.totalOutstanding, 0);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Portfolio at Risk — Aging Buckets</h3>
      <div className="flex gap-1 h-4 rounded-full overflow-hidden">
        {buckets.map((b, i) => {
          const pct = total > 0 ? (b.totalOutstanding / total) * 100 : 0;
          const colors = ['bg-yellow-400', 'bg-orange-400', 'bg-red-400', 'bg-red-600', 'bg-red-800'];
          return (
            <div
              key={b.bucket}
              className={colors[i]}
              style={{ width: `${pct}%` }}
              title={`PAR ${b.bucket}d: GHS ${b.totalOutstanding.toLocaleString()} (${b.count} loans)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {buckets.map((b, i) => {
          const colors = ['text-yellow-600', 'text-orange-600', 'text-red-500', 'text-red-700', 'text-red-900'];
          return (
            <div key={b.bucket} className="text-center">
              <p className={`text-xs font-bold ${colors[i]}`}>PAR {b.bucket}d</p>
              <p className="text-xs text-gray-500">{b.count} loans</p>
              <p className="text-xs font-medium text-gray-700">GHS {b.totalOutstanding.toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Assign Agent Modal ───────────────────────────────────────────────────────

function AssignAgentModal({
  loan,
  agents,
  onClose,
  onAssigned,
}: {
  loan: OverdueLoan;
  agents: FieldAgent[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selectedAgent, setSelectedAgent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const assign = async () => {
    if (!selectedAgent) return;
    setSubmitting(true);
    await fetch(`/api/collections/${loan.loanId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: selectedAgent }),
    });
    await mutate('/api/collections');
    setSubmitting(false);
    onAssigned();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
        <h3 className="text-base font-bold text-gray-900 mb-1">Assign Field Agent</h3>
        <p className="text-sm text-gray-500 mb-4">{loan.customerName} — {loan.loanId}</p>
        <div className="space-y-2">
          {agents.map((agent) => (
            <label key={agent.agentId} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer ${selectedAgent === agent.agentId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" name="agent" value={agent.agentId} checked={selectedAgent === agent.agentId} onChange={() => setSelectedAgent(agent.agentId)} className="sr-only" />
                <User className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{agent.name}</p>
                  <p className="text-xs text-gray-400">{agent.region}</p>
                </div>
              </div>
              <span className={`text-xs ${agent.activeAssignments >= agent.capacity ? 'text-red-500' : 'text-green-600'}`}>
                {agent.activeAssignments}/{agent.capacity}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={assign} disabled={!selectedAgent || submitting} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({ loan, onClose, onRecorded }: { loan: OverdueLoan; onClose: () => void; onRecorded: () => void }) {
  const [form, setForm] = useState<RecordPaymentForm>({
    loanId: loan.loanId,
    amount: loan.overdueAmount,
    method: 'cash',
    reference: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.amount || !form.reference) return;
    setSubmitting(true);
    await fetch('/api/collections/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await mutate('/api/collections');
    setSubmitting(false);
    onRecorded();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
        <h3 className="text-base font-bold text-gray-900 mb-1">Record Payment</h3>
        <p className="text-sm text-gray-500 mb-4">{loan.customerName}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Amount (GHS)</label>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Method</label>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as RecordPaymentForm['method'] })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="cash">Cash</option>
              <option value="momo">Mobile Money</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Reference *</label>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Receipt / transaction reference" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onClick={submit} disabled={!form.amount || !form.reference || submitting} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {submitting ? 'Recording…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Loan Row ─────────────────────────────────────────────────────────────────

function LoanRow({ loan, agents, onUpdate }: { loan: OverdueLoan; agents: FieldAgent[]; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const scheduleCall = async (date: string) => {
    setScheduling(true);
    await fetch(`/api/collections/${loan.loanId}/schedule-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: date }),
    });
    setScheduling(false);
    onUpdate();
  };

  return (
    <>
      <div className={`border rounded-xl mb-2 overflow-hidden ${loan.parBucket === '180+' || loan.parBucket === '91-180' ? 'border-red-200' : 'border-gray-200'}`}>
        {/* Row Header */}
        <div className="p-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 truncate">{loan.customerName}</p>
                <ParBucketBadge bucket={loan.parBucket} />
                <CollectionStatusBadge status={loan.collectionStatus} />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{loan.loanId} · {loan.region}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-base font-bold text-red-600">GHS {loan.overdueAmount.toLocaleString()}</p>
              <p className="text-xs text-gray-400">{loan.daysOverdue}d overdue</p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <a href={`tel:${loan.phoneNumber}`} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 font-medium hover:bg-blue-100">
              <Phone className="w-3 h-3" />
              Call
            </a>
            <button onClick={() => setShowPayment(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 font-medium hover:bg-green-100">
              <DollarSign className="w-3 h-3" />
              Payment
            </button>
            <button onClick={() => setShowAssign(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 font-medium hover:bg-gray-100">
              <User className="w-3 h-3" />
              {loan.assignedAgentName ?? 'Assign'}
            </button>
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700">
              <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              Details
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {expanded && (
          <div className="border-t border-gray-100 p-4 bg-gray-50 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-400">Outstanding Balance</p>
              <p className="font-medium">GHS {loan.outstandingBalance.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-400">Last Payment</p>
              <p className="font-medium">
                {loan.lastPaymentDate ? `${loan.lastPaymentDate} · GHS ${loan.lastPaymentAmount?.toLocaleString()}` : 'Never'}
              </p>
            </div>
            <div>
              <p className="text-gray-400">Address</p>
              <p className="font-medium flex items-center gap-1"><MapPin className="w-3 h-3" />{loan.address}</p>
            </div>
            <div>
              <p className="text-gray-400">Next Call Scheduled</p>
              <p className="font-medium">{loan.nextCallScheduled ?? 'Not set'}</p>
            </div>
            {loan.promiseDate && (
              <div>
                <p className="text-gray-400">Promise Date</p>
                <p className="font-medium text-yellow-700">
                  <Calendar className="w-3 h-3 inline mr-1" />
                  {loan.promiseDate} · GHS {loan.promiseAmount?.toLocaleString()}
                </p>
              </div>
            )}
            {loan.notes && (
              <div className="col-span-2">
                <p className="text-gray-400">Notes</p>
                <p className="text-gray-700">{loan.notes}</p>
              </div>
            )}
            <div className="col-span-2">
              <label className="text-gray-400 block mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Schedule Call</label>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  min={new Date().toISOString().slice(0, 16)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs flex-1"
                  onChange={(e) => e.target.value && scheduleCall(e.target.value)}
                />
                {scheduling && <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />}
              </div>
            </div>
          </div>
        )}
      </div>

      {showAssign && <AssignAgentModal loan={loan} agents={agents} onClose={() => setShowAssign(false)} onAssigned={() => { setShowAssign(false); onUpdate(); }} />}
      {showPayment && <RecordPaymentModal loan={loan} onClose={() => setShowPayment(false)} onRecorded={() => { setShowPayment(false); onUpdate(); }} />}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface CollectionsDashboardProps {
  branchCode?: string;
  agentId?: string;
}

export function CollectionsDashboard({ branchCode, agentId }: CollectionsDashboardProps) {
  const [parFilter, setParFilter] = useState<ParBucket | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<CollectionStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const params = new URLSearchParams();
  if (branchCode) params.set('branch', branchCode);
  if (agentId) params.set('agent', agentId);
  if (parFilter !== 'all') params.set('par', parFilter);
  if (statusFilter !== 'all') params.set('status', statusFilter);

  const { data: stats } = useSWR<CollectionStats>('/api/collections/stats', fetcher, { refreshInterval: 60_000 });
  const { data: loans, mutate: refreshLoans } = useSWR<OverdueLoan[]>(`/api/collections?${params}`, fetcher);
  const { data: agents } = useSWR<FieldAgent[]>('/api/agents', fetcher);
  const { data: parData } = useSWR<ParSummary[]>('/api/collections/par-summary', fetcher);

  const filtered = (loans ?? []).filter((l) =>
    searchQuery
      ? l.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.loanId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.phoneNumber.includes(searchQuery)
      : true
  );

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingDown className="w-6 h-6 text-red-600" />
          Collections Dashboard
        </h1>
        <button onClick={() => refreshLoans()} className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {stats && <StatsBar stats={stats} />}
      {parData && parData.length > 0 && <ParSummaryBar buckets={parData} />}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <Filter className="w-4 h-4" />
          <span className="font-medium">Filter:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', '1-30', '31-60', '61-90', '91-180', '180+'] as const).map((b) => (
            <button key={b} onClick={() => setParFilter(b)} className={`px-3 py-1 rounded-lg text-xs font-medium ${parFilter === b ? 'bg-red-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {b === 'all' ? 'All PAR' : `PAR ${b}d`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'pending', 'in_progress', 'promise_to_pay', 'escalated'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {s === 'all' ? 'All Status' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search name, loan ID, phone…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search overdue loans"
        />
      </div>

      {/* Loan List */}
      <div>
        <p className="text-xs text-gray-500 mb-2">{filtered.length} loan{filtered.length !== 1 ? 's' : ''} shown</p>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 bg-white rounded-xl border border-gray-200 text-gray-400">
            <CheckCircle className="w-8 h-8 mb-2 text-green-400" />
            <p className="text-sm">No overdue loans match your filters</p>
          </div>
        ) : (
          filtered.map((loan) => (
            <LoanRow
              key={loan.loanId}
              loan={loan}
              agents={agents ?? []}
              onUpdate={() => refreshLoans()}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default CollectionsDashboard;

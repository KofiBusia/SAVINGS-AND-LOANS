'use client';

import React, { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Users,
  Plus,
  Calendar,
  MapPin,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Edit2,
  UserPlus,
  Shield,
  Clock,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupStatus = 'formation' | 'active' | 'dormant' | 'dissolved';
type MemberRole = 'chairperson' | 'treasurer' | 'secretary' | 'member' | 'guarantor';
type MeetingFrequency = 'weekly' | 'biweekly' | 'monthly';

interface GroupMember {
  memberId: string;
  customerId: string;
  fullName: string;
  role: MemberRole;
  joinedAt: string;
  guaranteedLoans: string[];
  activeLoans: number;
  savingsBalance: number;
  kycVerified: boolean;
  attendanceRate: number;
}

interface MeetingRecord {
  meetingId: string;
  scheduledDate: string;
  actualDate?: string;
  location: string;
  attendees: number;
  totalMembers: number;
  agenda: string[];
  minutesRecorded: boolean;
  collectionsAmount?: number;
}

interface SolidarityGroup {
  groupId: string;
  name: string;
  groupCode: string;
  status: GroupStatus;
  formationDate: string;
  branchCode: string;
  fieldAgentId: string;
  fieldAgentName: string;
  meetingFrequency: MeetingFrequency;
  meetingDay: string;
  meetingTime: string;
  meetingLocation: string;
  members: GroupMember[];
  upcomingMeeting: MeetingRecord;
  pastMeetings: MeetingRecord[];
  totalLoanPortfolio: number;
  collectiveSavings: number;
  groupCreditScore: number;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const CreateGroupSchema = z.object({
  name: z.string().min(3, 'Group name must be at least 3 characters').max(100),
  branchCode: z.string().min(1, 'Branch is required'),
  meetingFrequency: z.enum(['weekly', 'biweekly', 'monthly']),
  meetingDay: z.string().min(1, 'Meeting day required'),
  meetingTime: z.string().min(1, 'Meeting time required'),
  meetingLocation: z.string().min(3, 'Location required'),
  fieldAgentId: z.string().min(1, 'Field agent required'),
});

type CreateGroupFormData = z.infer<typeof CreateGroupSchema>;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── Sub-components ───────────────────────────────────────────────────────────

function GroupStatusBadge({ status }: { status: GroupStatus }) {
  const map: Record<GroupStatus, { label: string; className: string }> = {
    formation: { label: 'Formation', className: 'bg-yellow-100 text-yellow-700' },
    active: { label: 'Active', className: 'bg-green-100 text-green-700' },
    dormant: { label: 'Dormant', className: 'bg-gray-100 text-gray-600' },
    dissolved: { label: 'Dissolved', className: 'bg-red-100 text-red-700' },
  };
  const { label, className } = map[status];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>{label}</span>
  );
}

function MemberRoleBadge({ role }: { role: MemberRole }) {
  const map: Record<MemberRole, { label: string; className: string }> = {
    chairperson: { label: 'Chair', className: 'bg-purple-100 text-purple-700' },
    treasurer: { label: 'Treasurer', className: 'bg-blue-100 text-blue-700' },
    secretary: { label: 'Secretary', className: 'bg-teal-100 text-teal-700' },
    member: { label: 'Member', className: 'bg-gray-100 text-gray-600' },
    guarantor: { label: 'Guarantor', className: 'bg-orange-100 text-orange-700' },
  };
  const { label, className } = map[role];
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${className}`}>{label}</span>
  );
}

function MemberRow({ member }: { member: GroupMember }) {
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-blue-700">
              {member.fullName.charAt(0)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{member.fullName}</p>
            <p className="text-xs text-gray-400">{member.customerId}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4">
        <MemberRoleBadge role={member.role} />
      </td>
      <td className="py-3 pr-4 text-sm text-gray-600">
        GHS {member.savingsBalance.toLocaleString()}
      </td>
      <td className="py-3 pr-4 text-sm">
        <span className={member.activeLoans > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}>
          {member.activeLoans}
        </span>
      </td>
      <td className="py-3 pr-4 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-16">
            <div
              className={`h-1.5 rounded-full ${
                member.attendanceRate >= 80
                  ? 'bg-green-500'
                  : member.attendanceRate >= 60
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${member.attendanceRate}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{member.attendanceRate}%</span>
        </div>
      </td>
      <td className="py-3">
        {member.kycVerified ? (
          <CheckCircle className="w-4 h-4 text-green-500" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        )}
      </td>
    </tr>
  );
}

function MeetingCard({ meeting, isPast = false }: { meeting: MeetingRecord; isPast?: boolean }) {
  const attendanceRate =
    meeting.totalMembers > 0
      ? Math.round((meeting.attendees / meeting.totalMembers) * 100)
      : 0;

  return (
    <div
      className={`border rounded-lg p-4 ${isPast ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {new Date(meeting.scheduledDate).toLocaleDateString('en-GH', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
            <MapPin className="w-3 h-3" />
            {meeting.location}
          </div>
        </div>
        <div className="text-right">
          {isPast && (
            <>
              <p className="text-xs text-gray-500">Attendance</p>
              <p className="text-sm font-semibold text-gray-900">
                {meeting.attendees}/{meeting.totalMembers} ({attendanceRate}%)
              </p>
            </>
          )}
          {!isPast && (
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
              Upcoming
            </span>
          )}
        </div>
      </div>
      {meeting.agenda.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-400 font-medium mb-1">Agenda:</p>
          <ul className="space-y-0.5">
            {meeting.agenda.slice(0, 3).map((item, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-center gap-1.5">
                <span className="w-1 h-1 bg-gray-400 rounded-full flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isPast && meeting.collectionsAmount !== undefined && (
        <p className="mt-2 text-xs font-semibold text-green-700">
          Collections: GHS {meeting.collectionsAmount.toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ─── Create Group Modal ───────────────────────────────────────────────────────

function CreateGroupModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateGroupFormData>({ resolver: zodResolver(CreateGroupSchema) });

  const onSubmit = async (data: CreateGroupFormData) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      await mutate('/api/groups');
      onSuccess();
    }
  };

  const inputClass = (err?: { message?: string }) =>
    `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      err ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100">
          <h2 id="create-group-title" className="text-lg font-bold text-gray-900">
            Form New Solidarity Group
          </h2>
          <p className="text-sm text-gray-500 mt-1">Minimum 5 members required for loan eligibility</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Group Name *</label>
            <input {...register('name')} placeholder="e.g. Adenta Women Traders Group" className={inputClass(errors.name)} />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Branch *</label>
            <select {...register('branchCode')} className={inputClass(errors.branchCode)}>
              <option value="">Select branch…</option>
              <option value="ACC-MAIN">Accra Main</option>
              <option value="ACC-TEMA">Tema</option>
              <option value="KSI-MAIN">Kumasi Main</option>
              <option value="TAK-MAIN">Takoradi</option>
              <option value="TAM-MAIN">Tamale</option>
              <option value="HO-MAIN">Ho</option>
              <option value="SUK-MAIN">Sunyani</option>
            </select>
            {errors.branchCode && <p className="text-xs text-red-600 mt-1">{errors.branchCode.message}</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Frequency *</label>
              <select {...register('meetingFrequency')} className={inputClass(errors.meetingFrequency)}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Day *</label>
              <select {...register('meetingDay')} className={inputClass(errors.meetingDay)}>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Time *</label>
              <input {...register('meetingTime')} type="time" className={inputClass(errors.meetingTime)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Meeting Location *</label>
            <input {...register('meetingLocation')} placeholder="e.g. Community Centre, Market Square" className={inputClass(errors.meetingLocation)} />
            {errors.meetingLocation && <p className="text-xs text-red-600 mt-1">{errors.meetingLocation.message}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Assigned Field Agent *</label>
            <input {...register('fieldAgentId')} placeholder="Agent ID" className={inputClass(errors.fieldAgentId)} />
            {errors.fieldAgentId && <p className="text-xs text-red-600 mt-1">{errors.fieldAgentId.message}</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Group Detail Panel ───────────────────────────────────────────────────────

function GroupDetailPanel({ group }: { group: SolidarityGroup }) {
  const [showPastMeetings, setShowPastMeetings] = useState(false);
  const unverifiedCount = group.members.filter((m) => !m.kycVerified).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Group Header */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">{group.name}</h3>
              <GroupStatusBadge status={group.status} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {group.groupCode} · {group.branchCode}
            </p>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
              <Calendar className="w-3 h-3" />
              {group.meetingFrequency.charAt(0).toUpperCase() + group.meetingFrequency.slice(1)} on {group.meetingDay}s at{' '}
              {group.meetingTime}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Group Credit Score</p>
            <p
              className={`text-xl font-bold ${
                group.groupCreditScore >= 700
                  ? 'text-green-600'
                  : group.groupCreditScore >= 500
                  ? 'text-yellow-600'
                  : 'text-red-600'
              }`}
            >
              {group.groupCreditScore}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-400">Members</p>
            <p className="text-lg font-bold text-gray-900">{group.members.length}</p>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <p className="text-xs text-gray-400">Total Loans</p>
            <p className="text-base font-bold text-blue-700">
              GHS {group.totalLoanPortfolio.toLocaleString()}
            </p>
          </div>
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <p className="text-xs text-gray-400">Group Savings</p>
            <p className="text-base font-bold text-green-700">
              GHS {group.collectiveSavings.toLocaleString()}
            </p>
          </div>
        </div>

        {unverifiedCount > 0 && (
          <div className="mt-3 flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {unverifiedCount} member(s) pending KYC verification
          </div>
        )}
      </div>

      {/* Members Table */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            Members ({group.members.length})
          </h4>
          <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
            <UserPlus className="w-3.5 h-3.5" />
            Add Member
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label={`Members of ${group.name}`}>
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="pb-2 font-medium">Member</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Savings</th>
                <th className="pb-2 font-medium">Loans</th>
                <th className="pb-2 font-medium">Attendance</th>
                <th className="pb-2 font-medium">KYC</th>
              </tr>
            </thead>
            <tbody>
              {group.members.map((m) => (
                <MemberRow key={m.memberId} member={m} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Meetings */}
      <div className="px-5 pb-5">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-blue-600" />
          Meetings
        </h4>
        <MeetingCard meeting={group.upcomingMeeting} />
        <button
          onClick={() => setShowPastMeetings(!showPastMeetings)}
          className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
        >
          {showPastMeetings ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showPastMeetings ? 'Hide' : 'Show'} past meetings ({group.pastMeetings.length})
        </button>
        {showPastMeetings && (
          <div className="mt-3 space-y-2">
            {group.pastMeetings.map((m) => (
              <MeetingCard key={m.meetingId} meeting={m} isPast />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface GroupManagementProps {
  branchFilter?: string;
}

export function GroupManagement({ branchFilter }: GroupManagementProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GroupStatus | 'all'>('all');

  const url = `/api/groups?${branchFilter ? `branch=${branchFilter}&` : ''}status=${statusFilter !== 'all' ? statusFilter : ''}`;
  const { data: groups, error, isLoading } = useSWR<SolidarityGroup[]>(url, fetcher);

  const selectedGroup = groups?.find((g) => g.groupId === selectedGroupId);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" />
            Group Lending Management
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Solidarity groups, guarantors, and meeting schedules
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          aria-label="Create new solidarity group"
        >
          <Plus className="w-4 h-4" />
          New Group
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'formation', 'active', 'dormant', 'dissolved'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4" />
          Failed to load groups.
        </div>
      )}

      {!isLoading && !error && groups && (
        <div className={`grid gap-4 ${selectedGroup ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {/* Groups List */}
          <div className={`space-y-3 ${selectedGroup ? 'lg:col-span-1' : 'lg:col-span-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3'}`}
          style={selectedGroup ? {} : { display: 'grid' }}>
            {groups.map((group) => (
              <button
                key={group.groupId}
                onClick={() => setSelectedGroupId(group.groupId === selectedGroupId ? null : group.groupId)}
                className={`text-left bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-all ${
                  selectedGroupId === group.groupId ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{group.name}</p>
                    <p className="text-xs text-gray-400">{group.groupCode}</p>
                  </div>
                  <GroupStatusBadge status={group.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {group.members.length} members
                  </span>
                  <span className="flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Score: {group.groupCreditScore}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {group.meetingFrequency}
                  </span>
                  <span className="flex items-center gap-1">
                    <Edit2 className="w-3 h-3" />
                    {group.fieldAgentName}
                  </span>
                </div>
              </button>
            ))}
            {groups.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center h-40 text-gray-400">
                <Users className="w-10 h-10 mb-2" />
                <p className="text-sm">No groups found</p>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selectedGroup && (
            <div className="lg:col-span-2">
              <GroupDetailPanel group={selectedGroup} />
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateGroupModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

export default GroupManagement;

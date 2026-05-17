'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  User,
  CreditCard,
  Shield,
  ClipboardList,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalStep = 'applicant' | 'credit_score' | 'documents' | 'pre_agreement' | 'decision';
type DecisionType = 'approve' | 'reject' | 'refer' | 'counter_offer';

interface LoanApplicant {
  applicationId: string;
  customerId: string;
  fullName: string;
  ghanaCardNumber: string;
  dateOfBirth: string;
  phoneNumber: string;
  address: string;
  occupation: string;
  monthlyIncome: number;
  employer?: string;
  yearsEmployed?: number;
  loanPurpose: string;
  requestedAmount: number;
  requestedTerm: number;
  product: string;
  kycStatus: 'verified' | 'pending' | 'expired';
  riskTier: 'low' | 'medium' | 'high';
  existingLoans: number;
  existingLoanBalance: number;
  submittedAt: string;
  branchCode: string;
}

interface CreditAssessment {
  creditScore: number;
  bureauProvider: string;
  checkedAt: string;
  debtToIncomeRatio: number;
  maxEligibleAmount: number;
  affordabilityNote: string;
  pepMatch: boolean;
  sanctionsMatch: boolean;
  defaultHistory: boolean;
  recommendation: 'approve' | 'decline' | 'manual_review';
}

interface RequiredDocument {
  docType: string;
  label: string;
  required: boolean;
  status: 'uploaded' | 'missing' | 'rejected' | 'verified';
  uploadedAt?: string;
  rejectionReason?: string;
}

interface PreAgreement {
  principalAmount: number;
  interestRate: number;
  term: number;
  monthlyInstalment: number;
  totalInterest: number;
  totalRepayable: number;
  annualPercentageRate: number;
  disbursementFee: number;
  processingFee: number;
  earlySettlementPolicy: string;
  latePaymentPenalty: string;
  securityRequired: string;
  dcdVersion: string;
}

interface ApprovalDecisionForm {
  decision: DecisionType;
  approvedAmount?: number;
  approvedTerm?: number;
  approvedRate?: number;
  conditionsOfApproval?: string;
  rejectionReason?: string;
  referralNotes?: string;
  supervisorId?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'refer', 'counter_offer']),
  approvedAmount: z.number().positive().optional(),
  approvedTerm: z.number().int().positive().optional(),
  approvedRate: z.number().positive().max(100).optional(),
  conditionsOfApproval: z.string().max(1000).optional(),
  rejectionReason: z.string().min(10, 'Please provide a detailed reason').max(1000).optional(),
  referralNotes: z.string().max(1000).optional(),
  supervisorId: z.string().optional(),
}).refine((d) => {
  if (d.decision === 'reject' && !d.rejectionReason) return false;
  return true;
}, { message: 'Rejection reason is required', path: ['rejectionReason'] });

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── Step Components ──────────────────────────────────────────────────────────

function ApplicantStep({ applicant }: { applicant: LoanApplicant }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: 'Full Name', value: applicant.fullName },
          { label: 'Ghana Card', value: applicant.ghanaCardNumber },
          { label: 'Date of Birth', value: applicant.dateOfBirth },
          { label: 'Phone', value: applicant.phoneNumber },
          { label: 'Address', value: applicant.address },
          { label: 'Occupation', value: applicant.occupation },
          { label: 'Employer', value: applicant.employer ?? 'N/A' },
          { label: 'Monthly Income', value: `GHS ${applicant.monthlyIncome.toLocaleString()}` },
          { label: 'Years Employed', value: applicant.yearsEmployed?.toString() ?? 'N/A' },
          { label: 'Existing Loans', value: applicant.existingLoans.toString() },
          { label: 'Existing Balance', value: `GHS ${applicant.existingLoanBalance.toLocaleString()}` },
          { label: 'KYC Status', value: applicant.kycStatus.toUpperCase() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-xs text-gray-500 font-medium">Loan Request</p>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <div>
            <p className="text-xs text-gray-500">Amount</p>
            <p className="text-base font-bold text-blue-700">
              GHS {applicant.requestedAmount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Term</p>
            <p className="text-base font-bold text-gray-900">{applicant.requestedTerm} months</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Purpose</p>
            <p className="text-sm font-medium text-gray-700">{applicant.loanPurpose}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreditScoreStep({ assessment }: { assessment: CreditAssessment }) {
  const scoreColor =
    assessment.creditScore >= 700 ? 'text-green-600' : assessment.creditScore >= 500 ? 'text-yellow-600' : 'text-red-600';
  const scoreWidth = `${Math.min((assessment.creditScore / 850) * 100, 100)}%`;

  return (
    <div className="space-y-4">
      {/* Score Gauge */}
      <div className="bg-gray-50 rounded-xl p-5 text-center">
        <p className="text-xs text-gray-500 mb-1">Credit Score ({assessment.bureauProvider})</p>
        <p className={`text-5xl font-bold ${scoreColor}`}>{assessment.creditScore}</p>
        <div className="mt-3 bg-gray-200 rounded-full h-3 w-full max-w-xs mx-auto">
          <div
            className={`h-3 rounded-full transition-all ${
              assessment.creditScore >= 700
                ? 'bg-green-500'
                : assessment.creditScore >= 500
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
            style={{ width: scoreWidth }}
            role="progressbar"
            aria-valuenow={assessment.creditScore}
            aria-valuemin={300}
            aria-valuemax={850}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">Range: 300 – 850 | Checked: {new Date(assessment.checkedAt).toLocaleString()}</p>
      </div>

      {/* Flags */}
      {(assessment.pepMatch || assessment.sanctionsMatch || assessment.defaultHistory) && (
        <div className="space-y-2">
          {assessment.pepMatch && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <strong>PEP Match Detected</strong> — Enhanced Due Diligence required
            </div>
          )}
          {assessment.sanctionsMatch && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4" />
              <strong>Sanctions Match</strong> — Application cannot proceed
            </div>
          )}
          {assessment.defaultHistory && (
            <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-700 text-sm">
              <AlertTriangle className="w-4 h-4" />
              Default history on record — manual review required
            </div>
          )}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">Debt-to-Income Ratio</p>
          <p className={`text-base font-bold ${assessment.debtToIncomeRatio > 0.4 ? 'text-red-600' : 'text-green-600'}`}>
            {(assessment.debtToIncomeRatio * 100).toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400">Max recommended: 40%</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500">Max Eligible Amount</p>
          <p className="text-base font-bold text-blue-700">
            GHS {assessment.maxEligibleAmount.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <p className="font-medium">Affordability Note:</p>
        <p>{assessment.affordabilityNote}</p>
      </div>

      <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${
        assessment.recommendation === 'approve'
          ? 'bg-green-50 border border-green-200 text-green-700'
          : assessment.recommendation === 'decline'
          ? 'bg-red-50 border border-red-200 text-red-700'
          : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
      }`}>
        {assessment.recommendation === 'approve' ? (
          <CheckCircle className="w-4 h-4" />
        ) : assessment.recommendation === 'decline' ? (
          <XCircle className="w-4 h-4" />
        ) : (
          <AlertTriangle className="w-4 h-4" />
        )}
        Bureau Recommendation: {assessment.recommendation.replace('_', ' ').toUpperCase()}
      </div>
    </div>
  );
}

function DocumentsStep({ documents }: { documents: RequiredDocument[] }) {
  const allUploaded = documents.filter((d) => d.required).every((d) => d.status === 'uploaded' || d.status === 'verified');

  return (
    <div className="space-y-3">
      {!allUploaded && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          <AlertTriangle className="w-4 h-4" />
          Some required documents are missing. Approval cannot proceed.
        </div>
      )}
      {documents.map((doc) => (
        <div
          key={doc.docType}
          className={`flex items-center justify-between p-4 rounded-lg border ${
            doc.status === 'verified'
              ? 'bg-green-50 border-green-200'
              : doc.status === 'uploaded'
              ? 'bg-blue-50 border-blue-200'
              : doc.status === 'rejected'
              ? 'bg-red-50 border-red-200'
              : 'bg-gray-50 border-gray-200'
          }`}
        >
          <div className="flex items-center gap-3">
            {doc.status === 'verified' || doc.status === 'uploaded' ? (
              <CheckCircle className={`w-5 h-5 ${doc.status === 'verified' ? 'text-green-500' : 'text-blue-500'}`} />
            ) : doc.status === 'rejected' ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-900">
                {doc.label}
                {doc.required && <span className="text-red-500 ml-1">*</span>}
              </p>
              {doc.uploadedAt && (
                <p className="text-xs text-gray-400">Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()}</p>
              )}
              {doc.rejectionReason && (
                <p className="text-xs text-red-600">{doc.rejectionReason}</p>
              )}
            </div>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              doc.status === 'verified'
                ? 'bg-green-100 text-green-700'
                : doc.status === 'uploaded'
                ? 'bg-blue-100 text-blue-700'
                : doc.status === 'rejected'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {doc.status.toUpperCase()}
          </span>
        </div>
      ))}
    </div>
  );
}

function PreAgreementStep({ agreement }: { agreement: PreAgreement }) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2 mb-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-blue-900">
              Pre-Agreement Disclosure — DCD {agreement.dcdVersion}
            </p>
            <p className="text-xs text-blue-700 mt-0.5">
              Mandatory disclosure per Bank of Ghana Digital Credit Directive 2025.
              Customer must acknowledge before disbursement.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Principal Amount', value: `GHS ${agreement.principalAmount.toLocaleString()}` },
          { label: 'Annual Interest Rate', value: `${agreement.interestRate}% p.a. (simple)` },
          { label: 'Loan Term', value: `${agreement.term} months` },
          { label: 'Monthly Instalment', value: `GHS ${agreement.monthlyInstalment.toLocaleString()}` },
          { label: 'Total Interest', value: `GHS ${agreement.totalInterest.toLocaleString()}` },
          { label: 'Total Repayable', value: `GHS ${agreement.totalRepayable.toLocaleString()}` },
          { label: 'Annual Percentage Rate (APR)', value: `${agreement.annualPercentageRate}%` },
          { label: 'Disbursement Fee', value: `GHS ${agreement.disbursementFee.toLocaleString()}` },
          { label: 'Processing Fee', value: `GHS ${agreement.processingFee.toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm font-semibold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-2 text-sm">
        <div>
          <p className="text-xs font-semibold text-gray-700">Early Settlement Policy:</p>
          <p className="text-xs text-gray-600">{agreement.earlySettlementPolicy}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-700">Late Payment Penalty:</p>
          <p className="text-xs text-gray-600">{agreement.latePaymentPenalty}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-700">Security / Collateral Required:</p>
          <p className="text-xs text-gray-600">{agreement.securityRequired}</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 italic">
        Note: Interest calculated using simple interest formula only. Compounding interest is
        prohibited under BoG Digital Credit Directive 2025.
      </p>
    </div>
  );
}

function DecisionStep({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (data: ApprovalDecisionForm) => void;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ApprovalDecisionForm>({ resolver: zodResolver(DecisionSchema) });

  const decision = watch('decision');
  const inputClass = (err?: { message?: string }) =>
    `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      err ? 'border-red-400 bg-red-50' : 'border-gray-300'
    }`;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="text-xs font-semibold text-gray-700 block mb-2">Decision *</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'approve', label: 'Approve', color: 'green', Icon: CheckCircle },
            { value: 'reject', label: 'Reject', color: 'red', Icon: XCircle },
            { value: 'counter_offer', label: 'Counter Offer', color: 'blue', Icon: CreditCard },
            { value: 'refer', label: 'Refer to Supervisor', color: 'yellow', Icon: AlertTriangle },
          ].map(({ value, label, color, Icon }) => (
            <label
              key={value}
              className={`flex items-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all ${
                decision === value
                  ? `border-${color}-400 bg-${color}-50`
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input type="radio" value={value} {...register('decision')} className="sr-only" />
              <Icon className={`w-4 h-4 text-${color}-600`} />
              <span className="text-sm font-medium text-gray-900">{label}</span>
            </label>
          ))}
        </div>
        {errors.decision && <p className="text-xs text-red-600 mt-1">{errors.decision.message}</p>}
      </div>

      {(decision === 'approve' || decision === 'counter_offer') && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Approved Amount (GHS)</label>
            <input type="number" {...register('approvedAmount', { valueAsNumber: true })} className={inputClass()} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Term (months)</label>
            <input type="number" {...register('approvedTerm', { valueAsNumber: true })} className={inputClass()} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Rate (% p.a.)</label>
            <input type="number" step="0.01" {...register('approvedRate', { valueAsNumber: true })} className={inputClass()} />
          </div>
        </div>
      )}

      {decision === 'approve' && (
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Conditions of Approval</label>
          <textarea
            {...register('conditionsOfApproval')}
            rows={3}
            placeholder="e.g. Subject to guarantor confirmation, insurance premium payment…"
            className={inputClass()}
          />
        </div>
      )}

      {decision === 'reject' && (
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Rejection Reason *</label>
          <textarea
            {...register('rejectionReason')}
            rows={4}
            placeholder="Provide detailed reason for rejection per BoG guidelines…"
            className={inputClass(errors.rejectionReason)}
          />
          {errors.rejectionReason && (
            <p className="text-xs text-red-600 mt-1">{errors.rejectionReason.message}</p>
          )}
        </div>
      )}

      {decision === 'refer' && (
        <>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Supervisor ID</label>
            <input {...register('supervisorId')} placeholder="Supervisor employee ID" className={inputClass()} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Referral Notes</label>
            <textarea {...register('referralNotes')} rows={3} className={inputClass()} />
          </div>
        </>
      )}

      <div className="pt-2 border-t border-gray-100">
        <button
          type="submit"
          disabled={isSubmitting || !decision}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
            decision === 'approve'
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : decision === 'reject'
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          } disabled:opacity-50`}
        >
          {isSubmitting ? 'Submitting…' : 'Submit Decision'}
        </button>
      </div>
    </form>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface LoanApprovalWorkflowProps {
  applicationId: string;
  onDecisionSubmitted?: (decision: ApprovalDecisionForm) => void;
}

const STEPS: { key: ApprovalStep; label: string; icon: React.ElementType }[] = [
  { key: 'applicant', label: 'Applicant', icon: User },
  { key: 'credit_score', label: 'Credit Score', icon: TrendingUpIcon },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'pre_agreement', label: 'Pre-Agreement', icon: ClipboardList },
  { key: 'decision', label: 'Decision', icon: Shield },
];

// Standalone icon to avoid import confusion
function TrendingUpIcon({ className }: { className?: string }) {
  return <CreditCard className={className} />;
}

export function LoanApprovalWorkflow({ applicationId, onDecisionSubmitted }: LoanApprovalWorkflowProps) {
  const [currentStep, setCurrentStep] = useState<ApprovalStep>('applicant');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { data: applicant } = useSWR<LoanApplicant>(
    `/api/loan-applications/${applicationId}`,
    fetcher
  );
  const { data: credit } = useSWR<CreditAssessment>(
    `/api/loan-applications/${applicationId}/credit-assessment`,
    fetcher
  );
  const { data: docs } = useSWR<RequiredDocument[]>(
    `/api/loan-applications/${applicationId}/documents`,
    fetcher
  );
  const { data: preAgreement } = useSWR<PreAgreement>(
    `/api/loan-applications/${applicationId}/pre-agreement`,
    fetcher
  );

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);

  const handleDecision = async (data: ApprovalDecisionForm) => {
    setIsSubmitting(true);
    try {
      await fetch(`/api/loan-applications/${applicationId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setSubmitted(true);
      onDecisionSubmitted?.(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900">Decision Submitted</h2>
        <p className="text-gray-500 mt-1">Application {applicationId} has been processed.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      {/* Stepper */}
      <nav aria-label="Loan approval steps" className="mb-6">
        <ol className="flex items-center">
          {STEPS.map((step, i) => {
            const isActive = step.key === currentStep;
            const isCompleted = i < stepIndex;
            const Icon = step.icon;
            return (
              <li key={step.key} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => i <= stepIndex && setCurrentStep(step.key)}
                  className={`flex flex-col items-center gap-1 group ${
                    i <= stepIndex ? 'cursor-pointer' : 'cursor-not-allowed'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <div
                    className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors ${
                      isCompleted
                        ? 'bg-blue-600 border-blue-600'
                        : isActive
                        ? 'border-blue-600 bg-white'
                        : 'border-gray-300 bg-white'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle className="w-4 h-4 text-white" />
                    ) : (
                      <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
                    )}
                  </div>
                  <span
                    className={`text-xs hidden sm:block font-medium ${
                      isActive ? 'text-blue-600' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${i < stepIndex ? 'bg-blue-600' : 'bg-gray-200'}`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-5 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {STEPS[stepIndex]?.label}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Application: {applicationId}</p>
        </div>
        <div className="p-5">
          {currentStep === 'applicant' && applicant && <ApplicantStep applicant={applicant} />}
          {currentStep === 'credit_score' && credit && <CreditScoreStep assessment={credit} />}
          {currentStep === 'documents' && docs && <DocumentsStep documents={docs} />}
          {currentStep === 'pre_agreement' && preAgreement && <PreAgreementStep agreement={preAgreement} />}
          {currentStep === 'decision' && (
            <DecisionStep onSubmit={handleDecision} isSubmitting={isSubmitting} />
          )}
          {!applicant && currentStep === 'applicant' && (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          )}
        </div>
        {currentStep !== 'decision' && (
          <div className="px-5 pb-5 flex justify-between">
            <button
              onClick={() => stepIndex > 0 && setCurrentStep(STEPS[stepIndex - 1].key)}
              disabled={stepIndex === 0}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <button
              onClick={() => stepIndex < STEPS.length - 1 && setCurrentStep(STEPS[stepIndex + 1].key)}
              disabled={stepIndex >= STEPS.length - 1}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoanApprovalWorkflow;

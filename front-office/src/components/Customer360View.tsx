"use client";

import React from "react";
import type { Customer } from "../../../shared/src/interfaces/Customer";

interface Customer360ViewProps {
  customerId: string;
  customer: Customer;
}

const riskClassColors: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-red-100 text-red-800",
};

const kycStatusLabels: Record<string, string> = {
  ACTIVE: "KYC Complete",
  PENDING_GHANA_CARD: "Awaiting Ghana Card",
  PENDING_LIVENESS: "Awaiting Liveness Check",
  PENDING_ADDRESS: "Awaiting Address",
  PENDING_INCOME: "Awaiting Income Declaration",
  PENDING_PEP_SCREENING: "Awaiting PEP Screening",
  PENDING_RISK_CLASSIFICATION: "Awaiting Risk Classification",
  PENDING_EDD: "Enhanced Due Diligence Required",
  PENDING_BENEFICIAL_OWNERSHIP: "Awaiting Beneficial Ownership",
  PENDING_CONSENT: "Awaiting Consent",
  PENDING_PRE_AGREEMENT: "Awaiting Pre-Agreement",
  PENDING_ESIGNATURE: "Awaiting E-Signature",
  SUSPENDED: "Account Suspended",
  REJECTED: "KYC Rejected",
};

export function Customer360View({ customer }: Customer360ViewProps) {
  const kycProgress = computeKycProgress(customer.kycStatus);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="text-sm text-gray-500">Account: {customer.accountNumber}</p>
          <p className="text-xs text-gray-400 font-mono">{customer.customerCode}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskClassColors[customer.riskClass] ?? "bg-gray-100"}`}>
            {customer.riskClass} Risk
          </span>
          <span className="text-xs text-gray-500">Score: {customer.riskScore}/100</span>
        </div>
      </div>

      {/* KYC Status */}
      <div className="border rounded-lg p-4 bg-white shadow-sm">
        <h2 className="font-semibold text-gray-700 mb-3">KYC Status</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${kycProgress}%` }}
            />
          </div>
          <span className="text-sm font-medium text-gray-700">{kycProgress}%</span>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {kycStatusLabels[customer.kycStatus] ?? customer.kycStatus}
        </p>
        {customer.kycCompletedAt && (
          <p className="text-xs text-gray-400 mt-1">
            Completed: {new Date(customer.kycCompletedAt).toLocaleDateString("en-GH")}
          </p>
        )}
      </div>

      {/* PEP Screening */}
      {customer.pepScreening && (
        <div className={`border rounded-lg p-4 ${customer.pepScreening.isPep ? "border-red-300 bg-red-50" : "bg-white"} shadow-sm`}>
          <h2 className="font-semibold text-gray-700 mb-2">PEP Screening (AML Act 1044)</h2>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${customer.pepScreening.isPep ? "bg-red-500" : "bg-green-500"}`} />
            <span className="text-sm">
              {customer.pepScreening.isPep ? `PEP - ${customer.pepScreening.pepCategory}` : "Not PEP"}
            </span>
            <span className="text-xs text-gray-500">({customer.pepScreening.outcome})</span>
          </div>
        </div>
      )}

      {/* Contact */}
      <div className="border rounded-lg p-4 bg-white shadow-sm">
        <h2 className="font-semibold text-gray-700 mb-3">Contact & Address</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-500">Phone:</span>
            <span className="ml-2 font-mono">{customer.phoneNumber}</span>
          </div>
          <div>
            <span className="text-gray-500">Region:</span>
            <span className="ml-2">{customer.region}</span>
          </div>
          {customer.ghanaPostGPS && (
            <div>
              <span className="text-gray-500">GhanaPost:</span>
              <span className="ml-2 font-mono">{customer.ghanaPostGPS}</span>
            </div>
          )}
          <div>
            <span className="text-gray-500">Employment:</span>
            <span className="ml-2">{customer.employmentStatus}</span>
          </div>
        </div>
      </div>

      {/* CDD Review */}
      <div className="border rounded-lg p-4 bg-white shadow-sm">
        <h2 className="font-semibold text-gray-700 mb-2">CDD Review Schedule (AML Act 1044)</h2>
        <p className="text-sm text-gray-600">
          Next review due: <span className="font-medium text-orange-600">{new Date(customer.cddNextReviewDate).toLocaleDateString("en-GH")}</span>
        </p>
      </div>

      {/* Regulatory Footer */}
      <div className="text-xs text-gray-400 border-t pt-3">
        Data processed under Data Protection Act 843. Ghana Card is the sole identity document.
        Customer ID: {customer.id}
      </div>
    </div>
  );
}

function computeKycProgress(status: string): number {
  const progressMap: Record<string, number> = {
    PENDING_GHANA_CARD: 8, PENDING_LIVENESS: 16, PENDING_ADDRESS: 25,
    PENDING_INCOME: 33, PENDING_PEP_SCREENING: 41, PENDING_RISK_CLASSIFICATION: 50,
    PENDING_EDD: 58, PENDING_BENEFICIAL_OWNERSHIP: 66, PENDING_CONSENT: 75,
    PENDING_PRE_AGREEMENT: 83, PENDING_ESIGNATURE: 91, ACTIVE: 100,
    SUSPENDED: 100, REJECTED: 0,
  };
  return progressMap[status] ?? 0;
}

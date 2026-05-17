import { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { CollectionsDashboard } from "../components/CollectionsDashboard";
import { ComplianceAlerts } from "../components/ComplianceAlerts";
import { GroupManagement } from "../components/GroupManagement";
import { LoanApprovalWorkflow } from "../components/LoanApprovalWorkflow";
import { FieldOfflineForm } from "../components/FieldOfflineForm";

type Tab = "collections" | "loans" | "groups" | "compliance" | "field";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "collections", label: "Collections", icon: "💰" },
  { id: "loans", label: "Loan Approvals", icon: "📋" },
  { id: "groups", label: "Groups", icon: "👥" },
  { id: "compliance", label: "Compliance", icon: "🔒" },
  { id: "field", label: "Field Form", icon: "📝" },
];

export default function FieldOfficerPortal() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("collections");
  const [loanAppId, setLoanAppId] = useState("");
  const [activeLoanId, setActiveLoanId] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#006B3F] text-white shadow">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight">Ghana Savings &amp; Loans</span>
            <span className="text-xs bg-white/20 rounded-full px-2 py-0.5 font-medium">Field Portal</span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-xs text-white/70 hidden sm:block">{user.email}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-xs bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-3 py-1.5 text-white font-medium transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 flex overflow-x-auto gap-0.5 scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? "bg-gray-50 text-[#006B3F]"
                  : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-4">
        {activeTab === "collections" && <CollectionsDashboard />}

        {activeTab === "loans" && (
          activeLoanId
            ? <LoanApprovalWorkflow
                applicationId={activeLoanId}
                onDecisionSubmitted={() => setActiveLoanId(null)}
              />
            : <div className="p-6 max-w-md mx-auto mt-8">
                <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <h2 className="text-base font-semibold text-gray-900 mb-1">Open Loan Application</h2>
                  <p className="text-sm text-gray-500 mb-4">Enter an application ID to begin the approval workflow.</p>
                  <input
                    type="text"
                    placeholder="Application ID (e.g. APP-2025-00123)"
                    value={loanAppId}
                    onChange={(e) => setLoanAppId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loanAppId.trim() && setActiveLoanId(loanAppId.trim())}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3F] mb-3"
                  />
                  <button
                    onClick={() => loanAppId.trim() && setActiveLoanId(loanAppId.trim())}
                    disabled={!loanAppId.trim()}
                    className="w-full py-2 bg-[#006B3F] text-white rounded-lg text-sm font-medium hover:bg-[#005a34] disabled:opacity-40"
                  >
                    Open Application
                  </button>
                </div>
              </div>
        )}

        {activeTab === "groups" && <GroupManagement />}

        {activeTab === "compliance" && <ComplianceAlerts />}

        {activeTab === "field" && (
          <FieldOfflineForm
            agentId="AGENT-SESSION"
            branchCode="BRANCH-SESSION"
          />
        )}
      </main>
    </div>
  );
}

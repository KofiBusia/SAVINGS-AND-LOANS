/**
 * k6 Load Test - Ghana Peak Traffic Simulation
 *
 * Simulates 10x Ghana peak traffic scenarios:
 * - Monthly salary week (last Friday)
 * - Festive season (December, Easter, Eid)
 * - Market day peaks (Mondays in Kumasi, Fridays in Accra)
 *
 * Run: k6 run tests/load/k6-ghana-peak.js
 * Requires: k6 v0.47+
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const loanApplicationSuccess = new Rate("loan_application_success");
const mobileMoneyPaymentSuccess = new Rate("mobile_money_payment_success");
const kycCompletionTime = new Trend("kyc_completion_time");
const apiLatency = new Trend("api_latency_p95");
const complianceErrors = new Counter("compliance_errors");

// Target: 10x peak = ~10,000 concurrent users
export const options = {
  stages: [
    { duration: "2m", target: 100 },    // Warm up
    { duration: "5m", target: 1000 },   // Normal load
    { duration: "5m", target: 5000 },   // Peak ramp-up (salary week)
    { duration: "10m", target: 10000 }, // Ghana 10x peak (festive season)
    { duration: "5m", target: 5000 },   // Scale down
    { duration: "2m", target: 0 },      // Cool down
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],  // 95% of requests under 3 seconds
    http_req_failed: ["rate<0.01"],     // Error rate < 1%
    loan_application_success: ["rate>0.95"],
    mobile_money_payment_success: ["rate>0.90"],
    compliance_errors: ["count==0"],    // ZERO compliance errors allowed
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:3001/api/v1";

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${__ENV.TEST_JWT_TOKEN || "test-token"}`,
  "X-MFA-Token": "123456",
  "X-Device-Id": "load-test-device",
};

export default function () {
  // Random user behavior weighted by Ghana usage patterns
  const scenario = Math.random();

  if (scenario < 0.40) {
    // 40%: Check account balance (most common action)
    checkBalance();
  } else if (scenario < 0.60) {
    // 20%: View loan status
    viewLoanStatus();
  } else if (scenario < 0.75) {
    // 15%: Make mobile money repayment
    makeMobileMoneyRepayment();
  } else if (scenario < 0.85) {
    // 10%: Apply for new loan
    applyForLoan();
  } else if (scenario < 0.92) {
    // 7%: View savings transactions
    viewSavingsTransactions();
  } else if (scenario < 0.97) {
    // 5%: KYC onboarding step
    kycOnboardingStep();
  } else {
    // 3%: Submit complaint
    submitComplaint();
  }

  sleep(0.5 + Math.random() * 2); // Ghana network latency simulation
}

function checkBalance() {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/savings/balance`, { headers: AUTH_HEADERS });
  apiLatency.add(Date.now() - start);

  check(res, {
    "balance check: status 200": (r) => r.status === 200,
    "balance check: has balance field": (r) => {
      try { return JSON.parse(r.body).balance !== undefined; } catch { return false; }
    },
  });
}

function viewLoanStatus() {
  const res = http.get(`${BASE_URL}/loans?status=REPAYING`, { headers: AUTH_HEADERS });
  check(res, { "loan status: 200 OK": (r) => r.status === 200 });
}

function makeMobileMoneyRepayment() {
  const payload = JSON.stringify({
    loanId: "test-loan-id",
    amount: 150.00,
    channel: "GHIPSS_MTN",
    recipientPhone: "+233244123456",
    narration: "Loan repayment",
  });

  const res = http.post(`${BASE_URL}/loans/repayments`, payload, { headers: AUTH_HEADERS });
  const success = check(res, {
    "momo repayment: accepted": (r) => r.status === 201 || r.status === 200,
    "momo repayment: no compounding error": (r) => {
      // Compliance check: no compounding interest errors should appear
      if (r.body.includes("Compounding")) {
        complianceErrors.add(1);
        return false;
      }
      return true;
    },
  });

  mobileMoneyPaymentSuccess.add(success);
}

function applyForLoan() {
  const payload = JSON.stringify({
    productId: "test-product-id",
    requestedAmount: 2000 + Math.random() * 8000,
    termMonths: [3, 6, 12, 18, 24][Math.floor(Math.random() * 5)],
    purpose: "Business working capital for trading",
    interestType: "SIMPLE",  // Always simple - never compounding
    preAgreementAcknowledged: true,
    consentTimestamp: new Date().toISOString(),
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/loans`, payload, { headers: AUTH_HEADERS });
  kycCompletionTime.add(Date.now() - start);

  const success = check(res, {
    "loan application: created or queued": (r) => r.status === 201 || r.status === 202,
    "loan application: interest type is SIMPLE": (r) => {
      try {
        const body = JSON.parse(r.body);
        if (body.interestType && body.interestType !== "SIMPLE") {
          complianceErrors.add(1);
          return false;
        }
        return true;
      } catch { return true; }
    },
  });

  loanApplicationSuccess.add(success);
}

function viewSavingsTransactions() {
  const res = http.get(`${BASE_URL}/savings/transactions?limit=20`, { headers: AUTH_HEADERS });
  check(res, { "savings transactions: 200": (r) => r.status === 200 });
}

function kycOnboardingStep() {
  // Simulate Ghana Card validation step
  const payload = JSON.stringify({
    cardNumber: "GHA-12345678-9",
    verificationMethod: "OCR_PLUS_NIA",
    livenessScore: 92,
  });

  const res = http.post(`${BASE_URL}/kyc/ghana-card`, payload, { headers: AUTH_HEADERS });
  check(res, {
    "kyc step: processed": (r) => r.status !== 500,
    "kyc step: not compounding error": (r) => !r.body.includes("Compounding"),
  });
}

function submitComplaint() {
  const payload = JSON.stringify({
    category: "LOAN_TERMS",
    description: "Query about loan interest calculation",
    channel: "APP",
  });

  const res = http.post(`${BASE_URL}/complaints`, payload, { headers: AUTH_HEADERS });
  check(res, {
    "complaint: submitted": (r) => r.status === 201 || r.status === 200,
    "complaint: has SLA date": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.slaDate !== undefined; // Should be within 20 days (DCD 2025)
      } catch { return true; }
    },
  });
}

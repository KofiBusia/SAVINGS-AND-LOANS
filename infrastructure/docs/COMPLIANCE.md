# Ghana Regulatory Compliance Guide

## Digital Credit Directive 2025 (Bank of Ghana)

### Key Requirements Implemented
1. **Simple Interest Only** (`interest-calculator.service.ts:calculateSimpleInterest`)
   - Compounding interest throws `RegulatoryError(DCD2025_001)` at runtime
   - CI pipeline has a compliance test that FAILS THE BUILD if compounding is introduced
   - Formula enforced: `I = P × r × t`

2. **Pre-Agreement Display** (`kyc-aml.service.ts:preAgreementDisplay`)
   - Minimum 30 seconds display before e-signature
   - Timestamp stored in immutable audit log

3. **Complaint Resolution** (20 calendar days)
   - SLA tracked in `complaints` table
   - Automated alerts at 15 days (5 days warning)
   - Escalation to compliance officer at breach

4. **Maximum Interest Rate**: 36% per annum
   - Enforced in `interest-calculator.service.ts`
   - Product configurator rejects rates above cap

## AML Act 1044 Compliance

### KYC State Machine (12 Steps)
See `kyc-aml.service.ts` for complete implementation.

| Step | Service Method | Audit Action |
|------|----------------|--------------|
| Ghana Card Scan | `ghanaCardScan()` | `KYC_STATE_CHANGE` |
| Liveness Check | `livenessCheck()` | `KYC_STATE_CHANGE` |
| Address Verification | `addressVerification()` | `KYC_STATE_CHANGE` |
| Income Declaration | `incomeDeclaration()` | `KYC_STATE_CHANGE` |
| PEP Screening | `pepScreening()` | `KYC_STATE_CHANGE` |
| Risk Classification | `riskClassification()` | `KYC_STATE_CHANGE` |
| EDD (if HIGH) | `eddTriggerIfHighRisk()` | `KYC_STATE_CHANGE` |
| Beneficial Ownership | `beneficialOwnershipCapture()` | `KYC_STATE_CHANGE` |
| Consent Capture | `consentCapture()` | `CONSENT_GIVEN` |
| Pre-Agreement | `preAgreementDisplay()` | `KYC_STATE_CHANGE` |
| E-Signature | `eSignature()` | `KYC_STATE_CHANGE` |
| Activation | `accountActivation()` | `CUSTOMER_CREATED` |

### AML Thresholds
- CTR: >= GH₵10,000 (automatic FIC submission)
- STR: Suspicious activity (manual trigger + automated rules)
- EDD: HIGH risk customers and confirmed PEPs
- UBO: >= 25% ownership threshold

## Data Protection Act 843

### Data Residency
All PII must remain in Ghana-permitted regions:
- `gh-accra-1` (primary)
- `gh-kumasi-1` (secondary/backup)
- `gh-tamale-1` (northern region)

The `GhanaDataResidencyGuard` blocks all PII exports to non-Ghana destinations.

### Consent Scopes Required
- `credit_reporting` - submission to XDS/D&B/MyCredit
- `marketing` - optional
- `third_party_sharing` - required for bureau submission
- `location_data` - for GPS address verification
- `biometric_processing` - for liveness check
- `data_analytics` - for risk scoring

### DSAR SLA
30 calendar days from submission date.
Monitor in Grafana: `dsar_sla_days_remaining` metric.

## Credit Reporting L.I. 2394

Daily bureau submissions at 22:00 WAT to:
- XDS Data Ghana
- D&B Ghana  
- MyCredit Score Ghana

Format: BoG-prescribed CSV with loan status codes.
NPA classification: CURRENT / WATCH / SUBSTANDARD / DOUBTFUL / LOSS

## Cybersecurity Act 1038

### Audit Log Hash Chain
```
hash[n] = SHA256(hash[n-1] + action[n] + timestamp[n] + userId[n])
```
- Genesis hash: 64 zeros
- Stored in `audit_logs` table (immutable - no UPDATE/DELETE)
- BoG read-only API: `GET /api/v1/admin/audit-logs`
- Tamper detection: `POST /api/v1/admin/audit-logs/verify-integrity`

### MFA Requirements
- ALL POST/PUT/PATCH/DELETE require verified TOTP
- MFA session expires after 30 minutes
- Break-glass requires dual approval + full audit entry

# Ghana Savings & Loans Platform

> Production-ready savings and loan management system for Ghana, serving SMEs and microcredit clients. Built for full compliance with Bank of Ghana (BoG) regulations.

[![CI](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/ci.yml/badge.svg)](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/ci.yml)
[![Compliance Tests](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/ci.yml/badge.svg?label=compliance)](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/ci.yml)
[![Security Scan](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/security-scan.yml/badge.svg)](https://github.com/KofiBusia/SAVINGS-AND-LOANS/actions/workflows/security-scan.yml)

## Regulatory Compliance

| Regulation | Status | Implementation |
|---|---|---|
| Digital Credit Directive 2025 | COMPLIANT | Non-compounding interest enforced at code level; throws error if attempted |
| AML Act 1044 | COMPLIANT | Ghana Card-only KYC, PEP screening, STR/CTR XML to FIC |
| Data Protection Act 843 | COMPLIANT | Consent management, DSAR workflow, Ghana data residency |
| Credit Reporting L.I. 2394 | COMPLIANT | Daily bureau submission to XDS/D&B/MyCredit |
| Cybersecurity Act 1038 | COMPLIANT | SHA-256 hash-chained audit logs, MFA all writes |
| Ghana Card Policy | COMPLIANT | NIA format GHA-XXXXXXXX-X; sole financial identifier |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GHANA SAVINGS & LOANS                     │
├──────────────┬──────────────────┬────────────────────────────┤
│  Mobile App  │  Front Office    │  Back Office (API)         │
│  React Native│  Next.js PWA     │  NestJS + PostgreSQL        │
│  <15MB APK   │  Offline-capable │  Compliance Engine         │
│  USSD/SMS    │  Field Mode      │  BoG/FIC/DPC Reporting     │
│  fallback    │  GPS/Biometric   │  GhIPSS MMI Integration    │
└──────┬───────┴────────┬─────────┴──────────────┬────────────┘
       │                │                         │
       └────────────────┴─────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │      Shared Package        │
          │  TypeScript interfaces     │
          │  Zod schemas               │
          │  Ghana validators          │
          │  Crypto utils              │
          └─────────────┬──────────────┘
                        │
    ┌───────────────────┼────────────────────┐
    │                   │                    │
    ▼                   ▼                    ▼
┌───────────┐    ┌──────────────┐    ┌───────────────┐
│  GhIPSS   │    │ Credit       │    │  NIA Ghana    │
│  MMI      │    │ Bureaus      │    │  Card API     │
│  MoMo/    │    │ XDS/D&B/     │    │  + OCR        │
│  Telecel/ │    │ MyCredit     │    │  + Liveness   │
│  AirtelT  │    └──────────────┘    └───────────────┘
└───────────┘
```

## KYC/AML State Machine

```
ghanaCardScan() → livenessCheck() → addressVerification() →
incomeDeclaration() → pepScreening() → riskClassification() →
[eddTriggerIfHighRisk()] → beneficialOwnershipCapture() →
consentCapture() → preAgreementDisplay() → eSignature() →
accountActivation()
```
Each step: validates preconditions → executes action → creates immutable SHA-256 hash-chained audit log → returns next state.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Docker, Git
git clone https://github.com/KofiBusia/SAVINGS-AND-LOANS.git
cd SAVINGS-AND-LOANS
cp .env.example .env
# Fill in .env values (use mocks for local dev: *_USE_MOCK=true)

make setup    # Install deps, migrate DB, seed test data
make dev      # Start development stack

# Access:
# Front-office:  http://localhost:3000
# API + Swagger: http://localhost:3001/api/docs
# Grafana:       http://localhost:3003
```

## Project Structure

```
SAVINGS-AND-LOANS/
├── mobile-app/          # React Native app (Android + iOS)
├── front-office/        # Next.js PWA for field officers
├── back-office/         # NestJS API + compliance engine
├── shared/              # Shared TypeScript types and utils
├── infrastructure/      # Terraform, K8s, Docker, CI/CD
└── tests/               # Unit, integration, e2e, compliance, load
```

## Supported Languages

English (en) | Twi/Akan (tw) | Ga (ga) | Ewe (ee) | Hausa (ha)

## Key Ghana Integrations

- **GhIPSS MMI**: MTN MoMo, Telecel Cash, AirtelTigo Money
- **Credit Bureaus**: XDS Data Ghana, D&B Ghana, MyCredit Score
- **NIA**: Ghana Card verification (OCR + liveness + database)
- **Payment Gateways**: Paystack, Flutterwave, expressPay, Hubtel
- **SMS/USSD**: mNotify, Hubtel with voice fallback

## Running Tests

```bash
make test              # All tests (90%+ coverage required)
make test-compliance   # Regulatory compliance tests (MUST pass)
make test-integration  # GhIPSS/bureau mock integration tests
make test-load         # k6 load test (10x Ghana peak traffic)
```

## Deployment

See [infrastructure/docs/DEPLOYMENT.md](infrastructure/docs/DEPLOYMENT.md) for full deployment guide including BoG pre-approval checklist.

## License

Apache 2.0 - See [LICENSE](LICENSE)

---
*Regulated by the Bank of Ghana | BoG License: [YOUR-LICENSE-NUMBER] | DPC Registration: [YOUR-DPC-NUMBER]*

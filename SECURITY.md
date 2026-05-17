# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | ✅ Active |

## Reporting a Vulnerability

**DO NOT create public GitHub issues for security vulnerabilities.**

Report security vulnerabilities to: security@savingsloans.com.gh

PGP key for encrypted reports: [Fetch from keys.savingsloans.com.gh]

### Response Timeline
- Acknowledgment: within 24 hours
- Initial assessment: within 72 hours
- Fix timeline: based on severity (Critical: 48h, High: 7 days, Medium: 30 days)

## Security Controls (Cybersecurity Act 1038)

- **Authentication**: JWT + TOTP MFA required for all write operations
- **Audit Logging**: SHA-256 hash-chained immutable audit logs
- **Data Encryption**: AES-256-GCM for PII at rest
- **Transport**: TLS 1.3 minimum for all connections
- **Data Residency**: All PII stored in Ghana-hosted infrastructure only
- **Access Control**: Role-based with principle of least privilege
- **Break-Glass**: Dual approval required for emergency access

## Compliance Contacts

- **Compliance Officer**: compliance@savingsloans.com.gh
- **DPC (Data Protection)**: dpc@savingsloans.com.gh  
- **BoG Regulatory**: bog-reporting@savingsloans.com.gh

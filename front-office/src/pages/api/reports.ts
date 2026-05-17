import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportType =
  | 'bog_monthly_returns'
  | 'bog_credit_report'
  | 'bog_liquidity_report'
  | 'fic_str_report'
  | 'fic_ctr_report'
  | 'dpc_data_processing'
  | 'par_aging'
  | 'loan_portfolio'
  | 'collections_performance';

export type ReportFormat = 'xlsx' | 'csv' | 'pdf' | 'json';

interface ReportRequest {
  reportType: ReportType;
  format: ReportFormat;
  periodStart: string;
  periodEnd: string;
  branchId?: string;
  agentId?: string;
  includePersonalData?: boolean;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const ReportRequestSchema = z.object({
  reportType: z.enum([
    'bog_monthly_returns',
    'bog_credit_report',
    'bog_liquidity_report',
    'fic_str_report',
    'fic_ctr_report',
    'dpc_data_processing',
    'par_aging',
    'loan_portfolio',
    'collections_performance',
  ]),
  format: z.enum(['xlsx', 'csv', 'pdf', 'json']),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  branchId: z.string().optional(),
  agentId: z.string().optional(),
  includePersonalData: z.boolean().default(false),
});

// ─── Data Fetchers (stub — replace with actual DB calls) ─────────────────────

async function fetchBogMonthlyData(start: Date, end: Date, branchId?: string) {
  void start; void end; void branchId;
  return {
    institutionName: process.env.INSTITUTION_NAME || 'Ghana SL Ltd',
    licenseNumber: process.env.BOG_LICENSE_NUMBER || 'BOG/NBFIs/2024/001',
    reportingPeriod: format(start, 'yyyy-MM'),
    totalLoansOutstanding: 4_500_000,
    totalDeposits: 2_100_000,
    nplRatio: 3.2,
    liquidityRatio: 28.5,
    capitalAdequacyRatio: 18.2,
    numberOfBorrowers: 1_420,
    numberOfDepositors: 3_800,
    par30: 4.1,
    par60: 2.8,
    par90: 1.5,
    writeOffs: 45_000,
    loanDisbursements: 820_000,
    loanRepayments: 690_000,
    interestIncome: 185_000,
    operatingExpenses: 125_000,
  };
}

async function fetchParAgingData(start: Date, end: Date) {
  void start; void end;
  return [
    { bucket: '1-30 days', count: 42, outstanding: 185_000, percentage: 4.1 },
    { bucket: '31-60 days', count: 18, outstanding: 95_000, percentage: 2.1 },
    { bucket: '61-90 days', count: 8, outstanding: 42_000, percentage: 0.93 },
    { bucket: '91-180 days', count: 5, outstanding: 28_000, percentage: 0.62 },
    { bucket: '181-365 days', count: 3, outstanding: 15_000, percentage: 0.33 },
    { bucket: '>365 days', count: 2, outstanding: 12_000, percentage: 0.27 },
  ];
}

async function fetchFicStrData(start: Date, end: Date) {
  void start; void end;
  return [
    {
      reportId: 'STR-2024-001',
      suspectName: 'REDACTED',
      transactionDate: '2024-05-15',
      amount: 85_000,
      currency: 'GHS',
      suspiciousActivity: 'Structuring',
      filedAt: '2024-05-16T09:00:00Z',
      status: 'filed',
    },
  ];
}

async function fetchLoanPortfolioData(start: Date, end: Date, branchId?: string) {
  void start; void end; void branchId;
  return [
    {
      loanId: 'L-2024-001',
      disbursementDate: '2024-01-15',
      amount: 5_000,
      outstandingBalance: 3_200,
      interestRate: 24,
      term: 12,
      status: 'active',
      par: 0,
    },
  ];
}

// ─── Report Builders ──────────────────────────────────────────────────────────

function buildBogMonthlyExcel(data: Awaited<ReturnType<typeof fetchBogMonthlyData>>): Buffer {
  const wb = XLSX.utils.book_new();

  // Cover sheet
  const coverData = [
    ['BANK OF GHANA — MONTHLY RETURNS'],
    ['Institution:', data.institutionName],
    ['License Number:', data.licenseNumber],
    ['Reporting Period:', data.reportingPeriod],
    ['Date Prepared:', format(new Date(), 'dd/MM/yyyy')],
    [],
    ['SECTION A: BALANCE SHEET SUMMARY'],
    ['Total Loans Outstanding (GHS):', data.totalLoansOutstanding],
    ['Total Deposits (GHS):', data.totalDeposits],
    [],
    ['SECTION B: KEY RATIOS'],
    ['NPL Ratio (%):', data.nplRatio],
    ['Liquidity Ratio (%):', data.liquidityRatio],
    ['Capital Adequacy Ratio (%):', data.capitalAdequacyRatio],
    [],
    ['SECTION C: PORTFOLIO AT RISK'],
    ['PAR > 30 days (%):', data.par30],
    ['PAR > 60 days (%):', data.par60],
    ['PAR > 90 days (%):', data.par90],
    ['Write-offs (GHS):', data.writeOffs],
    [],
    ['SECTION D: OPERATIONS'],
    ['Number of Borrowers:', data.numberOfBorrowers],
    ['Number of Depositors:', data.numberOfDepositors],
    ['Loan Disbursements (GHS):', data.loanDisbursements],
    ['Loan Repayments (GHS):', data.loanRepayments],
    ['Interest Income (GHS):', data.interestIncome],
    ['Operating Expenses (GHS):', data.operatingExpenses],
  ];

  const ws = XLSX.utils.aoa_to_sheet(coverData);
  ws['!cols'] = [{ wch: 35 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'BoG Monthly Returns');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildParAgingExcel(data: Awaited<ReturnType<typeof fetchParAgingData>>): Buffer {
  const wb = XLSX.utils.book_new();

  const headers = [['PAR Bucket', 'Loan Count', 'Outstanding (GHS)', 'Portfolio %']];
  const rows = data.map((r) => [r.bucket, r.count, r.outstanding, r.percentage]);
  const totals = [
    'TOTAL',
    data.reduce((s, r) => s + r.count, 0),
    data.reduce((s, r) => s + r.outstanding, 0),
    data.reduce((s, r) => s + r.percentage, 0).toFixed(2),
  ];

  const ws = XLSX.utils.aoa_to_sheet([...headers, ...rows, totals]);
  ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 22 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'PAR Aging');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function buildPdfReport(
  title: string,
  sections: Array<{ heading: string; rows: (string | number)[][] }>
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')} WAT`, 14, 28);
  doc.text(`Institution: ${process.env.INSTITUTION_NAME || 'Ghana SL Ltd'}`, 14, 34);

  let yOffset = 44;

  for (const section of sections) {
    doc.setFontSize(12);
    doc.text(section.heading, 14, yOffset);
    yOffset += 6;

    autoTable(doc, {
      startY: yOffset,
      head: [section.rows[0]?.map((h) => String(h)) ?? []],
      body: section.rows.slice(1).map((row) => row.map((cell) => String(cell))),
      theme: 'striped',
      headStyles: { fillColor: [0, 84, 166], textColor: 255 },
      styles: { fontSize: 9 },
    });

    yOffset = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  }

  return Buffer.from(doc.output('arraybuffer'));
}

// ─── RBAC: roles that can access each report ──────────────────────────────────

const REPORT_PERMISSIONS: Record<ReportType, string[]> = {
  bog_monthly_returns: ['super_admin', 'compliance_officer', 'cfo'],
  bog_credit_report: ['super_admin', 'compliance_officer', 'cfo'],
  bog_liquidity_report: ['super_admin', 'compliance_officer', 'cfo'],
  fic_str_report: ['super_admin', 'compliance_officer', 'aml_officer'],
  fic_ctr_report: ['super_admin', 'compliance_officer', 'aml_officer'],
  dpc_data_processing: ['super_admin', 'dpo', 'compliance_officer'],
  par_aging: ['super_admin', 'credit_manager', 'branch_manager', 'cfo'],
  loan_portfolio: ['super_admin', 'credit_manager', 'branch_manager', 'cfo'],
  collections_performance: ['super_admin', 'collections_manager', 'branch_manager'],
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, {
    secret: process.env.NEXTAUTH_SECRET,
    providers: [],
  } as Parameters<typeof getServerSession>[2]);

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parseResult = ReportRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.message });
  }

  const { reportType, format: outputFormat, periodStart, periodEnd, branchId } =
    parseResult.data;

  // RBAC check
  const userRole = (session.user as { role?: string })?.role ?? '';
  const allowedRoles = REPORT_PERMISSIONS[reportType] ?? [];
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ error: 'Insufficient permissions for this report' });
  }

  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  // Data residency: BoG/FIC reports must not contain raw PII when exported
  if (
    parseResult.data.includePersonalData &&
    ['fic_str_report', 'fic_ctr_report'].includes(reportType)
  ) {
    return res.status(403).json({
      error: 'DATA_RESIDENCY_VIOLATION: Personal data cannot be exported in regulatory reports',
    });
  }

  try {
    let fileBuffer: Buffer;
    let filename: string;
    let contentType: string;

    switch (reportType) {
      case 'bog_monthly_returns': {
        const data = await fetchBogMonthlyData(start, end, branchId);
        if (outputFormat === 'xlsx') {
          fileBuffer = buildBogMonthlyExcel(data);
          filename = `BoG_Monthly_Returns_${format(start, 'yyyy_MM')}.xlsx`;
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (outputFormat === 'pdf') {
          fileBuffer = buildPdfReport('Bank of Ghana — Monthly Returns', [
            {
              heading: 'Balance Sheet Summary',
              rows: [
                ['Metric', 'Value (GHS)'],
                ['Total Loans Outstanding', data.totalLoansOutstanding],
                ['Total Deposits', data.totalDeposits],
              ],
            },
          ]);
          filename = `BoG_Monthly_Returns_${format(start, 'yyyy_MM')}.pdf`;
          contentType = 'application/pdf';
        } else {
          fileBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
          filename = `BoG_Monthly_Returns_${format(start, 'yyyy_MM')}.json`;
          contentType = 'application/json';
        }
        break;
      }

      case 'par_aging': {
        const data = await fetchParAgingData(start, end);
        if (outputFormat === 'xlsx') {
          fileBuffer = buildParAgingExcel(data);
          filename = `PAR_Aging_${format(start, 'yyyy_MM')}.xlsx`;
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (outputFormat === 'csv') {
          const csvRows = [
            'PAR Bucket,Loan Count,Outstanding (GHS),Portfolio %',
            ...data.map((r) => `${r.bucket},${r.count},${r.outstanding},${r.percentage}`),
          ];
          fileBuffer = Buffer.from(csvRows.join('\n'), 'utf-8');
          filename = `PAR_Aging_${format(start, 'yyyy_MM')}.csv`;
          contentType = 'text/csv';
        } else {
          fileBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
          filename = `PAR_Aging_${format(start, 'yyyy_MM')}.json`;
          contentType = 'application/json';
        }
        break;
      }

      case 'fic_str_report': {
        const data = await fetchFicStrData(start, end);
        fileBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
        filename = `FIC_STR_${format(start, 'yyyy_MM')}.json`;
        contentType = 'application/json';
        break;
      }

      default: {
        const data = await fetchLoanPortfolioData(start, end, branchId);
        fileBuffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
        filename = `${reportType}_${format(start, 'yyyy_MM')}.json`;
        contentType = 'application/json';
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('X-Report-Generated-At', new Date().toISOString());
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    return res.status(200).send(fileBuffer);
  } catch (err) {
    console.error('[reports] Generation failed:', err);
    return res.status(500).json({ error: 'Report generation failed' });
  }
}

export { subMonths, startOfMonth, endOfMonth }; // re-export for client use

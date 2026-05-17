/**
 * Portfolio Dashboard Service
 *
 * Real-time portfolio analytics for the Ghana savings & loan platform.
 *
 * Metrics produced:
 *   - Portfolio At Risk (PAR) ratios (PAR1, PAR7, PAR30, PAR90)
 *   - NPA classification per BoG guidelines
 *   - Disbursement trends (daily/weekly/monthly)
 *   - Collection efficiency ratio
 *   - Product performance by segment
 *   - Regional breakdown by Ghana's 16 regions
 *
 * Compliance:
 *   - BoG Prudential Guidelines 2018 — asset quality classification
 *   - BoG Monthly Returns format (MR-04)
 *   - IFRS 9 — Expected Credit Loss (ECL) provisioning
 *
 * PAR trigger: If PAR30 > 5%, automatic alert to BoG Risk Desk per
 * BoG Directive on Financial Soundness BFS/2019/01.
 */

import { Injectable, Logger } from '@nestjs/common';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum LoanClassification {
  CURRENT = 'CURRENT', // 0 days past due
  OLEM = 'OLEM', // Other Loans Especially Mentioned (1–29 days)
  SUBSTANDARD = 'SUBSTANDARD', // 30–89 days past due
  DOUBTFUL = 'DOUBTFUL', // 90–179 days past due
  LOSS = 'LOSS', // 180+ days past due
}

export enum GhanaRegion {
  GREATER_ACCRA = 'GREATER_ACCRA',
  ASHANTI = 'ASHANTI',
  WESTERN = 'WESTERN',
  CENTRAL = 'CENTRAL',
  EASTERN = 'EASTERN',
  VOLTA = 'VOLTA',
  NORTHERN = 'NORTHERN',
  UPPER_EAST = 'UPPER_EAST',
  UPPER_WEST = 'UPPER_WEST',
  BRONG_AHAFO = 'BRONG_AHAFO',
  AHAFO = 'AHAFO',
  BONO_EAST = 'BONO_EAST',
  OTI = 'OTI',
  SAVANNAH = 'SAVANNAH',
  NORTH_EAST = 'NORTH_EAST',
  WESTERN_NORTH = 'WESTERN_NORTH',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ParRatios {
  par1: number; // % of portfolio 1+ day overdue
  par7: number;
  par30: number;
  par90: number;
  par180: number;
  calculatedAt: string;
  alertTriggered: boolean; // true if PAR30 > 5%
}

export interface NpaClassification {
  totalPortfolioGhs: number;
  current: { amount: number; count: number; percentage: number };
  olem: { amount: number; count: number; percentage: number };
  substandard: { amount: number; count: number; percentage: number };
  doubtful: { amount: number; count: number; percentage: number };
  loss: { amount: number; count: number; percentage: number };
  grossNpaRatio: number; // (substandard + doubtful + loss) / total
  netNpaRatio: number; // after provisions
  requiredProvisionGhs: number; // IFRS 9 ECL
  actualProvisionGhs: number;
  provisionCoverageRatio: number;
  calculatedAt: string;
}

export interface DisbursementTrend {
  period: string; // ISO date
  count: number;
  totalAmountGhs: number;
  averageAmountGhs: number;
  byProduct: Record<string, number>;
  byRegion: Partial<Record<GhanaRegion, number>>;
  femaleToMaleRatio: number;
  ruralUrbanRatio: number;
}

export interface CollectionEfficiency {
  period: string;
  scheduledCollectionsGhs: number;
  actualCollectionsGhs: number;
  efficiencyRatio: number; // actual / scheduled
  byChannel: {
    mobileMoney: number;
    branchCash: number;
    bankTransfer: number;
    ussd: number;
  };
  averageDaysToCollect: number;
  missedPayments: number;
}

export interface ProductPerformance {
  productId: number;
  productName: string;
  productType: string;
  activeLoans: number;
  totalPortfolioGhs: number;
  parRatio: number;
  avgInterestRate: number;
  totalDisbursedYtdGhs: number;
  netInterestMargin: number;
  defaultRate: number;
  returnOnAssets: number;
}

export interface RegionalBreakdown {
  region: GhanaRegion;
  activeLoans: number;
  totalPortfolioGhs: number;
  parRatio: number;
  disbursedThisMonthGhs: number;
  avgLoanAmountGhs: number;
  femalePercentage: number;
  ruralPercentage: number;
}

export interface PortfolioDashboard {
  asOf: string;
  institutionCode: string;

  // Summary KPIs
  totalActiveLoans: number;
  totalPortfolioGhs: number;
  totalDisbursedMtdGhs: number; // Month to date
  totalCollectedMtdGhs: number;
  totalOverdueGhs: number;

  // Risk metrics
  parRatios: ParRatios;
  npaClassification: NpaClassification;

  // Performance
  collectionEfficiency: CollectionEfficiency;
  productPerformance: ProductPerformance[];
  regionalBreakdown: RegionalBreakdown[];

  // Trends (last 12 months)
  disbursementTrends: DisbursementTrend[];

  // Compliance indicators
  bogAlerts: BogAlert[];
  ifrs9EclProvisionGhs: number;
  capitalAdequacyRatio: number; // must be ≥ 10% per BoG
}

export interface BogAlert {
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  threshold?: string;
  actualValue?: string;
  reportingDeadline?: string;
  legalRef: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PortfolioDashboardService {
  private readonly logger = new Logger(PortfolioDashboardService.name);

  /**
   * Generate complete portfolio dashboard.
   * In production, this queries the loan/savings repositories.
   */
  async getDashboard(): Promise<PortfolioDashboard> {
    this.logger.log('Generating portfolio dashboard');

    const asOf = new Date().toISOString();

    // In production: inject and query LoanRepository, SavingsRepository
    const portfolioData = this.getMockPortfolioData();

    const parRatios = this.calculateParRatios(portfolioData);
    const npaClassification = this.calculateNpaClassification(portfolioData);
    const collectionEfficiency = this.calculateCollectionEfficiency(portfolioData);
    const productPerformance = this.calculateProductPerformance(portfolioData);
    const regionalBreakdown = this.calculateRegionalBreakdown(portfolioData);
    const disbursementTrends = this.generateDisbursementTrends();
    const bogAlerts = this.generateBogAlerts(parRatios, npaClassification);

    return {
      asOf,
      institutionCode: 'SL001',
      totalActiveLoans: portfolioData.totalActiveLoans,
      totalPortfolioGhs: portfolioData.totalPortfolioGhs,
      totalDisbursedMtdGhs: portfolioData.totalDisbursedMtdGhs,
      totalCollectedMtdGhs: portfolioData.totalCollectedMtdGhs,
      totalOverdueGhs: portfolioData.totalOverdueGhs,
      parRatios,
      npaClassification,
      collectionEfficiency,
      productPerformance,
      regionalBreakdown,
      disbursementTrends,
      bogAlerts,
      ifrs9EclProvisionGhs: npaClassification.requiredProvisionGhs,
      capitalAdequacyRatio: 14.2, // replace with actual calculation
    };
  }

  /**
   * Calculate PAR ratios.
   * PAR30 > 5% triggers mandatory BoG notification.
   */
  calculateParRatios(data: MockPortfolioData): ParRatios {
    const par1 = (data.overdueLoans.filter((l) => l.dpd >= 1).reduce((s, l) => s + l.outstanding, 0) / data.totalPortfolioGhs) * 100;
    const par7 = (data.overdueLoans.filter((l) => l.dpd >= 7).reduce((s, l) => s + l.outstanding, 0) / data.totalPortfolioGhs) * 100;
    const par30 = (data.overdueLoans.filter((l) => l.dpd >= 30).reduce((s, l) => s + l.outstanding, 0) / data.totalPortfolioGhs) * 100;
    const par90 = (data.overdueLoans.filter((l) => l.dpd >= 90).reduce((s, l) => s + l.outstanding, 0) / data.totalPortfolioGhs) * 100;
    const par180 = (data.overdueLoans.filter((l) => l.dpd >= 180).reduce((s, l) => s + l.outstanding, 0) / data.totalPortfolioGhs) * 100;

    const alertTriggered = par30 > 5;

    if (alertTriggered) {
      this.logger.warn(
        `PAR30 ALERT: ${par30.toFixed(2)}% exceeds 5% threshold — BoG notification required [BFS/2019/01]`,
      );
    }

    return {
      par1: Math.round(par1 * 100) / 100,
      par7: Math.round(par7 * 100) / 100,
      par30: Math.round(par30 * 100) / 100,
      par90: Math.round(par90 * 100) / 100,
      par180: Math.round(par180 * 100) / 100,
      calculatedAt: new Date().toISOString(),
      alertTriggered,
    };
  }

  /**
   * Classify loans per BoG Prudential Guidelines 2018.
   */
  calculateNpaClassification(data: MockPortfolioData): NpaClassification {
    const total = data.totalPortfolioGhs;

    const classifications = {
      current: data.overdueLoans.filter((l) => l.dpd === 0),
      olem: data.overdueLoans.filter((l) => l.dpd >= 1 && l.dpd <= 29),
      substandard: data.overdueLoans.filter((l) => l.dpd >= 30 && l.dpd <= 89),
      doubtful: data.overdueLoans.filter((l) => l.dpd >= 90 && l.dpd <= 179),
      loss: data.overdueLoans.filter((l) => l.dpd >= 180),
    };

    // BoG provision rates: OLEM 5%, Substandard 20%, Doubtful 50%, Loss 100%
    const provisionRates = { olem: 0.05, substandard: 0.20, doubtful: 0.50, loss: 1.0 };

    const substandardAmt = classifications.substandard.reduce((s, l) => s + l.outstanding, 0);
    const doubtfulAmt = classifications.doubtful.reduce((s, l) => s + l.outstanding, 0);
    const lossAmt = classifications.loss.reduce((s, l) => s + l.outstanding, 0);
    const olemAmt = classifications.olem.reduce((s, l) => s + l.outstanding, 0);
    const currentAmt = total - olemAmt - substandardAmt - doubtfulAmt - lossAmt;

    const requiredProvision =
      olemAmt * provisionRates.olem +
      substandardAmt * provisionRates.substandard +
      doubtfulAmt * provisionRates.doubtful +
      lossAmt * provisionRates.loss;

    const actualProvision = data.totalProvisionsGhs;
    const grossNpaNumerator = substandardAmt + doubtfulAmt + lossAmt;
    const grossNpaRatio = (grossNpaNumerator / total) * 100;
    const netNpaRatio = ((grossNpaNumerator - actualProvision) / total) * 100;

    return {
      totalPortfolioGhs: total,
      current: { amount: currentAmt, count: classifications.current.length, percentage: (currentAmt / total) * 100 },
      olem: { amount: olemAmt, count: classifications.olem.length, percentage: (olemAmt / total) * 100 },
      substandard: { amount: substandardAmt, count: classifications.substandard.length, percentage: (substandardAmt / total) * 100 },
      doubtful: { amount: doubtfulAmt, count: classifications.doubtful.length, percentage: (doubtfulAmt / total) * 100 },
      loss: { amount: lossAmt, count: classifications.loss.length, percentage: (lossAmt / total) * 100 },
      grossNpaRatio: Math.round(grossNpaRatio * 100) / 100,
      netNpaRatio: Math.round(netNpaRatio * 100) / 100,
      requiredProvisionGhs: Math.round(requiredProvision * 100) / 100,
      actualProvisionGhs: actualProvision,
      provisionCoverageRatio: actualProvision / grossNpaNumerator,
      calculatedAt: new Date().toISOString(),
    };
  }

  private calculateCollectionEfficiency(data: MockPortfolioData): CollectionEfficiency {
    const efficiency = (data.totalCollectedMtdGhs / data.totalScheduledMtdGhs) * 100;
    return {
      period: new Date().toISOString().substring(0, 7),
      scheduledCollectionsGhs: data.totalScheduledMtdGhs,
      actualCollectionsGhs: data.totalCollectedMtdGhs,
      efficiencyRatio: Math.round(efficiency * 100) / 100,
      byChannel: {
        mobileMoney: data.collectionByChannel.mobileMoney,
        branchCash: data.collectionByChannel.branchCash,
        bankTransfer: data.collectionByChannel.bankTransfer,
        ussd: data.collectionByChannel.ussd,
      },
      averageDaysToCollect: 2.3,
      missedPayments: data.overdueLoans.filter((l) => l.dpd === 1).length,
    };
  }

  private calculateProductPerformance(data: MockPortfolioData): ProductPerformance[] {
    return data.products.map((p) => ({
      productId: p.id,
      productName: p.name,
      productType: p.type,
      activeLoans: p.activeLoans,
      totalPortfolioGhs: p.portfolioGhs,
      parRatio: p.parRatio,
      avgInterestRate: p.avgInterestRate,
      totalDisbursedYtdGhs: p.disbursedYtdGhs,
      netInterestMargin: p.nim,
      defaultRate: p.defaultRate,
      returnOnAssets: p.roa,
    }));
  }

  private calculateRegionalBreakdown(data: MockPortfolioData): RegionalBreakdown[] {
    return data.regions.map((r) => ({
      region: r.region,
      activeLoans: r.activeLoans,
      totalPortfolioGhs: r.portfolioGhs,
      parRatio: r.parRatio,
      disbursedThisMonthGhs: r.disbursedMtdGhs,
      avgLoanAmountGhs: r.portfolioGhs / Math.max(r.activeLoans, 1),
      femalePercentage: r.femalePercentage,
      ruralPercentage: r.ruralPercentage,
    }));
  }

  private generateDisbursementTrends(): DisbursementTrend[] {
    return Array.from({ length: 12 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (11 - i));
      const monthStr = date.toISOString().substring(0, 7);
      const baseAmount = 500000 + Math.sin(i * 0.5) * 100000;

      return {
        period: monthStr,
        count: 80 + Math.round(Math.random() * 40),
        totalAmountGhs: Math.round(baseAmount + Math.random() * 200000),
        averageAmountGhs: 6200 + Math.round(Math.random() * 2000),
        byProduct: {
          PERSONAL_LOAN: Math.round(baseAmount * 0.6),
          SME_LOAN: Math.round(baseAmount * 0.3),
          AGRICULTURE_LOAN: Math.round(baseAmount * 0.1),
        },
        byRegion: {
          [GhanaRegion.GREATER_ACCRA]: Math.round(baseAmount * 0.4),
          [GhanaRegion.ASHANTI]: Math.round(baseAmount * 0.25),
          [GhanaRegion.WESTERN]: Math.round(baseAmount * 0.15),
        },
        femaleToMaleRatio: 0.42 + Math.random() * 0.1,
        ruralUrbanRatio: 0.35 + Math.random() * 0.1,
      };
    });
  }

  private generateBogAlerts(par: ParRatios, npa: NpaClassification): BogAlert[] {
    const alerts: BogAlert[] = [];

    if (par.par30 > 5) {
      alerts.push({
        type: 'PAR30_THRESHOLD',
        severity: 'CRITICAL',
        message: `PAR30 of ${par.par30}% exceeds the 5% regulatory threshold. Mandatory BoG notification within 5 business days.`,
        threshold: '5%',
        actualValue: `${par.par30}%`,
        reportingDeadline: new Date(Date.now() + 5 * 86400000).toISOString().substring(0, 10),
        legalRef: 'BoG Directive on Financial Soundness BFS/2019/01 §3.4',
      });
    }

    if (npa.grossNpaRatio > 10) {
      alerts.push({
        type: 'NPA_RATIO',
        severity: 'WARNING',
        message: `Gross NPA ratio of ${npa.grossNpaRatio}% approaching critical threshold of 15%`,
        threshold: '10%',
        actualValue: `${npa.grossNpaRatio}%`,
        legalRef: 'BoG Prudential Guidelines 2018 §4.2',
      });
    }

    if (npa.provisionCoverageRatio < 1) {
      alerts.push({
        type: 'UNDER_PROVISIONED',
        severity: 'WARNING',
        message: `Actual provisions (GHS ${npa.actualProvisionGhs.toLocaleString()}) below required IFRS 9 ECL (GHS ${npa.requiredProvisionGhs.toLocaleString()})`,
        legalRef: 'IFRS 9 / BoG IFRS Implementation Guide 2019',
      });
    }

    return alerts;
  }

  // ─── Mock Data ────────────────────────────────────────────────────────────────

  private getMockPortfolioData(): MockPortfolioData {
    const overdueLoans = [
      ...Array.from({ length: 580 }, (_, i) => ({ dpd: 0, outstanding: 3000 + i * 100 })),
      ...Array.from({ length: 40 }, (_, i) => ({ dpd: 1 + (i % 29), outstanding: 2500 + i * 200 })),
      ...Array.from({ length: 15 }, (_, i) => ({ dpd: 30 + (i % 60), outstanding: 4000 + i * 300 })),
      ...Array.from({ length: 5 }, (_, i) => ({ dpd: 90 + (i % 90), outstanding: 5000 + i * 400 })),
      ...Array.from({ length: 2 }, (_, i) => ({ dpd: 180 + i * 30, outstanding: 8000 + i * 500 })),
    ];

    const totalPortfolioGhs = overdueLoans.reduce((s, l) => s + l.outstanding, 0);

    return {
      totalActiveLoans: 642,
      totalPortfolioGhs,
      totalDisbursedMtdGhs: 850000,
      totalCollectedMtdGhs: 780000,
      totalScheduledMtdGhs: 830000,
      totalOverdueGhs: overdueLoans.filter((l) => l.dpd > 0).reduce((s, l) => s + l.outstanding, 0),
      totalProvisionsGhs: totalPortfolioGhs * 0.04,
      overdueLoans,
      collectionByChannel: {
        mobileMoney: 520000,
        branchCash: 150000,
        bankTransfer: 80000,
        ussd: 30000,
      },
      products: [
        { id: 1, name: 'Personal Quick Loan', type: 'PERSONAL_LOAN', activeLoans: 380, portfolioGhs: totalPortfolioGhs * 0.55, parRatio: 3.2, avgInterestRate: 28, disbursedYtdGhs: 5200000, nim: 18.5, defaultRate: 1.8, roa: 3.2 },
        { id: 2, name: 'SME Growth Loan', type: 'SME_LOAN', activeLoans: 180, portfolioGhs: totalPortfolioGhs * 0.35, parRatio: 4.8, avgInterestRate: 25, disbursedYtdGhs: 3800000, nim: 16.2, defaultRate: 2.5, roa: 2.8 },
        { id: 3, name: 'Agri Support Loan', type: 'AGRICULTURE_LOAN', activeLoans: 82, portfolioGhs: totalPortfolioGhs * 0.10, parRatio: 6.1, avgInterestRate: 22, disbursedYtdGhs: 950000, nim: 14.8, defaultRate: 3.2, roa: 2.1 },
      ],
      regions: [
        { region: GhanaRegion.GREATER_ACCRA, activeLoans: 280, portfolioGhs: totalPortfolioGhs * 0.44, parRatio: 2.8, disbursedMtdGhs: 374000, femalePercentage: 45, ruralPercentage: 8 },
        { region: GhanaRegion.ASHANTI, activeLoans: 175, portfolioGhs: totalPortfolioGhs * 0.27, parRatio: 3.5, disbursedMtdGhs: 229500, femalePercentage: 48, ruralPercentage: 22 },
        { region: GhanaRegion.WESTERN, activeLoans: 98, portfolioGhs: totalPortfolioGhs * 0.15, parRatio: 4.2, disbursedMtdGhs: 127500, femalePercentage: 42, ruralPercentage: 35 },
        { region: GhanaRegion.NORTHERN, activeLoans: 56, portfolioGhs: totalPortfolioGhs * 0.08, parRatio: 6.8, disbursedMtdGhs: 68000, femalePercentage: 38, ruralPercentage: 68 },
        { region: GhanaRegion.VOLTA, activeLoans: 33, portfolioGhs: totalPortfolioGhs * 0.06, parRatio: 5.1, disbursedMtdGhs: 51000, femalePercentage: 52, ruralPercentage: 55 },
      ],
    };
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface MockPortfolioData {
  totalActiveLoans: number;
  totalPortfolioGhs: number;
  totalDisbursedMtdGhs: number;
  totalCollectedMtdGhs: number;
  totalScheduledMtdGhs: number;
  totalOverdueGhs: number;
  totalProvisionsGhs: number;
  overdueLoans: { dpd: number; outstanding: number }[];
  collectionByChannel: { mobileMoney: number; branchCash: number; bankTransfer: number; ussd: number };
  products: { id: number; name: string; type: string; activeLoans: number; portfolioGhs: number; parRatio: number; avgInterestRate: number; disbursedYtdGhs: number; nim: number; defaultRate: number; roa: number }[];
  regions: { region: GhanaRegion; activeLoans: number; portfolioGhs: number; parRatio: number; disbursedMtdGhs: number; femalePercentage: number; ruralPercentage: number }[];
}

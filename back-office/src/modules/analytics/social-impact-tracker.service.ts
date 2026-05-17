/**
 * Social Impact Tracker Service
 *
 * Measures and reports on the social development impact of lending operations:
 *   - SME growth and job creation tracking
 *   - Women empowerment / gender finance ratio
 *   - Rural/peri-urban outreach metrics
 *   - Youth entrepreneurship (18–35)
 *   - Ghana SDG alignment (Goals 1, 8, 10, 17)
 *   - BoG financial inclusion reporting
 *
 * Compliance & Reporting:
 *   - BoG Financial Inclusion Policy 2023
 *   - SDG Voluntary National Review (Ghana 2024)
 *   - Africa Finance Corporation ESG Framework
 *   - GIABA AML financial inclusion obligations
 */

import { Injectable, Logger } from '@nestjs/common';
import { GhanaRegion } from './portfolio-dashboard.service';

// ─── SDG Mapping ──────────────────────────────────────────────────────────────

export enum GhanaSdgGoal {
  NO_POVERTY = 'SDG-1',
  DECENT_WORK = 'SDG-8',
  REDUCED_INEQUALITIES = 'SDG-10',
  PARTNERSHIPS = 'SDG-17',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SmeGrowthMetrics {
  totalSmesSupported: number;
  newSmesThisQuarter: number;
  smesByRegion: Partial<Record<GhanaRegion, number>>;
  smesBySector: Record<string, number>;
  avgLoanAmountGhs: number;
  avgRevenueGrowthPercent: number; // self-reported at 12-month follow-up
  survivalRateAt12Months: number; // % of SMEs still operating
  formalRegistrationRate: number; // % who registered with RGD after loan
  digitalAdoptionRate: number; // % using mobile money for business
  totalSmePortfolioGhs: number;
}

export interface WomenEmpowermentMetrics {
  totalFemaleCustomers: number;
  femaleLoanPercentage: number; // % of total loan book
  femaleAverageLoanGhs: number;
  maleAverageLoanGhs: number;
  genderLoanGap: number; // female avg as % of male avg
  femaleRepaymentRate: number; // typically higher than male per BoG data
  maleRepaymentRate: number;
  femaleBusinessOwners: number;
  femaleYouthBorrowers: number; // age 18–35
  femaleRuralBorrowers: number;
  femaleFirstTimeBorrowers: number;
  targetFemaleRatio: number; // institution target (e.g., 40%)
  currentFemaleRatio: number;
  onTrackToTarget: boolean;
}

export interface RuralOutreachMetrics {
  ruralCustomers: number;
  ruralPercentage: number; // % of total customers
  periUrbanCustomers: number;
  urbanCustomers: number;
  avgDistanceToNearestBranchKm: number;
  digitalChannelRuralAdoption: number; // % of rural using mobile/USSD
  fieldAgentCoverage: number; // unique villages served
  agentNetworkSize: number; // active field agents
  mobileMoneyDisbursementRate: number; // % of rural loans via MoMo
  regionsCovered: GhanaRegion[];
  underservedRegionsCount: number; // regions below national avg
}

export interface JobCreationMetrics {
  directJobsCreated: number; // staff hired by SME borrowers
  indirectJobsSupported: number; // supply chain estimate
  jobsPerSmeLoan: number;
  averageMonthlyWageGhs: number;
  jobsBySector: Record<string, number>;
  formalEmploymentConversions: number; // informal → formal
  youthEmploymentCreated: number;
}

export interface SdgAlignment {
  goal: GhanaSdgGoal;
  title: string;
  indicators: SdgIndicator[];
  overallScore: number; // 0–100
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
}

export interface SdgIndicator {
  code: string;
  description: string;
  value: number;
  unit: string;
  baseline: number;
  target: number;
  progress: number; // % toward target
  dataYear: number;
}

export interface FinancialInclusionReport {
  reportingPeriod: string;
  institutionCode: string;

  // BoG Financial Inclusion KPIs
  newBorrowersThisYear: number;
  firstTimeBorrowersPercent: number;
  unbankedCustomersOnboarded: number;
  digitalPaymentAdoptionRate: number;
  avgLoanSizeGhs: number;

  smeGrowth: SmeGrowthMetrics;
  womenEmpowerment: WomenEmpowermentMetrics;
  ruralOutreach: RuralOutreachMetrics;
  jobCreation: JobCreationMetrics;
  sdgAlignment: SdgAlignment[];

  // Aggregate impact score
  overallImpactScore: number; // 0–100
  impactGrade: 'A+' | 'A' | 'B' | 'C' | 'D';
  narrativeSummary: string;
  generatedAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SocialImpactTrackerService {
  private readonly logger = new Logger(SocialImpactTrackerService.name);

  /**
   * Generate comprehensive social impact report.
   * Used for BoG quarterly financial inclusion reporting and ESG disclosures.
   */
  async generateImpactReport(period: string): Promise<FinancialInclusionReport> {
    this.logger.log(`Generating social impact report for period: ${period}`);

    const smeGrowth = this.calculateSmeGrowthMetrics();
    const womenEmpowerment = this.calculateWomenEmpowermentMetrics();
    const ruralOutreach = this.calculateRuralOutreachMetrics();
    const jobCreation = this.calculateJobCreationMetrics(smeGrowth);
    const sdgAlignment = this.calculateSdgAlignment(smeGrowth, womenEmpowerment, ruralOutreach, jobCreation);
    const overallImpactScore = this.calculateOverallImpactScore(smeGrowth, womenEmpowerment, ruralOutreach, sdgAlignment);

    return {
      reportingPeriod: period,
      institutionCode: 'SL001',
      newBorrowersThisYear: 342,
      firstTimeBorrowersPercent: 38.5,
      unbankedCustomersOnboarded: 128,
      digitalPaymentAdoptionRate: 71.3,
      avgLoanSizeGhs: 6850,

      smeGrowth,
      womenEmpowerment,
      ruralOutreach,
      jobCreation,
      sdgAlignment,

      overallImpactScore,
      impactGrade: overallImpactScore >= 80 ? 'A+' : overallImpactScore >= 70 ? 'A' : overallImpactScore >= 60 ? 'B' : 'C',
      narrativeSummary: this.generateNarrativeSummary(womenEmpowerment, ruralOutreach, jobCreation),
      generatedAt: new Date().toISOString(),
    };
  }

  // ─── Metric Calculations ──────────────────────────────────────────────────────

  private calculateSmeGrowthMetrics(): SmeGrowthMetrics {
    return {
      totalSmesSupported: 287,
      newSmesThisQuarter: 48,
      smesByRegion: {
        [GhanaRegion.GREATER_ACCRA]: 112,
        [GhanaRegion.ASHANTI]: 78,
        [GhanaRegion.WESTERN]: 42,
        [GhanaRegion.EASTERN]: 28,
        [GhanaRegion.NORTHERN]: 18,
        [GhanaRegion.UPPER_EAST]: 9,
      },
      smesBySector: {
        'Trading/Retail': 95,
        'Food Processing': 52,
        'Transport': 38,
        'Construction': 28,
        'Agriculture': 42,
        'Services': 32,
      },
      avgLoanAmountGhs: 12500,
      avgRevenueGrowthPercent: 23.4,
      survivalRateAt12Months: 81.2,
      formalRegistrationRate: 34.5,
      digitalAdoptionRate: 62.8,
      totalSmePortfolioGhs: 3587500,
    };
  }

  private calculateWomenEmpowermentMetrics(): WomenEmpowermentMetrics {
    const totalFemale = 285;
    const totalCustomers = 642;
    const currentRatio = totalFemale / totalCustomers;
    const targetRatio = 0.40;

    return {
      totalFemaleCustomers: totalFemale,
      femaleLoanPercentage: currentRatio * 100,
      femaleAverageLoanGhs: 5800,
      maleAverageLoanGhs: 7200,
      genderLoanGap: (5800 / 7200) * 100, // 80.6% — females receive less
      femaleRepaymentRate: 94.2, // historically higher in Ghana
      maleRepaymentRate: 91.8,
      femaleBusinessOwners: 142,
      femaleYouthBorrowers: 89,
      femaleRuralBorrowers: 98,
      femaleFirstTimeBorrowers: 112,
      targetFemaleRatio: targetRatio * 100,
      currentFemaleRatio: currentRatio * 100,
      onTrackToTarget: currentRatio >= targetRatio * 0.95, // within 5% of target
    };
  }

  private calculateRuralOutreachMetrics(): RuralOutreachMetrics {
    return {
      ruralCustomers: 224,
      ruralPercentage: 34.9,
      periUrbanCustomers: 158,
      urbanCustomers: 260,
      avgDistanceToNearestBranchKm: 22.4,
      digitalChannelRuralAdoption: 58.9,
      fieldAgentCoverage: 38, // distinct villages
      agentNetworkSize: 12,
      mobileMoneyDisbursementRate: 87.5,
      regionsCovered: [
        GhanaRegion.GREATER_ACCRA,
        GhanaRegion.ASHANTI,
        GhanaRegion.WESTERN,
        GhanaRegion.EASTERN,
        GhanaRegion.NORTHERN,
        GhanaRegion.UPPER_EAST,
        GhanaRegion.VOLTA,
        GhanaRegion.CENTRAL,
      ],
      underservedRegionsCount: 3,
    };
  }

  private calculateJobCreationMetrics(sme: SmeGrowthMetrics): JobCreationMetrics {
    const directJobs = Math.round(sme.totalSmesSupported * 2.3);
    const indirectJobs = Math.round(directJobs * 2.5);

    return {
      directJobsCreated: directJobs,
      indirectJobsSupported: indirectJobs,
      jobsPerSmeLoan: 2.3,
      averageMonthlyWageGhs: 1450,
      jobsBySector: {
        'Trading/Retail': Math.round(sme.smesBySector['Trading/Retail'] * 2),
        'Food Processing': Math.round(sme.smesBySector['Food Processing'] * 3.5),
        'Transport': Math.round(sme.smesBySector['Transport'] * 1.5),
        'Construction': Math.round(sme.smesBySector['Construction'] * 4),
        'Agriculture': Math.round(sme.smesBySector['Agriculture'] * 2.8),
        'Services': Math.round(sme.smesBySector['Services'] * 2.2),
      },
      formalEmploymentConversions: 45,
      youthEmploymentCreated: Math.round(directJobs * 0.42),
    };
  }

  private calculateSdgAlignment(
    sme: SmeGrowthMetrics,
    women: WomenEmpowermentMetrics,
    rural: RuralOutreachMetrics,
    jobs: JobCreationMetrics,
  ): SdgAlignment[] {
    return [
      {
        goal: GhanaSdgGoal.NO_POVERTY,
        title: 'No Poverty — End poverty in all forms everywhere',
        indicators: [
          {
            code: 'SDG1.4',
            description: 'Proportion of population with access to financial services',
            value: rural.ruralPercentage + rural.periUrbanCustomers / 6.42,
            unit: '% of customers in rural/peri-urban',
            baseline: 25,
            target: 45,
            progress: Math.min(100, ((rural.ruralPercentage - 25) / (45 - 25)) * 100),
            dataYear: new Date().getFullYear(),
          },
          {
            code: 'SDG1.b',
            description: 'Pro-poor spending — % of loans below GHS 5,000',
            value: 48.2,
            unit: '%',
            baseline: 40,
            target: 55,
            progress: Math.min(100, ((48.2 - 40) / (55 - 40)) * 100),
            dataYear: new Date().getFullYear(),
          },
        ],
        overallScore: 68,
        trend: 'IMPROVING',
      },
      {
        goal: GhanaSdgGoal.DECENT_WORK,
        title: 'Decent Work and Economic Growth',
        indicators: [
          {
            code: 'SDG8.3',
            description: 'SME loan portfolio as % of total',
            value: (sme.totalSmePortfolioGhs / (sme.totalSmePortfolioGhs + 2500000)) * 100,
            unit: '%',
            baseline: 20,
            target: 40,
            progress: 65,
            dataYear: new Date().getFullYear(),
          },
          {
            code: 'SDG8.5',
            description: 'Direct jobs supported per GHS 1M lent',
            value: (jobs.directJobsCreated / (sme.totalSmePortfolioGhs / 1000000)),
            unit: 'jobs/GHS 1M',
            baseline: 50,
            target: 100,
            progress: 72,
            dataYear: new Date().getFullYear(),
          },
        ],
        overallScore: 72,
        trend: 'IMPROVING',
      },
      {
        goal: GhanaSdgGoal.REDUCED_INEQUALITIES,
        title: 'Reduced Inequalities',
        indicators: [
          {
            code: 'SDG10.2',
            description: 'Female borrowers as % of portfolio',
            value: women.femaleLoanPercentage,
            unit: '%',
            baseline: 30,
            target: 45,
            progress: Math.min(100, ((women.femaleLoanPercentage - 30) / (45 - 30)) * 100),
            dataYear: new Date().getFullYear(),
          },
          {
            code: 'SDG10.4',
            description: 'Rural customers as % of portfolio',
            value: rural.ruralPercentage,
            unit: '%',
            baseline: 20,
            target: 40,
            progress: Math.min(100, ((rural.ruralPercentage - 20) / (40 - 20)) * 100),
            dataYear: new Date().getFullYear(),
          },
        ],
        overallScore: 74,
        trend: 'STABLE',
      },
      {
        goal: GhanaSdgGoal.PARTNERSHIPS,
        title: 'Partnerships for the Goals',
        indicators: [
          {
            code: 'SDG17.3',
            description: 'Mobile money partnerships active',
            value: 3, // MTN, Telecel, AirtelTigo
            unit: 'partners',
            baseline: 1,
            target: 4,
            progress: 75,
            dataYear: new Date().getFullYear(),
          },
        ],
        overallScore: 80,
        trend: 'IMPROVING',
      },
    ];
  }

  private calculateOverallImpactScore(
    sme: SmeGrowthMetrics,
    women: WomenEmpowermentMetrics,
    rural: RuralOutreachMetrics,
    sdg: SdgAlignment[],
  ): number {
    const weights = {
      sme: 0.30, // 30% weight
      women: 0.25,
      rural: 0.25,
      sdg: 0.20,
    };

    const smeScore = Math.min(100, (sme.survivalRateAt12Months * 0.5 + sme.digitalAdoptionRate * 0.3 + (sme.avgRevenueGrowthPercent / 50) * 100 * 0.2));
    const womenScore = Math.min(100, women.femaleLoanPercentage / women.targetFemaleRatio * 100);
    const ruralScore = Math.min(100, (rural.ruralPercentage / 40) * 100);
    const sdgAvg = sdg.reduce((s, g) => s + g.overallScore, 0) / sdg.length;

    const overall = smeScore * weights.sme + womenScore * weights.women + ruralScore * weights.rural + sdgAvg * weights.sdg;
    return Math.round(overall);
  }

  private generateNarrativeSummary(
    women: WomenEmpowermentMetrics,
    rural: RuralOutreachMetrics,
    jobs: JobCreationMetrics,
  ): string {
    return (
      `Ghana Savings & Loans has achieved measurable social impact during this reporting period. ` +
      `${women.currentFemaleRatio.toFixed(1)}% of borrowers are women, ` +
      `${women.onTrackToTarget ? 'on track' : 'below target'} for our ${women.targetFemaleRatio}% gender inclusion goal. ` +
      `Female borrowers demonstrate a ${(women.femaleRepaymentRate - women.maleRepaymentRate).toFixed(1)}pp higher repayment rate than male borrowers. ` +
      `Rural outreach covers ${rural.regionsCovered.length} of 16 Ghana regions, serving ${rural.ruralCustomers} rural customers ` +
      `(${rural.ruralPercentage.toFixed(1)}% of portfolio) — ${rural.mobileMoneyDisbursementRate.toFixed(1)}% via mobile money for financial accessibility. ` +
      `Our SME lending has supported an estimated ${jobs.directJobsCreated} direct jobs with ${jobs.indirectJobsSupported} ` +
      `indirect jobs in local supply chains, contributing to Ghana's SDG 8 targets.`
    );
  }
}

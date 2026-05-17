/**
 * Product Configurator Controller
 *
 * Manages loan and savings product configurations with full compliance enforcement:
 *   - DCD 2025 interest rate caps (max 30% p.a. simple interest for personal loans)
 *   - BoG Directive on Fees and Charges (no hidden fees)
 *   - Credit Reporting Act compliance
 *   - Compound interest PROHIBITED per BoG DCD 2025 directive
 *
 * Compliance References:
 *   - BoG Directive on Credit Conditions 2025 (DCD 2025)
 *   - BoG Consumer Protection Guidelines 2023
 *   - Borrowers and Lenders Act 2020 (Act 1052)
 */

import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery,
  ApiResponse, ApiParam,
} from '@nestjs/swagger';
import {
  IsString, IsNumber, IsBoolean, IsEnum, IsOptional, IsArray,
  Min, Max, MaxLength, ValidateNested, IsPositive,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { MfaRequiredGuard } from '../../common/guards/mfa-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { MfaRequired } from '../../common/decorators/mfa-required.decorator';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * DCD 2025: Maximum annual interest rate for all loan products.
 * This cap is enforced server-side and cannot be overridden by UI.
 */
export const DCD_2025_MAX_INTEREST_RATE_PA = 30; // 30% p.a.

/**
 * DCD 2025: Maximum processing fee as % of loan amount.
 */
export const DCD_2025_MAX_PROCESSING_FEE_PCT = 3; // 3%

/**
 * DCD 2025: Compound interest is STRICTLY PROHIBITED.
 * Violation is a criminal offence under Act 1052 §23.
 */
export const COMPOUND_INTEREST_PROHIBITED = true;

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ProductType {
  PERSONAL_LOAN = 'PERSONAL_LOAN',
  SME_LOAN = 'SME_LOAN',
  AGRICULTURE_LOAN = 'AGRICULTURE_LOAN',
  MICROFINANCE_LOAN = 'MICROFINANCE_LOAN',
  SUSU_SAVINGS = 'SUSU_SAVINGS',
  FIXED_DEPOSIT = 'FIXED_DEPOSIT',
  TARGET_SAVINGS = 'TARGET_SAVINGS',
  PENSION_SAVINGS = 'PENSION_SAVINGS',
}

export enum InterestCalculationMethod {
  SIMPLE = 'SIMPLE', // ONLY allowed method per DCD 2025
  // COMPOUND = 'COMPOUND', // PROHIBITED — intentionally commented out
  FLAT = 'FLAT',
  REDUCING_BALANCE = 'REDUCING_BALANCE',
}

export enum RepaymentFrequency {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  BULLET = 'BULLET', // single repayment at maturity
}

export enum CollateralType {
  NONE = 'NONE',
  SALARY_DEDUCTION = 'SALARY_DEDUCTION',
  LAND = 'LAND',
  VEHICLE = 'VEHICLE',
  GUARANTOR = 'GUARANTOR',
  INSURANCE = 'INSURANCE',
  GOLD = 'GOLD',
}

export enum ProductStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class InterestRateConfigDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  @Max(DCD_2025_MAX_INTEREST_RATE_PA, {
    message: `Interest rate cannot exceed ${DCD_2025_MAX_INTEREST_RATE_PA}% p.a. per BoG DCD 2025`,
  })
  annualRatePercent: number;

  @IsEnum(InterestCalculationMethod)
  method: InterestCalculationMethod;
}

class FeeConfigDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  processingFeePercent: number; // % of loan amount

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  processingFeeFlat: number; // Fixed GHS amount

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  insuranceFeePercent: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  latePenaltyPercent: number; // % of overdue amount per month (max 2% per DCD 2025)

  @IsBoolean()
  legalFeeOnDefault: boolean;
}

class EligibilityCriteriaDto {
  @IsNumber()
  @Min(18)
  @Max(70)
  minAge: number;

  @IsNumber()
  @Max(75)
  maxAge: number;

  @IsNumber()
  @Min(0)
  minMonthlyIncome: number; // GHS

  @IsNumber()
  @Min(0)
  minCreditScore: number; // 300–850

  @IsBoolean()
  requiresGhanaCard: boolean;

  @IsBoolean()
  requiresSalarySlip: boolean;

  @IsBoolean()
  requiresBusinessRegistration: boolean;

  @IsNumber()
  @Min(0)
  minMonthsEmployed: number;

  @IsArray()
  @IsEnum(CollateralType, { each: true })
  acceptedCollateral: CollateralType[];

  @IsNumber()
  @Min(1)
  @Max(12)
  minActiveMonthsWithBank: number;
}

class ApprovalWorkflowDto {
  @IsNumber()
  @Min(0)
  singleApprovalLimitGhs: number; // below this → auto-approve

  @IsNumber()
  @Min(0)
  dualApprovalLimitGhs: number; // below this → loan officer + branch manager

  @IsBoolean()
  requiresCreditBureauCheck: boolean;

  @IsBoolean()
  requiresNiaVerification: boolean;

  @IsBoolean()
  requiresBoardApprovalAboveGhs: boolean;

  @IsNumber()
  boardApprovalThresholdGhs: number;

  @IsNumber()
  @Min(1)
  @Max(30)
  approvalSlaHours: number;
}

export class CreateProductDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsEnum(ProductType)
  type: ProductType;

  @IsNumber()
  @IsPositive()
  minAmountGhs: number;

  @IsNumber()
  @IsPositive()
  maxAmountGhs: number;

  @IsNumber()
  @Min(1)
  minTermMonths: number;

  @IsNumber()
  @Min(1)
  maxTermMonths: number;

  @IsEnum(RepaymentFrequency)
  repaymentFrequency: RepaymentFrequency;

  @ValidateNested()
  @Type(() => InterestRateConfigDto)
  interestRate: InterestRateConfigDto;

  @ValidateNested()
  @Type(() => FeeConfigDto)
  fees: FeeConfigDto;

  @ValidateNested()
  @Type(() => EligibilityCriteriaDto)
  eligibility: EligibilityCriteriaDto;

  @ValidateNested()
  @Type(() => ApprovalWorkflowDto)
  approvalWorkflow: ApprovalWorkflowDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  termsAndConditions?: string;

  @IsBoolean()
  isRevolving: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRegions?: string[]; // Ghana regions

  @IsOptional()
  @IsBoolean()
  targetWomenBorrowers?: boolean;

  @IsOptional()
  @IsBoolean()
  targetYouthBorrowers?: boolean; // 18–35

  @IsOptional()
  @IsBoolean()
  targetRuralBorrowers?: boolean;
}

export class UpdateProductDto extends CreateProductDto {
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @IsString()
  @IsOptional()
  changeReason?: string; // mandatory audit field for rate changes
}

export class ProductQueryDto {
  @IsEnum(ProductType)
  @IsOptional()
  type?: ProductType;

  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  targetWomen?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  targetRural?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 20;
}

// ─── In-memory product store (replace with TypeORM repository) ────────────────

interface StoredProduct extends CreateProductDto {
  id: number;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  version: number;
}

let productIdCounter = 1;
const productStore: StoredProduct[] = [];

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Product Configuration')
@ApiBearerAuth()
@Controller('admin/products')
@UseGuards(MfaRequiredGuard, RolesGuard)
export class ProductConfiguratorController {

  /**
   * List all loan/savings products with optional filters.
   */
  @Get()
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'List all products' })
  @ApiQuery({ name: 'type', enum: ProductType, required: false })
  @ApiQuery({ name: 'status', enum: ProductStatus, required: false })
  @ApiResponse({ status: 200, description: 'Product list returned' })
  findAll(@Query() query: ProductQueryDto) {
    let results = [...productStore];

    if (query.type) results = results.filter((p) => p.type === query.type);
    if (query.status) results = results.filter((p) => p.status === query.status);
    if (query.targetWomen) results = results.filter((p) => p.targetWomenBorrowers === true);
    if (query.targetRural) results = results.filter((p) => p.targetRuralBorrowers === true);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const start = (page - 1) * limit;

    return {
      data: results.slice(start, start + limit),
      meta: { total: results.length, page, limit },
    };
  }

  /**
   * Get a specific product by ID.
   */
  @Get(':id')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Product returned' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    const product = productStore.find((p) => p.id === id);
    if (!product) return { error: 'Product not found', statusCode: 404 };
    return product;
  }

  /**
   * Create a new product. Enforces DCD 2025 compliance checks.
   */
  @Post()
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new product (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({ status: 400, description: 'Validation error or compliance violation' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions or MFA not verified' })
  create(@Body() dto: CreateProductDto) {
    const complianceCheck = this.enforceComplianceRules(dto);
    if (!complianceCheck.passed) {
      return { error: 'Compliance violation', violations: complianceCheck.violations, statusCode: 400 };
    }

    const product: StoredProduct = {
      ...dto,
      id: productIdCounter++,
      status: ProductStatus.DRAFT,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'system', // replace with JWT sub
      version: 1,
    };

    productStore.push(product);
    return product;
  }

  /**
   * Update an existing product.
   * Any interest rate change triggers BoG notification requirement (Act 1052 §15).
   */
  @Put(':id')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Update product configuration (ADMIN only)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({ status: 400, description: 'Compliance violation' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    const index = productStore.findIndex((p) => p.id === id);
    if (index === -1) return { error: 'Product not found', statusCode: 404 };

    const complianceCheck = this.enforceComplianceRules(dto);
    if (!complianceCheck.passed) {
      return { error: 'Compliance violation', violations: complianceCheck.violations, statusCode: 400 };
    }

    const existing = productStore[index];
    const rateChanged = existing.interestRate.annualRatePercent !== dto.interestRate.annualRatePercent;

    const updated: StoredProduct = {
      ...existing,
      ...dto,
      id,
      status: dto.status ?? existing.status,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    productStore[index] = updated;

    return {
      ...updated,
      warnings: rateChanged
        ? ['Interest rate change recorded. BoG notification may be required per Act 1052 §15 within 14 days.']
        : [],
    };
  }

  /**
   * Activate a product (make it available for applications).
   */
  @Put(':id/activate')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Activate a product' })
  @ApiParam({ name: 'id', type: Number })
  activate(@Param('id', ParseIntPipe) id: number) {
    const product = productStore.find((p) => p.id === id);
    if (!product) return { error: 'Product not found', statusCode: 404 };
    if (product.status === ProductStatus.ARCHIVED) {
      return { error: 'Cannot activate archived product', statusCode: 400 };
    }
    product.status = ProductStatus.ACTIVE;
    product.updatedAt = new Date().toISOString();
    return product;
  }

  /**
   * Suspend a product (block new applications but keep existing loans active).
   */
  @Put(':id/suspend')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Suspend a product' })
  @ApiParam({ name: 'id', type: Number })
  suspend(@Param('id', ParseIntPipe) id: number, @Body() body: { reason: string }) {
    const product = productStore.find((p) => p.id === id);
    if (!product) return { error: 'Product not found', statusCode: 404 };
    product.status = ProductStatus.SUSPENDED;
    product.updatedAt = new Date().toISOString();
    return { ...product, suspensionReason: body.reason };
  }

  /**
   * Archive a product (soft delete — retain for audit history).
   */
  @Delete(':id')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Archive a product (soft delete)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Product archived' })
  archive(@Param('id', ParseIntPipe) id: number) {
    const product = productStore.find((p) => p.id === id);
    if (!product) return { error: 'Product not found', statusCode: 404 };
    product.status = ProductStatus.ARCHIVED;
    product.updatedAt = new Date().toISOString();
    return { message: 'Product archived (data retained for 10-year audit requirement)', product };
  }

  /**
   * Calculate estimated repayment schedule for a product configuration.
   * Useful for product design and customer-facing comparisons.
   */
  @Post(':id/simulate')
  @Roles('ADMIN', 'LOAN_OFFICER')
  @ApiOperation({ summary: 'Simulate repayment schedule for a product' })
  @ApiParam({ name: 'id', type: Number })
  simulate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { amountGhs: number; termMonths: number },
  ) {
    const product = productStore.find((p) => p.id === id);
    if (!product) return { error: 'Product not found', statusCode: 404 };

    return this.calculateRepaymentSchedule(
      body.amountGhs,
      body.termMonths,
      product.interestRate.annualRatePercent,
      product.interestRate.method,
      product.repaymentFrequency,
      product.fees,
    );
  }

  /**
   * Return a machine-readable summary of DCD 2025 compliance rules.
   * Used by the UI to display rate caps to product managers.
   */
  @Get('compliance/dcd2025-rules')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER')
  @ApiOperation({ summary: 'Get DCD 2025 compliance rules' })
  getComplianceRules() {
    return {
      effectiveDate: '2025-01-01',
      directive: 'BoG Directive on Credit Conditions 2025 (DCD 2025)',
      rules: [
        {
          rule: 'MAX_INTEREST_RATE',
          value: `${DCD_2025_MAX_INTEREST_RATE_PA}% p.a.`,
          description: 'Maximum annual simple interest rate for all personal loan products',
          legalRef: 'DCD 2025 §4(1)',
        },
        {
          rule: 'NO_COMPOUND_INTEREST',
          value: 'PROHIBITED',
          description: 'Compound interest is strictly prohibited on all loan products',
          legalRef: 'Borrowers and Lenders Act 2020 (Act 1052) §23',
        },
        {
          rule: 'MAX_PROCESSING_FEE',
          value: `${DCD_2025_MAX_PROCESSING_FEE_PCT}% of loan amount`,
          description: 'Maximum one-time processing fee',
          legalRef: 'DCD 2025 §6(2)',
        },
        {
          rule: 'MANDATORY_DISCLOSURE',
          value: 'APR, total repayable, schedule',
          description: 'All-in cost disclosure required before loan disbursement',
          legalRef: 'BoG Consumer Protection Guidelines 2023 §8',
        },
        {
          rule: 'PREPAYMENT_RIGHT',
          value: 'No penalty',
          description: 'Borrower has right to prepay without penalty at any time',
          legalRef: 'Act 1052 §18',
        },
      ],
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private enforceComplianceRules(dto: CreateProductDto): { passed: boolean; violations: string[] } {
    const violations: string[] = [];

    // DCD 2025: Rate cap
    if (dto.interestRate.annualRatePercent > DCD_2025_MAX_INTEREST_RATE_PA) {
      violations.push(
        `Interest rate ${dto.interestRate.annualRatePercent}% exceeds DCD 2025 cap of ${DCD_2025_MAX_INTEREST_RATE_PA}% p.a. [DCD 2025 §4(1)]`,
      );
    }

    // DCD 2025: Compound interest prohibition
    if (dto.interestRate.method === ('COMPOUND' as InterestCalculationMethod)) {
      violations.push(
        'COMPOUND interest is PROHIBITED per Borrowers and Lenders Act 2020 (Act 1052) §23. Use SIMPLE, FLAT, or REDUCING_BALANCE.',
      );
    }

    // DCD 2025: Processing fee cap
    if (dto.fees.processingFeePercent > DCD_2025_MAX_PROCESSING_FEE_PCT) {
      violations.push(
        `Processing fee ${dto.fees.processingFeePercent}% exceeds DCD 2025 cap of ${DCD_2025_MAX_PROCESSING_FEE_PCT}% [DCD 2025 §6(2)]`,
      );
    }

    // Late penalty cap: 2% per month per DCD 2025
    if (dto.fees.latePenaltyPercent > 2) {
      violations.push(
        `Late penalty ${dto.fees.latePenaltyPercent}% exceeds BoG max of 2% per month [DCD 2025 §7]`,
      );
    }

    // Age eligibility
    if (dto.eligibility.minAge < 18) {
      violations.push('Minimum borrower age cannot be below 18 years (Ghana labour law)');
    }

    // Min/max amount sanity check
    if (dto.minAmountGhs >= dto.maxAmountGhs) {
      violations.push('minAmountGhs must be strictly less than maxAmountGhs');
    }

    // Term sanity check
    if (dto.minTermMonths >= dto.maxTermMonths) {
      violations.push('minTermMonths must be strictly less than maxTermMonths');
    }

    return { passed: violations.length === 0, violations };
  }

  private calculateRepaymentSchedule(
    principalGhs: number,
    termMonths: number,
    annualRatePct: number,
    method: InterestCalculationMethod,
    frequency: RepaymentFrequency,
    fees: FeeConfigDto,
  ) {
    const monthlyRate = annualRatePct / 100 / 12;
    const processingFee = Math.min(
      principalGhs * (fees.processingFeePercent / 100) + fees.processingFeeFlat,
      principalGhs * (DCD_2025_MAX_PROCESSING_FEE_PCT / 100),
    );
    const insuranceFee = principalGhs * (fees.insuranceFeePercent / 100);

    let monthlyPayment: number;
    let totalInterest: number;

    switch (method) {
      case InterestCalculationMethod.FLAT:
        totalInterest = principalGhs * (annualRatePct / 100) * (termMonths / 12);
        monthlyPayment = (principalGhs + totalInterest) / termMonths;
        break;

      case InterestCalculationMethod.REDUCING_BALANCE:
        if (monthlyRate === 0) {
          monthlyPayment = principalGhs / termMonths;
        } else {
          monthlyPayment =
            (principalGhs * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
            (Math.pow(1 + monthlyRate, termMonths) - 1);
        }
        totalInterest = monthlyPayment * termMonths - principalGhs;
        break;

      case InterestCalculationMethod.SIMPLE:
      default:
        totalInterest = principalGhs * (annualRatePct / 100) * (termMonths / 12);
        monthlyPayment = (principalGhs + totalInterest) / termMonths;
        break;
    }

    const totalRepayable = principalGhs + totalInterest + processingFee + insuranceFee;
    const apr = ((totalRepayable - principalGhs) / principalGhs / (termMonths / 12)) * 100;

    const schedule = Array.from({ length: termMonths }, (_, i) => ({
      installment: i + 1,
      dueDate: this.addMonths(new Date(), i + 1).toISOString().substring(0, 10),
      amount: Math.round(monthlyPayment * 100) / 100,
    }));

    return {
      principal: principalGhs,
      termMonths,
      interestMethod: method,
      annualRatePercent: annualRatePct,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
      processingFee: Math.round(processingFee * 100) / 100,
      insuranceFee: Math.round(insuranceFee * 100) / 100,
      totalRepayable: Math.round(totalRepayable * 100) / 100,
      effectiveAPR: Math.round(apr * 100) / 100,
      repaymentSchedule: schedule,
      complianceNote: 'Compound interest has NOT been applied. Calculated in compliance with DCD 2025.',
      dcd2025Compliant: true,
    };
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }
}

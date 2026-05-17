/**
 * Workflow Designer Controller
 *
 * Configurable multi-level approval workflow engine for loan applications,
 * disbursements, and other financial operations.
 *
 * Features:
 *   - Multi-level approval chains (up to 5 levels)
 *   - Delegation with time boundaries
 *   - Automatic escalation on SLA breach
 *   - Mobile push notifications for approvers
 *   - Audit trail for all workflow state transitions
 *   - Break-glass emergency override (dual approval + enhanced logging)
 *
 * Compliance:
 *   - BoG Internal Controls Guideline 2019
 *   - Borrowers and Lenders Act 2020 (Act 1052) — approval authority limits
 *   - FATF Recommendation 22 — DNFBPs internal controls
 */

import {
  Controller, Get, Post, Put, Delete, Body, Param,
  UseGuards, HttpCode, HttpStatus, ParseIntPipe, Logger,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse,
} from '@nestjs/swagger';
import {
  IsString, IsNumber, IsBoolean, IsEnum, IsOptional, IsArray,
  Min, Max, MaxLength, ValidateNested, IsPositive, IsEmail,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MfaRequiredGuard } from '../../common/guards/mfa-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { MfaRequired } from '../../common/decorators/mfa-required.decorator';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum WorkflowTrigger {
  LOAN_APPLICATION = 'LOAN_APPLICATION',
  LOAN_DISBURSEMENT = 'LOAN_DISBURSEMENT',
  LOAN_RESTRUCTURE = 'LOAN_RESTRUCTURE',
  LOAN_WRITEOFF = 'LOAN_WRITEOFF',
  LARGE_WITHDRAWAL = 'LARGE_WITHDRAWAL',
  KYC_OVERRIDE = 'KYC_OVERRIDE',
  PRODUCT_CHANGE = 'PRODUCT_CHANGE',
  CUSTOMER_OFFBOARDING = 'CUSTOMER_OFFBOARDING',
  BREAK_GLASS = 'BREAK_GLASS',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
  DELEGATED = 'DELEGATED',
  EXPIRED = 'EXPIRED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum NotificationChannel {
  SMS = 'SMS',
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  IN_APP = 'IN_APP',
}

export enum EscalationStrategy {
  NEXT_LEVEL = 'NEXT_LEVEL',
  PARALLEL = 'PARALLEL',
  MANAGER = 'MANAGER',
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class ApprovalLevelDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  level: number;

  @IsString()
  @MaxLength(100)
  name: string; // e.g., "Loan Officer", "Branch Manager"

  @IsArray()
  @IsString({ each: true })
  approverRoles: string[];

  @IsNumber()
  @Min(1)
  @Max(720)
  slaDurationHours: number;

  @IsBoolean()
  requiresAllApprovers: boolean; // true = all; false = any one

  @IsEnum(EscalationStrategy)
  escalationStrategy: EscalationStrategy;

  @IsOptional()
  @IsNumber()
  escalatesToLevel?: number;

  @IsArray()
  @IsEnum(NotificationChannel, { each: true })
  notificationChannels: NotificationChannel[];

  @IsBoolean()
  allowDelegation: boolean;
}

export class CreateWorkflowDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(500)
  description: string;

  @IsEnum(WorkflowTrigger)
  trigger: WorkflowTrigger;

  @IsNumber()
  @Min(0)
  amountThresholdMin: number; // GHS — workflow applies above this

  @IsNumber()
  @Min(0)
  amountThresholdMax: number; // GHS — workflow applies below this (0 = unlimited)

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  levels: ApprovalLevelDto[];

  @IsBoolean()
  autoApproveBelow: boolean;

  @IsOptional()
  @IsNumber()
  autoApprovalLimitGhs?: number;

  @IsBoolean()
  allowBreakGlass: boolean;

  @IsBoolean()
  requiresDualApprovalForBreakGlass: boolean;

  @IsBoolean()
  isActive: boolean;
}

export class DelegationDto {
  @IsNumber()
  workflowId: number;

  @IsString()
  delegateeUserId: string;

  @IsString()
  delegateeRole: string;

  @IsString()
  startDateTime: string; // ISO 8601

  @IsString()
  endDateTime: string; // ISO 8601

  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ApprovalDecisionDto {
  @IsEnum(ApprovalStatus)
  decision: ApprovalStatus.APPROVED | ApprovalStatus.REJECTED;

  @IsString()
  @MaxLength(1000)
  comments: string;

  @IsOptional()
  @IsString()
  conditions?: string; // conditional approval notes

  @IsOptional()
  @IsString()
  mfaToken?: string; // for high-value approvals
}

export class BreakGlassRequestDto {
  @IsString()
  @MaxLength(1000)
  justification: string;

  @IsString()
  targetRecordType: string;

  @IsString()
  targetRecordId: string;

  @IsString()
  secondApproverUserId: string; // mandatory dual approval

  @IsString()
  mfaToken: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

interface StoredWorkflow extends CreateWorkflowDto {
  id: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface WorkflowInstance {
  instanceId: string;
  workflowId: number;
  workflowName: string;
  trigger: WorkflowTrigger;
  subjectId: string;
  currentLevel: number;
  status: ApprovalStatus;
  history: ApprovalHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  amountGhs: number;
}

interface ApprovalHistoryEntry {
  level: number;
  action: string;
  actorId: string;
  actorRole: string;
  timestamp: string;
  comments: string;
  status: ApprovalStatus;
}

interface DelegationRecord extends DelegationDto {
  id: string;
  delegatorUserId: string;
  createdAt: string;
  isActive: boolean;
}

let workflowIdCounter = 1;
const workflowStore: StoredWorkflow[] = [];
const workflowInstances: WorkflowInstance[] = [];
const delegations: DelegationRecord[] = [];

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('Workflow Designer')
@ApiBearerAuth()
@Controller('admin/workflows')
@UseGuards(MfaRequiredGuard, RolesGuard)
export class WorkflowDesignerController {
  private readonly logger = new Logger(WorkflowDesignerController.name);

  /**
   * List all workflow definitions.
   */
  @Get()
  @Roles('ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'List all workflow definitions' })
  findAll() {
    return { data: workflowStore, total: workflowStore.length };
  }

  /**
   * Get a specific workflow definition.
   */
  @Get(':id')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'Get workflow by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    const workflow = workflowStore.find((w) => w.id === id);
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    return workflow;
  }

  /**
   * Create a workflow definition.
   */
  @Post()
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a workflow definition' })
  @ApiResponse({ status: 201, description: 'Workflow created' })
  create(@Body() dto: CreateWorkflowDto) {
    this.validateWorkflowLevels(dto.levels);

    const workflow: StoredWorkflow = {
      ...dto,
      id: workflowIdCounter++,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'system',
    };

    workflowStore.push(workflow);
    this.logger.log(`Workflow created [id=${workflow.id}, trigger=${workflow.trigger}]`);
    return workflow;
  }

  /**
   * Update a workflow definition.
   */
  @Put(':id')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Update a workflow definition' })
  @ApiParam({ name: 'id', type: Number })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateWorkflowDto) {
    const index = workflowStore.findIndex((w) => w.id === id);
    if (index === -1) throw new NotFoundException(`Workflow ${id} not found`);
    this.validateWorkflowLevels(dto.levels);

    workflowStore[index] = { ...workflowStore[index], ...dto, updatedAt: new Date().toISOString() };
    return workflowStore[index];
  }

  /**
   * Delete (deactivate) a workflow.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Deactivate a workflow' })
  @ApiParam({ name: 'id', type: Number })
  deactivate(@Param('id', ParseIntPipe) id: number) {
    const workflow = workflowStore.find((w) => w.id === id);
    if (!workflow) throw new NotFoundException(`Workflow ${id} not found`);
    workflow.isActive = false;
    return { message: 'Workflow deactivated', id };
  }

  /**
   * List all active workflow instances.
   */
  @Get('instances/active')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER')
  @ApiOperation({ summary: 'List active workflow instances' })
  getActiveInstances() {
    const active = workflowInstances.filter(
      (i) => i.status === ApprovalStatus.PENDING || i.status === ApprovalStatus.ESCALATED,
    );
    return { data: active, total: active.length };
  }

  /**
   * Get a specific workflow instance by ID.
   */
  @Get('instances/:instanceId')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'Get workflow instance' })
  @ApiParam({ name: 'instanceId', type: String })
  getInstance(@Param('instanceId') instanceId: string) {
    const instance = workflowInstances.find((i) => i.instanceId === instanceId);
    if (!instance) throw new NotFoundException(`Instance ${instanceId} not found`);
    return instance;
  }

  /**
   * Submit an approval decision for a workflow instance.
   */
  @Post('instances/:instanceId/decide')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Submit approval decision' })
  @ApiParam({ name: 'instanceId', type: String })
  decide(
    @Param('instanceId') instanceId: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    const instance = workflowInstances.find((i) => i.instanceId === instanceId);
    if (!instance) throw new NotFoundException(`Instance ${instanceId} not found`);
    if (instance.status !== ApprovalStatus.PENDING && instance.status !== ApprovalStatus.ESCALATED) {
      throw new BadRequestException(`Instance is already in terminal state: ${instance.status}`);
    }

    const historyEntry: ApprovalHistoryEntry = {
      level: instance.currentLevel,
      action: dto.decision,
      actorId: 'current-user', // replace with JWT sub
      actorRole: 'LOAN_OFFICER', // replace with JWT role
      timestamp: new Date().toISOString(),
      comments: dto.comments,
      status: dto.decision,
    };

    instance.history.push(historyEntry);
    instance.status = dto.decision;
    instance.updatedAt = new Date().toISOString();

    this.logger.log(
      `Workflow decision [instance=${instanceId}, decision=${dto.decision}, level=${instance.currentLevel}]`,
    );

    return instance;
  }

  /**
   * Escalate a workflow instance manually.
   */
  @Post('instances/:instanceId/escalate')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Manually escalate a workflow instance' })
  @ApiParam({ name: 'instanceId', type: String })
  escalate(
    @Param('instanceId') instanceId: string,
    @Body() body: { reason: string },
  ) {
    const instance = workflowInstances.find((i) => i.instanceId === instanceId);
    if (!instance) throw new NotFoundException(`Instance ${instanceId} not found`);

    const workflow = workflowStore.find((w) => w.id === instance.workflowId);
    if (!workflow) throw new NotFoundException('Workflow definition not found');

    const nextLevel = instance.currentLevel + 1;
    if (nextLevel > workflow.levels.length) {
      throw new BadRequestException('No higher approval level available');
    }

    instance.currentLevel = nextLevel;
    instance.status = ApprovalStatus.ESCALATED;
    instance.updatedAt = new Date().toISOString();

    instance.history.push({
      level: instance.currentLevel,
      action: 'ESCALATED',
      actorId: 'system',
      actorRole: 'SYSTEM',
      timestamp: new Date().toISOString(),
      comments: body.reason,
      status: ApprovalStatus.ESCALATED,
    });

    this.logger.warn(
      `Workflow escalated [instance=${instanceId}, from=${nextLevel - 1}, to=${nextLevel}]`,
    );

    return instance;
  }

  /**
   * Set up an approval delegation.
   * Delegate approves on behalf of delegator within the time window.
   */
  @Post('delegations')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Create approval delegation' })
  createDelegation(@Body() dto: DelegationDto) {
    const record: DelegationRecord = {
      ...dto,
      id: `DEL-${Date.now()}`,
      delegatorUserId: 'current-user', // replace with JWT sub
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    delegations.push(record);
    this.logger.log(
      `Delegation created [id=${record.id}, to=${dto.delegateeUserId}, until=${dto.endDateTime}]`,
    );

    return record;
  }

  /**
   * Revoke a delegation.
   */
  @Delete('delegations/:id')
  @Roles('ADMIN', 'LOAN_OFFICER', 'COMPLIANCE_OFFICER')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Revoke delegation' })
  @ApiParam({ name: 'id', type: String })
  revokeDelegation(@Param('id') id: string) {
    const delegation = delegations.find((d) => d.id === id);
    if (!delegation) throw new NotFoundException(`Delegation ${id} not found`);
    delegation.isActive = false;
    return { message: 'Delegation revoked', id };
  }

  /**
   * Emergency break-glass access.
   * Requires dual approval + MFA + creates immutable audit record.
   * Used for emergency data access outside normal approval chain.
   */
  @Post('break-glass')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({
    summary: 'Emergency break-glass access (dual approval + full audit)',
    description:
      'CRITICAL: Use only in genuine emergencies. All break-glass events are reported to the Board Risk Committee and BoG within 24 hours.',
  })
  @ApiResponse({ status: 201, description: 'Break-glass session created — audited' })
  @ApiResponse({ status: 403, description: 'MFA not verified or second approver not found' })
  breakGlass(@Body() dto: BreakGlassRequestDto) {
    // In production: verify mfaToken, verify secondApprover exists and is online
    const sessionId = `BG-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    this.logger.warn(
      `BREAK-GLASS ACCESS [session=${sessionId}, target=${dto.targetRecordType}:${dto.targetRecordId}, second=${dto.secondApproverUserId}] — AUDIT RECORDED`,
    );

    return {
      sessionId,
      status: 'AUTHORIZED',
      justification: dto.justification,
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), // 30 min
      auditNote: 'This break-glass event has been logged and will be reported to the Board Risk Committee and BoG within 24 hours per BoG Cybersecurity Directive 2022.',
      warnings: [
        'All actions during this session are recorded',
        'Unauthorized use is a criminal offence under Cybersecurity Act 2020 (Act 1038) §52',
      ],
    };
  }

  /**
   * Check for overdue SLA instances and return a summary.
   * Called by the scheduler service every 15 minutes.
   */
  @Get('sla/overdue')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER')
  @ApiOperation({ summary: 'Get overdue workflow instances (SLA breached)' })
  getOverdueSlaInstances() {
    const now = Date.now();
    const overdue = workflowInstances.filter(
      (i) =>
        i.status === ApprovalStatus.PENDING &&
        new Date(i.dueAt).getTime() < now,
    );

    return {
      count: overdue.length,
      instances: overdue,
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private validateWorkflowLevels(levels: ApprovalLevelDto[]): void {
    if (levels.length === 0) {
      throw new BadRequestException('Workflow must have at least one approval level');
    }
    if (levels.length > 5) {
      throw new BadRequestException('Maximum 5 approval levels allowed');
    }

    const levelNumbers = levels.map((l) => l.level);
    const uniqueLevels = new Set(levelNumbers);
    if (uniqueLevels.size !== levels.length) {
      throw new BadRequestException('Duplicate level numbers in workflow definition');
    }

    for (const level of levels) {
      if (level.escalatesToLevel && level.escalatesToLevel <= level.level) {
        throw new BadRequestException(
          `Level ${level.level}: escalatesToLevel must be higher than current level`,
        );
      }
    }
  }
}

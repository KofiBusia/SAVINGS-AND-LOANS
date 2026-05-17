/**
 * User Role Manager Controller
 *
 * RBAC implementation with roles:
 *   ADMIN, LOAN_OFFICER, TELLER, COMPLIANCE_OFFICER, AUDITOR, CUSTOMER, FIELD_AGENT
 *
 * Features:
 *   - Permission matrix enforcement
 *   - Full audit logging of all role/permission changes
 *   - Principle of least privilege
 *   - Segregation of duties enforcement
 *
 * Compliance:
 *   - BoG Corporate Governance Directive 2022
 *   - BoG Internal Controls Guideline (ICG) 2019 §4.3 — access controls
 *   - Data Protection Act 2012 (Act 843) — data access control
 *   - Cybersecurity Act 2020 (Act 1038) §37 — access management
 */

import {
  Controller, Get, Post, Put, Delete, Body, Param,
  UseGuards, HttpCode, HttpStatus, Logger, Query,
  BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse, ApiQuery,
} from '@nestjs/swagger';
import {
  IsString, IsEnum, IsOptional, IsArray, MaxLength, IsEmail, IsBoolean,
} from 'class-validator';
import { MfaRequiredGuard } from '../../common/guards/mfa-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { MfaRequired } from '../../common/decorators/mfa-required.decorator';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SystemRole {
  ADMIN = 'ADMIN',
  LOAN_OFFICER = 'LOAN_OFFICER',
  TELLER = 'TELLER',
  COMPLIANCE_OFFICER = 'COMPLIANCE_OFFICER',
  AUDITOR = 'AUDITOR',
  CUSTOMER = 'CUSTOMER',
  FIELD_AGENT = 'FIELD_AGENT',
}

export enum Permission {
  // Customer management
  CUSTOMER_VIEW = 'CUSTOMER_VIEW',
  CUSTOMER_CREATE = 'CUSTOMER_CREATE',
  CUSTOMER_UPDATE = 'CUSTOMER_UPDATE',
  CUSTOMER_DELETE = 'CUSTOMER_DELETE',
  CUSTOMER_KYC_APPROVE = 'CUSTOMER_KYC_APPROVE',

  // Loan operations
  LOAN_VIEW = 'LOAN_VIEW',
  LOAN_APPLY = 'LOAN_APPLY',
  LOAN_APPROVE = 'LOAN_APPROVE',
  LOAN_DISBURSE = 'LOAN_DISBURSE',
  LOAN_RESTRUCTURE = 'LOAN_RESTRUCTURE',
  LOAN_WRITEOFF = 'LOAN_WRITEOFF',
  LOAN_CLOSE = 'LOAN_CLOSE',

  // Savings operations
  SAVINGS_VIEW = 'SAVINGS_VIEW',
  SAVINGS_DEPOSIT = 'SAVINGS_DEPOSIT',
  SAVINGS_WITHDRAW = 'SAVINGS_WITHDRAW',

  // Payments
  PAYMENT_VIEW = 'PAYMENT_VIEW',
  PAYMENT_INITIATE = 'PAYMENT_INITIATE',
  PAYMENT_APPROVE = 'PAYMENT_APPROVE',
  PAYMENT_REFUND = 'PAYMENT_REFUND',

  // Product management
  PRODUCT_VIEW = 'PRODUCT_VIEW',
  PRODUCT_CREATE = 'PRODUCT_CREATE',
  PRODUCT_UPDATE = 'PRODUCT_UPDATE',
  PRODUCT_DELETE = 'PRODUCT_DELETE',

  // Reports and analytics
  REPORT_VIEW = 'REPORT_VIEW',
  REPORT_EXPORT = 'REPORT_EXPORT',
  BOG_REPORT_SUBMIT = 'BOG_REPORT_SUBMIT',

  // Compliance
  AML_ALERTS_VIEW = 'AML_ALERTS_VIEW',
  AML_ALERTS_MANAGE = 'AML_ALERTS_MANAGE',
  COMPLIANCE_REPORT_VIEW = 'COMPLIANCE_REPORT_VIEW',

  // User and role management
  USER_VIEW = 'USER_VIEW',
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_SUSPEND = 'USER_SUSPEND',
  ROLE_ASSIGN = 'ROLE_ASSIGN',

  // System administration
  SYSTEM_CONFIG = 'SYSTEM_CONFIG',
  AUDIT_LOG_VIEW = 'AUDIT_LOG_VIEW',
  SECURITY_CONSOLE = 'SECURITY_CONSOLE',
  BREAK_GLASS = 'BREAK_GLASS',
  API_KEY_MANAGE = 'API_KEY_MANAGE',
}

// ─── Permission Matrix ────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SystemRole.ADMIN]: Object.values(Permission), // full access

  [SystemRole.LOAN_OFFICER]: [
    Permission.CUSTOMER_VIEW, Permission.CUSTOMER_CREATE, Permission.CUSTOMER_UPDATE,
    Permission.CUSTOMER_KYC_APPROVE,
    Permission.LOAN_VIEW, Permission.LOAN_APPLY, Permission.LOAN_APPROVE,
    Permission.LOAN_DISBURSE, Permission.LOAN_RESTRUCTURE,
    Permission.SAVINGS_VIEW,
    Permission.PAYMENT_VIEW, Permission.PAYMENT_INITIATE,
    Permission.PRODUCT_VIEW,
    Permission.REPORT_VIEW,
    Permission.AML_ALERTS_VIEW,
    Permission.USER_VIEW,
    Permission.AUDIT_LOG_VIEW,
  ],

  [SystemRole.TELLER]: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_VIEW,
    Permission.SAVINGS_VIEW, Permission.SAVINGS_DEPOSIT, Permission.SAVINGS_WITHDRAW,
    Permission.PAYMENT_VIEW, Permission.PAYMENT_INITIATE,
    Permission.REPORT_VIEW,
  ],

  [SystemRole.COMPLIANCE_OFFICER]: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_VIEW,
    Permission.SAVINGS_VIEW,
    Permission.PAYMENT_VIEW,
    Permission.PRODUCT_VIEW,
    Permission.REPORT_VIEW, Permission.REPORT_EXPORT,
    Permission.BOG_REPORT_SUBMIT,
    Permission.AML_ALERTS_VIEW, Permission.AML_ALERTS_MANAGE,
    Permission.COMPLIANCE_REPORT_VIEW,
    Permission.USER_VIEW,
    Permission.AUDIT_LOG_VIEW,
    Permission.SECURITY_CONSOLE,
  ],

  [SystemRole.AUDITOR]: [
    Permission.CUSTOMER_VIEW,
    Permission.LOAN_VIEW,
    Permission.SAVINGS_VIEW,
    Permission.PAYMENT_VIEW,
    Permission.PRODUCT_VIEW,
    Permission.REPORT_VIEW, Permission.REPORT_EXPORT,
    Permission.AML_ALERTS_VIEW,
    Permission.COMPLIANCE_REPORT_VIEW,
    Permission.USER_VIEW,
    Permission.AUDIT_LOG_VIEW,
    // AUDITOR deliberately has NO write permissions — read-only
  ],

  [SystemRole.CUSTOMER]: [
    Permission.LOAN_VIEW, Permission.LOAN_APPLY,
    Permission.SAVINGS_VIEW, Permission.SAVINGS_DEPOSIT,
    Permission.PAYMENT_VIEW,
  ],

  [SystemRole.FIELD_AGENT]: [
    Permission.CUSTOMER_VIEW, Permission.CUSTOMER_CREATE,
    Permission.LOAN_VIEW, Permission.LOAN_APPLY,
    Permission.SAVINGS_VIEW, Permission.SAVINGS_DEPOSIT,
    Permission.PAYMENT_VIEW, Permission.PAYMENT_INITIATE,
    Permission.REPORT_VIEW,
  ],
};

/**
 * Segregation of duties: these role combinations are PROHIBITED on the same user.
 * Violates BoG ICG 2019 §4.3.2.
 */
export const PROHIBITED_ROLE_COMBINATIONS: [SystemRole, SystemRole][] = [
  [SystemRole.LOAN_OFFICER, SystemRole.AUDITOR], // cannot approve own audits
  [SystemRole.TELLER, SystemRole.LOAN_OFFICER], // dual-role conflict
  [SystemRole.ADMIN, SystemRole.AUDITOR], // admin cannot audit themselves
];

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  fullName: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsEnum(SystemRole)
  role: SystemRole;

  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  additionalPermissions?: Permission[];

  @IsOptional()
  @IsString()
  branchCode?: string;

  @IsOptional()
  @IsString()
  supervisorUserId?: string;
}

export class UpdateUserRoleDto {
  @IsEnum(SystemRole)
  newRole: SystemRole;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsBoolean()
  notifyUser: boolean;
}

export class AssignPermissionsDto {
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];

  @IsString()
  @MaxLength(500)
  justification: string;
}

export class SuspendUserDto {
  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  resumeAt?: string; // ISO 8601 — if null: suspended indefinitely
}

// ─── In-memory store ──────────────────────────────────────────────────────────

interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: SystemRole;
  effectivePermissions: Permission[];
  additionalPermissions: Permission[];
  branchCode?: string;
  supervisorUserId?: string;
  isActive: boolean;
  isSuspended: boolean;
  suspensionReason?: string;
  suspendedUntil?: string;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  passwordChangedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  actorId: string;
  targetUserId: string;
  action: string;
  before: Partial<StoredUser>;
  after: Partial<StoredUser>;
  reason: string;
}

let userIdCounter = 100;
const userStore: StoredUser[] = [];
const auditLog: AuditEntry[] = [];

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('User & Role Management')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(MfaRequiredGuard, RolesGuard)
export class UserRoleManagerController {
  private readonly logger = new Logger(UserRoleManagerController.name);

  @Get()
  @Roles('ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'List all users' })
  @ApiQuery({ name: 'role', enum: SystemRole, required: false })
  @ApiQuery({ name: 'active', type: Boolean, required: false })
  findAll(
    @Query('role') role?: SystemRole,
    @Query('active') active?: string,
  ) {
    let users = [...userStore];
    if (role) users = users.filter((u) => u.role === role);
    if (active !== undefined) users = users.filter((u) => u.isActive === (active === 'true'));

    // Never return sensitive fields
    return users.map(this.sanitizeUser);
  }

  @Get(':id')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', type: String })
  findOne(@Param('id') id: string) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.sanitizeUser(user);
  }

  @Post()
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new system user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  create(@Body() dto: CreateUserDto) {
    if (userStore.find((u) => u.email === dto.email)) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    const id = (userIdCounter++).toString();
    const basePermissions = ROLE_PERMISSIONS[dto.role];
    const additionalPerms = (dto.additionalPermissions ?? []).filter(
      (p) => !basePermissions.includes(p),
    );

    const user: StoredUser = {
      id,
      email: dto.email,
      fullName: dto.fullName,
      phone: dto.phone,
      role: dto.role,
      effectivePermissions: [...basePermissions, ...additionalPerms],
      additionalPermissions: additionalPerms,
      branchCode: dto.branchCode,
      supervisorUserId: dto.supervisorUserId,
      isActive: true,
      isSuspended: false,
      mfaEnabled: false, // MFA enabled on first login
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    userStore.push(user);
    this.logAudit('USER_CREATE', 'system', id, {}, user, 'New user created');
    this.logger.log(`User created [id=${id}, role=${dto.role}, email=${dto.email}]`);

    return this.sanitizeUser(user);
  }

  @Put(':id/role')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Change user role' })
  @ApiParam({ name: 'id', type: String })
  changeRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    this.checkSegregationOfDuties(id, dto.newRole);

    const before = { role: user.role, effectivePermissions: user.effectivePermissions };
    user.role = dto.newRole;
    user.effectivePermissions = [...ROLE_PERMISSIONS[dto.newRole], ...user.additionalPermissions];
    user.updatedAt = new Date().toISOString();

    this.logAudit('ROLE_CHANGE', 'system', id, before, { role: user.role }, dto.reason);
    this.logger.log(`Role changed [user=${id}, from=${before.role}, to=${dto.newRole}]`);

    return this.sanitizeUser(user);
  }

  @Put(':id/permissions')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Assign additional permissions to user (above role defaults)' })
  @ApiParam({ name: 'id', type: String })
  assignPermissions(@Param('id') id: string, @Body() dto: AssignPermissionsDto) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    const before = { effectivePermissions: [...user.effectivePermissions] };
    const basePerms = ROLE_PERMISSIONS[user.role];
    user.additionalPermissions = dto.permissions.filter((p) => !basePerms.includes(p));
    user.effectivePermissions = [...basePerms, ...user.additionalPermissions];
    user.updatedAt = new Date().toISOString();

    this.logAudit('PERMISSION_UPDATE', 'system', id, before, { effectivePermissions: user.effectivePermissions }, dto.justification);

    return this.sanitizeUser(user);
  }

  @Put(':id/suspend')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Suspend a user account' })
  @ApiParam({ name: 'id', type: String })
  suspend(@Param('id') id: string, @Body() dto: SuspendUserDto) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (user.isSuspended) {
      throw new BadRequestException('User is already suspended');
    }

    user.isSuspended = true;
    user.isActive = false;
    user.suspensionReason = dto.reason;
    user.suspendedUntil = dto.resumeAt;
    user.updatedAt = new Date().toISOString();

    this.logAudit('USER_SUSPEND', 'system', id, { isSuspended: false }, { isSuspended: true }, dto.reason);
    this.logger.warn(`User suspended [id=${id}, reason=${dto.reason}]`);

    return { message: 'User suspended', user: this.sanitizeUser(user) };
  }

  @Put(':id/reactivate')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Reactivate a suspended user' })
  @ApiParam({ name: 'id', type: String })
  reactivate(@Param('id') id: string, @Body() body: { reason: string }) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    user.isSuspended = false;
    user.isActive = true;
    user.suspensionReason = undefined;
    user.suspendedUntil = undefined;
    user.updatedAt = new Date().toISOString();

    this.logAudit('USER_REACTIVATE', 'system', id, { isSuspended: true }, { isSuspended: false }, body.reason);
    this.logger.log(`User reactivated [id=${id}]`);

    return this.sanitizeUser(user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @MfaRequired()
  @Audit()
  @ApiOperation({ summary: 'Soft delete user (deactivate — data retained for audit)' })
  @ApiParam({ name: 'id', type: String })
  delete(@Param('id') id: string, @Body() body: { reason: string }) {
    const user = userStore.find((u) => u.id === id);
    if (!user) throw new NotFoundException(`User ${id} not found`);

    user.isActive = false;
    user.updatedAt = new Date().toISOString();

    this.logAudit('USER_DELETE', 'system', id, { isActive: true }, { isActive: false }, body.reason);
    return { message: 'User deactivated (data retained for 10-year audit)', id };
  }

  @Get('roles/permissions')
  @Roles('ADMIN', 'AUDITOR')
  @ApiOperation({ summary: 'Get full permission matrix' })
  getPermissionMatrix() {
    return Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
      role,
      permissionCount: permissions.length,
      permissions,
    }));
  }

  @Get('roles/prohibited-combinations')
  @Roles('ADMIN', 'COMPLIANCE_OFFICER')
  @ApiOperation({ summary: 'Get prohibited role combinations (segregation of duties)' })
  getProhibitedCombinations() {
    return {
      combinations: PROHIBITED_ROLE_COMBINATIONS.map(([r1, r2]) => ({
        role1: r1, role2: r2,
        reason: 'Segregation of duties violation per BoG ICG 2019 §4.3.2',
      })),
      legalRef: 'BoG Internal Controls Guideline 2019 §4.3.2',
    };
  }

  @Get('audit/log')
  @Roles('ADMIN', 'AUDITOR', 'COMPLIANCE_OFFICER')
  @ApiOperation({ summary: 'Get user management audit log' })
  getAuditLog(@Query('userId') userId?: string) {
    const entries = userId ? auditLog.filter((e) => e.targetUserId === userId) : auditLog;
    return { data: entries, total: entries.length };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private sanitizeUser(user: StoredUser): Omit<StoredUser, 'additionalPermissions'> {
    const { additionalPermissions: _a, ...safe } = user;
    return safe;
  }

  private checkSegregationOfDuties(userId: string, newRole: SystemRole): void {
    const user = userStore.find((u) => u.id === userId);
    if (!user) return;

    for (const [r1, r2] of PROHIBITED_ROLE_COMBINATIONS) {
      if ((user.role === r1 && newRole === r2) || (user.role === r2 && newRole === r1)) {
        throw new BadRequestException(
          `Role combination ${user.role}+${newRole} violates segregation of duties (BoG ICG 2019 §4.3.2)`,
        );
      }
    }
  }

  private logAudit(
    action: string,
    actorId: string,
    targetUserId: string,
    before: Partial<StoredUser>,
    after: Partial<StoredUser>,
    reason: string,
  ): void {
    auditLog.push({
      id: `AUDIT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      actorId,
      targetUserId,
      action,
      before,
      after,
      reason,
    });
  }
}

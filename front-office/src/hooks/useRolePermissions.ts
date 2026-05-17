import { useMemo } from 'react';
import { useSession } from 'next-auth/react';

// ─── Role Definitions ─────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'ceo'
  | 'cfo'
  | 'credit_manager'
  | 'loan_officer'
  | 'branch_manager'
  | 'field_agent'
  | 'customer_service'
  | 'compliance_officer'
  | 'aml_officer'
  | 'dpo'
  | 'collections_manager'
  | 'collections_agent'
  | 'accountant'
  | 'auditor'
  | 'readonly';

export type Permission =
  // Customer Management
  | 'customer.view'
  | 'customer.create'
  | 'customer.edit'
  | 'customer.delete'
  | 'customer.view_pii'
  | 'customer.view_360'
  | 'customer.export'
  // KYC
  | 'kyc.view'
  | 'kyc.verify'
  | 'kyc.override'
  | 'kyc.edd_initiate'
  // Loans
  | 'loan.view'
  | 'loan.apply'
  | 'loan.approve'
  | 'loan.disburse'
  | 'loan.reject'
  | 'loan.restructure'
  | 'loan.write_off'
  | 'loan.waive_penalty'
  | 'loan.view_all'
  | 'loan.export'
  // Savings
  | 'savings.view'
  | 'savings.transact'
  | 'savings.withdraw'
  | 'savings.close_account'
  // Collections
  | 'collections.view'
  | 'collections.record_payment'
  | 'collections.assign_agent'
  | 'collections.escalate'
  | 'collections.schedule_call'
  | 'collections.export'
  // Reports
  | 'reports.bog'
  | 'reports.fic'
  | 'reports.dpc'
  | 'reports.par'
  | 'reports.portfolio'
  | 'reports.collections'
  | 'reports.export'
  // Compliance
  | 'compliance.alerts.view'
  | 'compliance.alerts.resolve'
  | 'compliance.alerts.escalate'
  | 'compliance.aml.view'
  | 'compliance.aml.file_str'
  | 'compliance.sanctions.screen'
  // Groups
  | 'groups.view'
  | 'groups.create'
  | 'groups.manage'
  | 'groups.dissolve'
  // Admin
  | 'admin.users.view'
  | 'admin.users.manage'
  | 'admin.settings'
  | 'admin.audit_log'
  | 'admin.data_export'
  // Field
  | 'field.sync'
  | 'field.offline_forms'
  | 'field.gps_capture';

// ─── Role → Permission Matrix ─────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'customer.view', 'customer.create', 'customer.edit', 'customer.delete',
    'customer.view_pii', 'customer.view_360', 'customer.export',
    'kyc.view', 'kyc.verify', 'kyc.override', 'kyc.edd_initiate',
    'loan.view', 'loan.apply', 'loan.approve', 'loan.disburse', 'loan.reject',
    'loan.restructure', 'loan.write_off', 'loan.waive_penalty', 'loan.view_all', 'loan.export',
    'savings.view', 'savings.transact', 'savings.withdraw', 'savings.close_account',
    'collections.view', 'collections.record_payment', 'collections.assign_agent',
    'collections.escalate', 'collections.schedule_call', 'collections.export',
    'reports.bog', 'reports.fic', 'reports.dpc', 'reports.par', 'reports.portfolio',
    'reports.collections', 'reports.export',
    'compliance.alerts.view', 'compliance.alerts.resolve', 'compliance.alerts.escalate',
    'compliance.aml.view', 'compliance.aml.file_str', 'compliance.sanctions.screen',
    'groups.view', 'groups.create', 'groups.manage', 'groups.dissolve',
    'admin.users.view', 'admin.users.manage', 'admin.settings', 'admin.audit_log',
    'admin.data_export',
    'field.sync', 'field.offline_forms', 'field.gps_capture',
  ],

  ceo: [
    'customer.view', 'customer.view_360',
    'loan.view', 'loan.view_all',
    'savings.view',
    'collections.view',
    'reports.bog', 'reports.par', 'reports.portfolio', 'reports.collections',
    'compliance.alerts.view', 'compliance.aml.view',
    'groups.view',
    'admin.users.view', 'admin.audit_log',
  ],

  cfo: [
    'customer.view',
    'loan.view', 'loan.view_all', 'loan.export',
    'savings.view',
    'collections.view', 'collections.export',
    'reports.bog', 'reports.par', 'reports.portfolio', 'reports.collections', 'reports.export',
    'compliance.alerts.view',
    'admin.audit_log',
  ],

  credit_manager: [
    'customer.view', 'customer.view_360',
    'kyc.view', 'kyc.verify',
    'loan.view', 'loan.approve', 'loan.reject', 'loan.restructure', 'loan.view_all', 'loan.export',
    'savings.view',
    'collections.view',
    'reports.par', 'reports.portfolio',
    'compliance.alerts.view',
    'groups.view', 'groups.manage',
  ],

  loan_officer: [
    'customer.view', 'customer.create', 'customer.edit', 'customer.view_pii', 'customer.view_360',
    'kyc.view', 'kyc.verify', 'kyc.edd_initiate',
    'loan.view', 'loan.apply', 'loan.approve', 'loan.disburse', 'loan.reject',
    'savings.view',
    'compliance.alerts.view',
    'groups.view', 'groups.create',
    'field.sync', 'field.offline_forms', 'field.gps_capture',
  ],

  branch_manager: [
    'customer.view', 'customer.create', 'customer.edit', 'customer.view_pii', 'customer.view_360',
    'kyc.view', 'kyc.verify',
    'loan.view', 'loan.approve', 'loan.reject', 'loan.view_all',
    'savings.view', 'savings.transact',
    'collections.view', 'collections.record_payment', 'collections.assign_agent',
    'collections.escalate', 'collections.schedule_call',
    'reports.par', 'reports.portfolio', 'reports.collections',
    'compliance.alerts.view', 'compliance.alerts.resolve',
    'groups.view', 'groups.create', 'groups.manage',
    'admin.users.view',
  ],

  field_agent: [
    'customer.view', 'customer.create', 'customer.edit', 'customer.view_pii',
    'kyc.view',
    'loan.view', 'loan.apply',
    'savings.view',
    'collections.view', 'collections.record_payment', 'collections.schedule_call',
    'groups.view',
    'field.sync', 'field.offline_forms', 'field.gps_capture',
  ],

  customer_service: [
    'customer.view', 'customer.edit', 'customer.view_pii',
    'kyc.view',
    'loan.view',
    'savings.view',
    'compliance.alerts.view',
    'groups.view',
  ],

  compliance_officer: [
    'customer.view', 'customer.view_pii', 'customer.view_360',
    'kyc.view', 'kyc.verify', 'kyc.override', 'kyc.edd_initiate',
    'loan.view', 'loan.view_all',
    'savings.view',
    'reports.bog', 'reports.fic', 'reports.dpc', 'reports.par', 'reports.portfolio', 'reports.export',
    'compliance.alerts.view', 'compliance.alerts.resolve', 'compliance.alerts.escalate',
    'compliance.aml.view', 'compliance.aml.file_str', 'compliance.sanctions.screen',
    'admin.audit_log',
  ],

  aml_officer: [
    'customer.view', 'customer.view_pii', 'customer.view_360',
    'kyc.view',
    'loan.view', 'loan.view_all',
    'reports.fic', 'reports.export',
    'compliance.alerts.view', 'compliance.alerts.resolve', 'compliance.alerts.escalate',
    'compliance.aml.view', 'compliance.aml.file_str', 'compliance.sanctions.screen',
    'admin.audit_log',
  ],

  dpo: [
    'customer.view', 'customer.view_pii', 'customer.export',
    'reports.dpc', 'reports.export',
    'compliance.alerts.view',
    'admin.audit_log', 'admin.data_export',
  ],

  collections_manager: [
    'customer.view', 'customer.view_pii',
    'loan.view', 'loan.view_all', 'loan.waive_penalty',
    'collections.view', 'collections.record_payment', 'collections.assign_agent',
    'collections.escalate', 'collections.schedule_call', 'collections.export',
    'reports.collections', 'reports.par',
    'compliance.alerts.view',
    'admin.users.view',
  ],

  collections_agent: [
    'customer.view', 'customer.view_pii',
    'loan.view',
    'collections.view', 'collections.record_payment', 'collections.schedule_call',
    'field.sync', 'field.offline_forms', 'field.gps_capture',
  ],

  accountant: [
    'customer.view',
    'loan.view', 'loan.view_all',
    'savings.view',
    'collections.view',
    'reports.bog', 'reports.par', 'reports.portfolio', 'reports.collections', 'reports.export',
    'admin.audit_log',
  ],

  auditor: [
    'customer.view',
    'loan.view', 'loan.view_all',
    'savings.view',
    'collections.view',
    'reports.bog', 'reports.fic', 'reports.par', 'reports.portfolio', 'reports.collections',
    'compliance.alerts.view', 'compliance.aml.view',
    'admin.audit_log',
  ],

  readonly: [
    'customer.view',
    'loan.view',
    'savings.view',
    'collections.view',
    'groups.view',
  ],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseRolePermissionsReturn {
  role: UserRole | null;
  permissions: Set<Permission>;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  canAll: (permissions: Permission[]) => boolean;
  isRole: (role: UserRole) => boolean;
  isAnyRole: (roles: UserRole[]) => boolean;
  isSuperAdmin: boolean;
  isComplianceStaff: boolean;
  isFieldStaff: boolean;
  isManagement: boolean;
}

export function useRolePermissions(): UseRolePermissionsReturn {
  const { data: session } = useSession();
  const role = (session?.user as { role?: UserRole })?.role ?? null;

  const permissions = useMemo((): Set<Permission> => {
    if (!role) return new Set();
    return new Set(ROLE_PERMISSIONS[role] ?? []);
  }, [role]);

  const can = useCallback(
    (permission: Permission): boolean => permissions.has(permission),
    [permissions]
  );

  const canAny = useCallback(
    (perms: Permission[]): boolean => perms.some((p) => permissions.has(p)),
    [permissions]
  );

  const canAll = useCallback(
    (perms: Permission[]): boolean => perms.every((p) => permissions.has(p)),
    [permissions]
  );

  const isRole = useCallback((r: UserRole): boolean => role === r, [role]);

  const isAnyRole = useCallback(
    (roles: UserRole[]): boolean => role !== null && roles.includes(role),
    [role]
  );

  const isSuperAdmin = role === 'super_admin';
  const isComplianceStaff = isAnyRole(['compliance_officer', 'aml_officer', 'dpo']);
  const isFieldStaff = isAnyRole(['field_agent', 'collections_agent']);
  const isManagement = isAnyRole(['super_admin', 'ceo', 'cfo', 'credit_manager', 'branch_manager']);

  return {
    role,
    permissions,
    can,
    canAny,
    canAll,
    isRole,
    isAnyRole,
    isSuperAdmin,
    isComplianceStaff,
    isFieldStaff,
    isManagement,
  };
}

// ─── Utility: Guard component ─────────────────────────────────────────────────

export function useCallback<T>(fn: T, deps: unknown[]): T {
  // This re-export ensures consumers can import useCallback from here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn, deps);
}

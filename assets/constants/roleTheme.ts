/**
 * Role-aware design tokens. Admin, manager and employee each get a distinct
 * accent so screens feel different depending on the signed-in designation.
 */
export type AppRole = 'admin' | 'manager' | 'employee';

export interface RoleTheme {
  role: AppRole;
  label: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentBorder: string;
  headerBg: string;
  headerText: string;
  headerMuted: string;
  icon: string;
  permissionSummary: string;
}

const THEMES: Record<AppRole, RoleTheme> = {
  admin: {
    role: 'admin',
    label: 'Admin',
    accent: '#00AF5B',
    accentDark: '#007A3F',
    accentSoft: '#E7F8EF',
    accentBorder: '#B9EBD0',
    headerBg: '#0C2E1F',
    headerText: '#FFFFFF',
    headerMuted: '#A7D9BE',
    icon: 'shield-crown',
    permissionSummary: 'Full control · read & write · grant access',
  },
  manager: {
    role: 'manager',
    label: 'Manager',
    accent: '#2563EB',
    accentDark: '#1D4ED8',
    accentSoft: '#E8F0FE',
    accentBorder: '#BFD3FA',
    headerBg: '#11224A',
    headerText: '#FFFFFF',
    headerMuted: '#AFC4ED',
    icon: 'account-tie',
    permissionSummary: 'Limited write access · set by admin',
  },
  employee: {
    role: 'employee',
    label: 'Employee',
    accent: '#D97706',
    accentDark: '#B45309',
    accentSoft: '#FEF3E2',
    accentBorder: '#F6D9A8',
    headerBg: '#31200C',
    headerText: '#FFFFFF',
    headerMuted: '#EFC98F',
    icon: 'account-hard-hat',
    permissionSummary: 'Read only by default · edit access by admin',
  },
};

export function getRoleTheme(
  designation?: string | null,
  isWorker?: boolean
): RoleTheme {
  if (designation === 'admin') return THEMES.admin;
  if (designation === 'manager') return THEMES.manager;
  if (isWorker || designation === 'worker') return THEMES.employee;
  return THEMES.employee;
}

export const ROLE_ORDER: AppRole[] = ['admin', 'manager', 'employee'];

import { LayoutGrid, type LucideIcon, Settings } from 'lucide-react';

export interface NavItem {
  to: '/' | '/settings';
  label: string;
  icon: LucideIcon;
}

/**
 * The sections in the navigation. Only sections whose page exists are
 * listed: a section appears with the change that builds it (accounts in F3,
 * transactions, analytics and planning as their APIs arrive).
 */
export const primaryNav: readonly NavItem[] = [{ to: '/', label: 'Overview', icon: LayoutGrid }];

export const secondaryNav: readonly NavItem[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const allNav: readonly NavItem[] = [...primaryNav, ...secondaryNav];

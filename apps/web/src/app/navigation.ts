import { ArrowLeftRight, LayoutGrid, type LucideIcon, Settings, WalletCards } from 'lucide-react';

export interface NavItem {
  to: '/' | '/accounts' | '/transactions' | '/settings';
  label: string;
  icon: LucideIcon;
}

/**
 * The sections in the navigation. Only sections whose page exists are
 * listed: a section appears with the change that builds it (analytics and
 * planning as their APIs arrive).
 */
export const primaryNav: readonly NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutGrid },
  { to: '/accounts', label: 'Accounts', icon: WalletCards },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
];

export const secondaryNav: readonly NavItem[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const allNav: readonly NavItem[] = [...primaryNav, ...secondaryNav];

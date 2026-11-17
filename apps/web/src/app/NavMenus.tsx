import { Link } from '@tanstack/react-router';
import { Menu } from 'lucide-react';
import { cn } from '../ui/cn';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../ui/Dialog';
import { Logo } from '../ui/Logo';
import { Tooltip } from '../ui/Tooltip';
import { allNav, type NavItem, primaryNav, secondaryNav } from './navigation';

/*
 * One navigation, four layouts (Handoff board, breakpoints):
 *   ≥ 1440       sidebar, 232 px, icons and labels
 *   1024–1439    rail, 64 px, icons with tooltips
 *   768–1023     top bar with a menu button that opens a drawer
 *   < 768        top bar and a bottom tab bar
 * The layouts that don't apply are display:none, so assistive technology
 * only ever meets one of them.
 */

const ICON = { strokeWidth: 1.5, 'aria-hidden': true } as const;

/** The sidebar at ≥ 1024 px, collapsing to a rail below 1440 px. */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col border-r border-border bg-surface md:flex lg:w-58">
      <div className="flex h-16 items-center justify-center px-5 lg:justify-start">
        <Logo compact className="lg:hidden" />
        <Logo className="hidden lg:inline-flex" />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col justify-between px-3 pt-2 pb-4">
        <SidebarList items={primaryNav} />
        <SidebarList items={secondaryNav} />
      </nav>
    </aside>
  );
}

function SidebarList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.to}>
          <Tooltip content={item.label} side="right" className="lg:hidden">
            <Link
              to={item.to}
              className={cn(
                'flex h-10 items-center justify-center gap-3 rounded-sm text-body font-medium lg:h-9 lg:justify-start lg:px-3',
                'text-text-secondary transition-colors duration-100 ease-instant hover:bg-subtle hover:text-text',
                'aria-[current=page]:bg-nav-selected aria-[current=page]:text-accent-text',
              )}
            >
              <item.icon {...ICON} className="size-5 shrink-0" />
              <span className="sr-only lg:not-sr-only">{item.label}</span>
            </Link>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** The top bar below 1024 px; between 768 and 1023 px it opens the menu drawer. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-2 sm:px-4 md:hidden">
      <Dialog>
        <DialogTrigger
          aria-label="Open menu"
          className={cn(
            'hidden size-10 cursor-pointer items-center justify-center rounded-sm sm:inline-flex',
            'text-text-secondary transition-colors duration-100 ease-instant hover:bg-subtle hover:text-text',
          )}
        >
          <Menu {...ICON} className="size-5" />
        </DialogTrigger>
        <DialogContent title="Menu" variant="drawer" side="left" className="sm:w-72">
          <nav aria-label="Main">
            <ul className="flex flex-col gap-1">
              {allNav.map((item) => (
                <li key={item.to}>
                  <DialogClose asChild>
                    <Link
                      to={item.to}
                      className={cn(
                        'flex h-11 items-center gap-3 rounded-sm px-3 text-body font-medium',
                        'text-text-secondary hover:bg-subtle hover:text-text',
                        'aria-[current=page]:bg-nav-selected aria-[current=page]:text-accent-text',
                      )}
                    >
                      <item.icon {...ICON} className="size-5" />
                      {item.label}
                    </Link>
                  </DialogClose>
                </li>
              ))}
            </ul>
          </nav>
        </DialogContent>
      </Dialog>
      <Link to="/" aria-label="Costly, overview" className="rounded-sm px-2 py-1">
        <Logo />
      </Link>
    </header>
  );
}

/** The bottom tab bar below 768 px, above the home indicator on phones. */
export function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="flex h-16">
        {allNav.map((item) => (
          <li key={item.to} className="flex-1">
            <Link
              to={item.to}
              className={cn(
                'flex h-full flex-col items-center justify-center gap-1 text-caption',
                'text-text-secondary aria-[current=page]:text-accent-text',
              )}
            >
              <item.icon {...ICON} className="size-6" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

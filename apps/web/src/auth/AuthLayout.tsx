import { Outlet } from '@tanstack/react-router';
import { SkipLink } from '../app/AppShell';
import { Logo } from '../ui/Logo';

/**
 * Sign-in and registration: the form on the left, the brand panel on the
 * right from 1024 px (design: Web · Sign in). The panel carries the promise
 * and the reassurance, and no figures, since there is no data to show yet.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh bg-surface text-text">
      <SkipLink />
      <div className="flex min-w-0 flex-1 flex-col px-6 py-8 sm:px-12 sm:py-10">
        <header>
          <Logo />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 items-center justify-center py-12 outline-none"
        >
          <div className="w-full max-w-[23.75rem]">
            <Outlet />
          </div>
        </main>
        <footer className="text-label text-text-secondary">
          Costly is a planning tool. It never holds or moves your money.
        </footer>
      </div>
      <aside
        aria-hidden="true"
        className="hidden flex-1 flex-col justify-between bg-brand p-14 text-on-brand md:flex"
      >
        <span className="font-mono text-body-small text-on-brand-secondary">costly. / plan</span>
        <p className="max-w-[32.5rem] text-[2.5rem] leading-[2.875rem] font-medium tracking-[-0.025em]">
          Know where your money goes. Decide where it goes next.
        </p>
        <span className="text-body-small text-on-brand-secondary">
          You enter your accounts yourself. Costly never connects to your bank.
        </span>
      </aside>
    </div>
  );
}

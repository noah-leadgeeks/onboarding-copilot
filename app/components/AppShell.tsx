'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { NovaLogo } from '@/app/components/NovaLogo';
import {
  IconBook,
  IconCalendar,
  IconFileText,
  IconMenu,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconTree,
  IconSparkles,
  IconX,
  IconLogOut,
} from '@/app/components/Icons';
import { NotificationBellTrigger } from '@/app/components/NotificationPanel';
import { SyncStatusChip } from '@/app/components/SyncStatusChip';
import { CommandPalette } from '@/app/components/CommandPalette';

import { GuideTour, allPagesTourSteps } from '@/app/components/GuideTour';
import { AgentPendingBadgeView, useAgentPendingCount } from '@/app/components/PrimaryNav';
import { GUIDE_TOUR_STORAGE_KEY, readGuideTourState, writeGuideTourState } from '@/lib/guide-tour';

interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly badge?: string;
  readonly tourId?: string;
  /** Extra routes that belong to this item (it is active on them too). */
  readonly matches?: readonly string[];
}

interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Daily Execution',
    items: [
      { label: 'Today', href: '/', icon: IconSun, tourId: 'nav-today' },
      { label: 'Schedule', href: '/schedule', icon: IconCalendar, tourId: 'nav-schedule' },
    ],
  },
  {
    title: 'Milestones & Growth',
    items: [
      { label: 'Timeline', href: '/timeline', icon: IconTree, tourId: 'nav-timeline' },
      {
        label: 'Reviews',
        href: '/reviews',
        icon: IconSparkles,
        tourId: 'nav-reviews',
        matches: ['/first-month-review', '/monthly-review-score'],
      },
    ],
  },
  {
    title: 'Reflections & Input',
    items: [
      { label: 'Diary', href: '/diary', icon: IconFileText, tourId: 'nav-diary' },
      { label: 'Feedback', href: '/feedback', icon: IconStar, tourId: 'nav-feedback' },
    ],
  },
  {
    title: 'System & Knowledge',
    items: [
      { label: 'Glossary', href: '/glossary', icon: IconBook, tourId: 'nav-glossary' },
      { label: 'Settings', href: '/settings', icon: IconSettings, tourId: 'nav-settings' },
    ],
  },
];

/** Every nav item in display order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

function routeMatches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a nav item is the current one for `pathname` (Reviews also covers its sub-pages). */
export function isNavItemActive(item: Pick<NavItem, 'href' | 'matches'>, pathname: string): boolean {
  return [item.href, ...(item.matches ?? [])].some((href) => routeMatches(pathname, href));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string; picture?: string } | null>(null);

  const isLoginPage = pathname === '/login';
  const agentPendingCount = useAgentPendingCount(!isLoginPage);

  // Check auth session
  useEffect(() => {
    if (isLoginPage) return;
    let mounted = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!mounted) return;
        if (data && typeof data === 'object') {
          const s = data as {
            authenticated: boolean;
            user: { name: string; email: string; picture?: string } | null;
          };
          if (s.authenticated && s.user) {
            setUser(s.user);
          } else if (!s.authenticated) {
            router.replace('/login');
          }
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [pathname, isLoginPage, router]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login?logout=success';
    }
  }

  // Close mobile drawer on route transition
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Check tour parameter or first-time visit
  useEffect(() => {
    if (isLoginPage) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tour') === 'start') {
      params.delete('tour');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
      setTourOpen(true);
      return;
    }
    if (params.get('tour') === 'skip' || params.get('tour') === 'false') {
      return;
    }
    const tourState = readGuideTourState(localStorage.getItem(GUIDE_TOUR_STORAGE_KEY));
    if (!tourState?.completed) setTourOpen(true);
  }, [isLoginPage]);

  // Listen for open-guide-tour event (e.g. from CommandPalette or buttons)
  useEffect(() => {
    if (isLoginPage) return;
    function handleOpenTour() {
      setTourOpen(true);
    }
    window.addEventListener('open-guide-tour', handleOpenTour);
    return () => window.removeEventListener('open-guide-tour', handleOpenTour);
  }, [isLoginPage]);

  // One global command palette (opened by the Search buttons, ⌘K or `?`).
  useEffect(() => {
    if (isLoginPage) return;
    function handleOpenPalette() {
      setPaletteOpen(true);
    }
    window.addEventListener('open-command-palette', handleOpenPalette);
    return () => window.removeEventListener('open-command-palette', handleOpenPalette);
  }, [isLoginPage]);

  function handleTourFinish() {
    localStorage.setItem(
      GUIDE_TOUR_STORAGE_KEY,
      writeGuideTourState({ completed: true, completedAt: new Date().toISOString() })
    );
    setTourOpen(false);
  }


  // Close mobile drawer on Escape key
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Find active label for mobile header
  const currentItem = NAV_ITEMS.find((item) => isNavItemActive(item, pathname)) || { label: 'Today' };
  // The daily summary is built by the Today page, so its bell only exists there.
  const showBell = pathname === '/';

  const triggerSearch = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  };

  if (isLoginPage) {
    return <main className="min-h-screen bg-[#fafaf7] text-stone-900">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-[#fafaf7] text-stone-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-stone-900 focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lift"
      >
        Skip to content
      </a>
      {/* ============================================================ */}
      {/* DESKTOP SIDEBAR (Visible on md and above)                      */}
      {/* ============================================================ */}
      <aside
        data-tour="primary-nav"
        aria-label="Primary navigation"
        className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 z-30 border-r border-stone-200/70 bg-white shadow-2xs"
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <Link href="/" className="group flex items-center gap-2.5">
            <NovaLogo className="size-6 transition-transform group-hover:scale-110" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-[0.16em] text-stone-900">
                  NOVA
                </span>
                <span className="rounded bg-mint-50 px-1.5 text-[11px] font-bold text-mint-700 uppercase tracking-wider">
                  v3
                </span>
              </div>
              <p className="text-xs font-medium text-stone-500 tracking-wide">
                Onboarding Cockpit
              </p>
            </div>
          </Link>
          {showBell && <NotificationBellTrigger />}
        </div>

        {/* Quick Search Trigger */}
        <div className="px-4 pt-4 pb-2">
          <button
            type="button"
            onClick={triggerSearch}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-stone-200/80 bg-stone-50/70 px-3 py-2 text-xs text-stone-500 hover:border-stone-300 hover:bg-white hover:text-stone-800 transition shadow-2xs active:scale-98"
            title="Search activities, topics, and guides (⌘K)"
          >
            <div className="flex items-center gap-2">
              <IconSearch className="h-3.5 w-3.5 text-stone-500" />
              <span>Quick search...</span>
            </div>
            <kbd className="rounded bg-stone-200/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-600">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <h3 className="px-3 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                {section.title}
              </h3>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isNavItemActive(item, pathname);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      data-tour={item.tourId}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                        active
                          ? 'bg-stone-900 text-white font-semibold shadow-xs'
                          : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors ${
                            active ? 'text-white' : 'text-stone-400 group-hover:text-stone-700'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </div>

                      {item.href === '/settings' && <AgentPendingBadgeView count={agentPendingCount} />}

                      {active && (
                        <span className="size-1.5 rounded-full bg-mint-400 shrink-0" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom Cockpit Status, User Profile & Tour */}
        <div className="border-t border-stone-100 p-4 bg-stone-50/50 space-y-2.5">
          {user && (
            <div className="flex items-center justify-between pb-2.5 border-b border-stone-200/60">
              <div className="flex items-center gap-2 min-w-0">
                {user.picture ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="size-7 rounded-full border border-stone-200 shrink-0"
                  />
                ) : (
                  <div className="size-7 rounded-full bg-stone-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 truncate">
                  <p className="text-xs font-semibold text-stone-800 truncate">{user.name}</p>
                  <p className="text-xs text-stone-500 truncate">{user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                title="Sign out"
                aria-label="Sign out"
                className="flex size-8 items-center justify-center text-stone-500 hover:text-stone-700 rounded-lg hover:bg-stone-200/60 transition cursor-pointer"
              >
                <IconLogOut className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <SyncStatusChip variant="full" className="min-w-0" />
            <Link
              href="/settings"
              className="shrink-0 text-xs font-semibold text-stone-500 hover:text-stone-800 transition"
            >
              Settings
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-stone-200/80 bg-white py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition shadow-2xs cursor-pointer active:scale-98"
          >
            <span>🧭 Quick Guide Tour</span>
          </button>
        </div>
      </aside>


      {/* ============================================================ */}
      {/* MOBILE STICKY TOP BAR (Visible below md)                       */}
      {/* ============================================================ */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-14 border-b border-stone-200/70 bg-[#fafaf7]/90 backdrop-blur-md px-4 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="flex min-h-11 min-w-0 items-center gap-2">
            <NovaLogo className="size-5 shrink-0" />
            <span className="text-sm font-bold tracking-[0.16em] text-stone-900">
              NOVA
            </span>
            <span aria-hidden="true" className="text-stone-300">/</span>
            <span className="truncate text-xs font-semibold text-stone-700">
              {currentItem.label}
            </span>
          </Link>
          <SyncStatusChip variant="compact" className="shrink-0" />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={triggerSearch}
            className="flex size-11 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 transition"
            aria-label="Search"
          >
            <IconSearch className="h-4 w-4" />
          </button>
          {showBell && <NotificationBellTrigger />}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex size-11 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 transition"
            aria-label="Open menu"
          >
            <IconMenu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* ============================================================ */}
      {/* MOBILE SLIDE-OVER DRAWER (Visible below md when open)          */}
      {/* ============================================================ */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation drawer"
          className="md:hidden fixed inset-0 z-50 overflow-hidden"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="fixed inset-y-0 left-0 flex max-w-full pr-10">
            <div className="w-screen max-w-xs flex flex-col bg-white shadow-lift animate-fade-in">
              {/* Drawer Header */}
              <div className="flex items-center justify-between p-4 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <NovaLogo className="size-5" />
                  <span className="text-base font-bold tracking-[0.16em] text-stone-900">
                    NOVA
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex size-11 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition"
                  aria-label="Close menu"
                >
                  <IconX className="h-5 w-5" />
                </button>
              </div>

              {/* Navigation list */}
              <nav className="flex-1 overflow-y-auto p-4 space-y-6">
                {NAV_SECTIONS.map((section) => (
                  <div key={section.title} className="space-y-1.5">
                    <h3 className="px-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                      {section.title}
                    </h3>
                    <div className="space-y-1">
                      {section.items.map((item) => {
                        const active = isNavItemActive(item, pathname);
                        const Icon = item.icon;

                        return (
                          <Link
                            key={item.label}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            aria-current={active ? 'page' : undefined}
                            className={`flex min-h-11 items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                              active
                                ? 'bg-stone-900 text-white font-semibold'
                                : 'text-stone-700 hover:bg-stone-100'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon
                                className={`h-4 w-4 ${
                                  active ? 'text-white' : 'text-stone-500'
                                }`}
                              />
                              <span>{item.label}</span>
                            </div>
                            {item.href === '/settings' && <AgentPendingBadgeView count={agentPendingCount} />}
                            {active && (
                              <span className="size-1.5 rounded-full bg-mint-400" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              {/* Drawer Footer */}
              <div className="border-t border-stone-100 p-4 bg-stone-50/60 space-y-2.5">
                {user && (
                  <div className="flex items-center justify-between pb-2.5 border-b border-stone-200/60">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.picture ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={user.picture}
                          alt={user.name}
                          className="size-7 rounded-full border border-stone-200 shrink-0"
                        />
                      ) : (
                        <div className="size-7 rounded-full bg-stone-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 truncate">
                        <p className="text-xs font-semibold text-stone-800 truncate">{user.name}</p>
                        <p className="text-xs text-stone-500 truncate">{user.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void handleLogout();
                      }}
                      title="Sign out"
                      className="min-h-11 shrink-0 text-xs font-medium text-stone-600 hover:text-stone-800 px-3 rounded-lg bg-stone-200/50 transition cursor-pointer"
                    >
                      Sign out
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <SyncStatusChip variant="full" className="min-w-0" />
                  <Link
                    href="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-11 shrink-0 items-center text-xs font-semibold text-stone-700 hover:underline"
                  >
                    Settings
                  </Link>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setTourOpen(true);
                  }}
                  className="w-full min-h-11 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200/80 bg-white py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition shadow-2xs cursor-pointer active:scale-98"
                >
                  <span>🧭 Quick Guide Tour</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MAIN CONTENT AREA                                            */}
      {/* ============================================================ */}
      <div className="flex-1 min-w-0 md:pl-64 flex flex-col min-h-screen">
        {/* Mobile top spacing buffer */}
        <div className="h-14 md:hidden" />
        <div
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full overflow-x-clip pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0 focus:outline-none"
        >
          {children}
        </div>
      </div>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectActivity={(activity) => {
          if (pathname === '/schedule') {
            window.dispatchEvent(new CustomEvent('nova:focus-activity', { detail: { id: activity.id } }));
          } else {
            router.push(`/schedule#activity-${activity.id}`);
          }
        }}
      />

      <GuideTour
        steps={allPagesTourSteps}
        open={tourOpen}
        currentRoute={pathname}
        onNavigate={(route) => router.push(route)}
        onFinish={handleTourFinish}
      />
    </div>
  );
}

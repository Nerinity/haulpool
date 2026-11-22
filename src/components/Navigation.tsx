/**
 * Top nav — minimal placeholder bar wired to the app's mechanisms:
 * nav.ts-driven links (with role/dev filtering), sign-in via <AuthOverlay>,
 * and sign-out. Restyle or rebuild it freely; keep the data-testid hooks
 * (`app-navigation`, `nav-sign-in-button`, `nav-user-name`, `nav-user-email`)
 * — the shipped tests rely on them. `nav-user-email` is the one that carries
 * an identity the test can check exactly: a display name is optional, the
 * email is the credential the session was opened with.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, useAuth, useAuthProfileReady, signOut } from 'deepspace'
import { BarChart3, ChevronDown, FlaskConical, Home, MessageCircle, UserRound, Wallet, LogOut, Menu, Package, Search, X, type LucideIcon } from 'lucide-react'
import { NotificationBell, useUnreadChats } from './haul/NotificationBell'
import { Logo } from './haul/Logo'
import type { Role } from '../constants'
import { nav } from '../nav'
import { cn } from '../lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const { userId: authUserId } = useAuth()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const profileReady = !isSignedIn || (!userLoading && !!user)
  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'

  // Close the mobile menu when navigating
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (item.devOnly && !import.meta.env.DEV) return false
    if (!item.roles) return true
    if (!profileReady) return false
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  const navLink = (item: (typeof nav)[number]) => {
    const active = location.pathname.startsWith(item.path)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'rounded-full px-3 py-1.5 text-sm font-semibold',
          active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <>
      <nav data-testid="app-navigation" className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link to="/home" aria-label="HaulPool home">
            <Logo />
          </Link>

          <div className="hidden items-center md:flex">{visibleNav.map(navLink)}</div>

          <div className="flex-1" />

          {!isLoaded ? null : isSignedIn && !profileReady ? (
            /* Signed in, profile still loading — skeleton pill, never the
               Sign in button (that would offer sign-in to a signed-in user). */
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5">
              <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
              <div className="hidden h-4 w-20 animate-pulse rounded-md bg-muted sm:block" />
            </div>
          ) : isSignedIn && user ? (
            <>
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Account menu"
                    className="group flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-card"
                  >
                    <Avatar className="h-6 w-6 ring-1 ring-inset ring-border">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[11px]">
                        {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      data-testid="nav-user-name"
                      className="hidden max-w-[140px] truncate text-foreground sm:inline"
                    >
                      {user.name || user.email}
                    </span>
                    <ChevronDown
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate font-medium text-foreground">
                    {user.name || 'Signed in'}
                  </div>
                  <div
                    data-testid="nav-user-email"
                    className="truncate text-xs font-normal text-muted-foreground"
                  >
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { window.location.assign(`/u/${authUserId}`) }}>
                  <UserRound aria-hidden />
                  My profile
                </DropdownMenuItem>
                {user.role === 'admin' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { window.location.assign('/admin/demo') }} data-testid="menu-demo">
                      <FlaskConical aria-hidden />
                      Demo data (owner)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { window.location.assign('/admin/funnel') }}>
                      <BarChart3 aria-hidden />
                      Funnel (owner)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </>
          ) : (
            <button
              data-testid="nav-sign-in-button"
              onClick={() => setShowAuthModal(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Sign in
            </button>
          )}

          <button
            className="hidden h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="flex flex-col border-t border-border px-2 py-2 md:hidden">
            {visibleNav.map(navLink)}
          </div>
        )}
      </nav>

      {/* Phone: app-style bottom tab bar */}
      {isSignedIn && visibleNav.length > 0 && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="mx-auto flex max-w-md">
            {visibleNav.map((item) => {
              const Icon = TAB_ICONS[item.path] ?? Home
              const active = location.pathname.startsWith(item.path)
              return (
                <li key={item.path} className="flex-1">
                  <Link to={item.path} aria-current={active ? 'page' : undefined}
                    className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', active ? 'text-primary' : 'text-muted-foreground')}>
                    <span className="relative">
                      <Icon className="size-5" aria-hidden />
                      {item.path === '/messages' && <ChatBadge />}
                    </span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </>
  )
}

const TAB_ICONS: Record<string, LucideIcon> = {
  '/home': Home,
  '/move': Package,
  '/search': Search,
  '/wallet': Wallet,
  '/messages': MessageCircle,
}

function ChatBadge() {
  const n = useUnreadChats()
  return n > 0 ? <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{n}</span> : null
}

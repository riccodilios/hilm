import { Link } from 'react-router-dom'
import appI18n from '@/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PRODUCT_PAGE_IDS, PUBLIC_LOCALES, PUBLIC_UI, SITE, publicPath } from '@/content/site.ts'
import { usePublicPage } from './PublicPage'

const BRAND = { en: 'Hilm', ar: 'حلم' } as const

const LANGUAGE_LABEL = { en: 'Language', ar: 'اللغة' } as const
const LANGUAGE_SHORT = { en: 'EN', ar: 'ع' } as const

/**
 * Same EN / ع toggle as the app's LanguageSwitcher, but each option links to this page's URL in
 * that language and remembers the choice for the app.
 */
export function PublicLanguageSwitch({ className }: { className?: string }) {
  const { id, locale } = usePublicPage()
  return (
    <div
      className={cn('inline-flex items-center rounded-xl border border-border bg-surface-2/60 p-1', className)}
      role="group"
      aria-label={LANGUAGE_LABEL[locale]}
    >
      {PUBLIC_LOCALES.map((lng) => (
        <Link
          key={lng}
          to={publicPath(id, lng)}
          hrefLang={lng}
          lang={lng}
          aria-label={PUBLIC_UI[lng].language}
          aria-current={lng === locale ? 'true' : undefined}
          onClick={() => void appI18n.changeLanguage(lng)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            lng === locale ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground',
          )}
        >
          {LANGUAGE_SHORT[lng]}
        </Link>
      ))}
    </div>
  )
}

export function PublicHeader({ className }: { className?: string }) {
  const { id, locale } = usePublicPage()
  const ui = PUBLIC_UI[locale]
  return (
    <header
      className={cn(
        // Equal outer columns keep the page links centred on the page, not between brand and actions.
        'relative z-10 mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5 sm:py-5 lg:grid-cols-[1fr_auto_1fr]',
        className,
      )}
    >
      <Link
        to={publicPath('home', locale)}
        className="col-start-1 row-start-1 justify-self-start text-sm font-medium tracking-tight text-foreground"
      >
        {BRAND[locale]}
      </Link>
      <nav
        aria-label={ui.primaryNav}
        // Sized to fit phone widths; wraps (never scrolls) on the very narrowest screens.
        className="col-span-2 row-start-2 flex max-w-full flex-wrap justify-center gap-0.5 justify-self-center text-xs min-[400px]:text-[13px] sm:gap-1 sm:text-sm lg:col-span-1 lg:col-start-2 lg:row-start-1"
      >
        {PRODUCT_PAGE_IDS.map((page) => (
          <Link
            key={page}
            to={publicPath(page, locale)}
            aria-current={page === id ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-2 py-1.5 transition-colors hover:text-foreground min-[400px]:px-2.5 sm:px-3',
              page === id ? 'bg-surface-2 text-foreground' : 'text-muted',
            )}
          >
            {ui.nav[page]}
          </Link>
        ))}
      </nav>
      <div className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end lg:col-start-3">
        <PublicLanguageSwitch />
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link to="/login">{ui.signIn}</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/signup">{ui.getStarted}</Link>
        </Button>
      </div>
    </header>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PublicFooter() {
  const { locale } = usePublicPage()
  const ui = PUBLIC_UI[locale]
  const linkClass = 'w-fit transition-colors hover:text-foreground'
  return (
    <footer className="border-t border-border-subtle px-5 pb-8 pt-10 sm:pt-12">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[1.5fr_1fr_1fr] sm:gap-10">
        <div className="col-span-2 sm:col-span-1">
          <Link to={publicPath('home', locale)} className="text-base font-semibold tracking-tight">
            {BRAND[locale]}
          </Link>
          <p className="mt-2 max-w-xs text-sm text-muted">{ui.footerTagline}</p>
          <div className="mt-5 flex items-center gap-3">
            <PublicLanguageSwitch />
            <a
              href={SITE.instagram.url}
              target="_blank"
              rel="me noopener noreferrer"
              aria-label={ui.instagram}
              title={ui.instagram}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-surface-2/60 text-muted transition-colors hover:text-foreground"
            >
              <InstagramIcon className="size-[18px]" />
            </a>
          </div>
        </div>
        <nav aria-label={ui.nav.features} className="flex flex-col gap-2.5 text-sm text-muted">
          {PRODUCT_PAGE_IDS.map((page) => (
            <Link key={page} to={publicPath(page, locale)} className={linkClass}>
              {ui.nav[page]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2.5 text-sm text-muted">
          <Link to={publicPath('privacy', locale)} className={linkClass}>
            {ui.privacy}
          </Link>
          <Link to="/login" className={linkClass}>
            {ui.signIn}
          </Link>
          <div className="flex flex-col">
            <span className="text-xs text-muted">{ui.contact}</span>
            <a href={`mailto:${SITE.contactEmail}`} dir="ltr" className={cn(linkClass, 'text-foreground/90')}>
              {SITE.contactEmail}
            </a>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-6 text-xs text-muted">
        <span>
          © {new Date().getFullYear()} {BRAND[locale]}. {ui.rights}
        </span>
        <a href={SITE.instagram.url} target="_blank" rel="me noopener noreferrer" dir="ltr" className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
          <InstagramIcon className="size-3.5" />
          {SITE.instagram.handle}
        </a>
      </div>
    </footer>
  )
}

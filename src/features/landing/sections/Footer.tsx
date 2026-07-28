import { Link } from 'react-router-dom'

const links = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'GitHub', href: 'https://github.com/riccodilios/hilm', external: true },
  { label: 'Documentation', href: '/app/documents' },
  { label: 'Contact', href: 'mailto:hello@hilm.app' },
]

export function LandingFooter() {
  return (
    <footer className="border-t border-border-subtle px-5 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-tight">Hilm</p>
          <p className="mt-1 text-xs text-muted">AI Personal Operating System</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          {links.map((link) =>
            link.external || link.href.startsWith('mailto:') ? (
              <a
                key={link.label}
                href={link.href}
                className="transition-colors hover:text-foreground"
                {...(link.external
                  ? { target: '_blank', rel: 'noreferrer' }
                  : {})}
              >
                {link.label}
              </a>
            ) : (
              <Link key={link.label} to={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  )
}

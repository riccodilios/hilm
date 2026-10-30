import { useEffect } from 'react'
import { PAGE_META, SITE, publicUrl, type PublicLocale, type PublicPageId } from '@/content/site.ts'
import { pageJsonLd } from '@/content/structured-data.ts'

const OG_LOCALE: Record<PublicLocale, string> = { en: 'en_US', ar: 'ar_SA' }

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector(selector) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    document.head.appendChild(el)
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
}

/**
 * Head tags for a public marketing page: the same values the build-time prerender writes into
 * the page's HTML (title, description, robots, canonical, hreflang, Open Graph, X card, JSON-LD).
 */
export function usePublicPageSeo(id: PublicPageId, locale: PublicLocale) {
  useEffect(() => {
    const meta = PAGE_META[id][locale]
    const url = publicUrl(id, locale)
    const image = `${SITE.origin}${SITE.ogImage[locale]}`

    document.title = meta.title
    upsertMeta('name', 'description', meta.description)
    upsertMeta('name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1')
    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: url })
    for (const lang of ['en', 'ar', 'x-default'] as const) {
      upsertLink(`link[rel="alternate"][hreflang="${lang}"]`, {
        rel: 'alternate',
        hreflang: lang,
        href: publicUrl(id, lang === 'x-default' ? 'en' : lang),
      })
    }

    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', SITE.name)
    upsertMeta('property', 'og:title', meta.title)
    upsertMeta('property', 'og:description', meta.description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('property', 'og:image', image)
    upsertMeta('property', 'og:image:width', String(SITE.ogImage.width))
    upsertMeta('property', 'og:image:height', String(SITE.ogImage.height))
    upsertMeta('property', 'og:image:alt', meta.title)
    upsertMeta('property', 'og:locale', OG_LOCALE[locale])
    upsertMeta('property', 'og:locale:alternate', OG_LOCALE[locale === 'en' ? 'ar' : 'en'])
    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', meta.title)
    upsertMeta('name', 'twitter:description', meta.description)
    upsertMeta('name', 'twitter:image', image)

    let script = document.getElementById('hilm-jsonld') as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.id = 'hilm-jsonld'
      document.head.appendChild(script)
    }
    script.textContent = JSON.stringify(pageJsonLd(id, locale))

    return () => {
      // The next page overwrites the shared tags; page-only tags are removed.
      document.getElementById('hilm-jsonld')?.remove()
      document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove())
    }
  }, [id, locale])
}

/** Private app routes: keep them out of search indexes (robots.txt is not access control). */
export function useNoIndex(active: boolean) {
  useEffect(() => {
    if (!active) return
    upsertMeta('name', 'robots', 'noindex, nofollow')
    document.head.querySelector('link[rel="canonical"]')?.remove()
  }, [active])
}

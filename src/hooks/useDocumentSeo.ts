import { useEffect } from 'react'
import { absoluteUrl, SEO } from '@/lib/seo'

type DocumentSeoInput = {
  title?: string
  description?: string
  path?: string
  noIndex?: boolean
  imagePath?: string
  jsonLd?: unknown | unknown[]
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

function upsertJsonLd(id: string, data: unknown) {
  let el = document.getElementById(id) as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

/** Keep document title + social meta in sync for public marketing pages. */
export function useDocumentSeo(input: DocumentSeoInput) {
  useEffect(() => {
    const title = input.title
      ? input.title.includes('Hilm')
        ? input.title
        : SEO.titleTemplate.replace('%s', input.title)
      : SEO.title
    const description = input.description || SEO.description
    const url = absoluteUrl(input.path || '/')
    const image = absoluteUrl(input.imagePath || SEO.ogImagePath)

    document.title = title
    upsertMeta('name', 'description', description)
    upsertMeta('name', 'robots', input.noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large')
    upsertLink('canonical', url)

    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', SEO.siteName)
    upsertMeta('property', 'og:title', title)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('property', 'og:image', image)
    upsertMeta('property', 'og:image:alt', SEO.ogImageAlt)
    upsertMeta('property', 'og:locale', SEO.locale)

    upsertMeta('name', 'twitter:card', 'summary_large_image')
    upsertMeta('name', 'twitter:title', title)
    upsertMeta('name', 'twitter:description', description)
    upsertMeta('name', 'twitter:image', image)

    if (input.jsonLd) {
      const payload = Array.isArray(input.jsonLd) ? input.jsonLd : [input.jsonLd]
      upsertJsonLd('hilm-jsonld-page', payload.length === 1 ? payload[0] : payload)
    }

    return () => {
      // Leave canonical/meta for next page to overwrite; remove page-specific JSON-LD.
      document.getElementById('hilm-jsonld-page')?.remove()
    }
  }, [
    input.title,
    input.description,
    input.path,
    input.noIndex,
    input.imagePath,
    input.jsonLd,
  ])
}

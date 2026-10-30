import { describe, expect, it } from 'vitest'
import {
  HOME_CONTENT,
  PAGE_META,
  PRODUCT_PAGES,
  PRODUCT_PAGE_IDS,
  PUBLIC_PAGE_IDS,
  matchPublicPath,
  publicPath,
  publicUrl,
} from './site.ts'
import { pageJsonLd } from './structured-data.ts'

describe('public site content', () => {
  it('has a real Arabic version of every English page (same structure, different text)', () => {
    for (const id of PRODUCT_PAGE_IDS) {
      const en = PRODUCT_PAGES[id].en
      const ar = PRODUCT_PAGES[id].ar
      expect(ar.sections.map((s) => [s.id, s.items?.length ?? 0, s.link ?? null])).toEqual(
        en.sections.map((s) => [s.id, s.items?.length ?? 0, s.link ?? null]),
      )
      expect(ar.faq?.length ?? 0).toBe(en.faq?.length ?? 0)
      expect(ar.related).toEqual(en.related)
      expect(ar.h1).not.toBe(en.h1)
      expect(/[\u0600-\u06FF]/.test(ar.sections[0]!.body)).toBe(true)
    }
    expect(HOME_CONTENT.ar.faq.length).toBe(HOME_CONTENT.en.faq.length)
  })

  it('gives every page a unique title and description per language', () => {
    for (const locale of ['en', 'ar'] as const) {
      const titles = PUBLIC_PAGE_IDS.map((id) => PAGE_META[id][locale].title)
      const descriptions = PUBLIC_PAGE_IDS.map((id) => PAGE_META[id][locale].description)
      expect(new Set(titles).size).toBe(titles.length)
      expect(new Set(descriptions).size).toBe(descriptions.length)
    }
  })

  it('maps paths both ways without trailing slashes', () => {
    for (const id of PUBLIC_PAGE_IDS) {
      for (const locale of ['en', 'ar'] as const) {
        const path = publicPath(id, locale)
        expect(matchPublicPath(path)).toEqual({ id, locale })
        expect(matchPublicPath(`${path}/`)).toEqual({ id, locale })
        expect(publicUrl(id, locale).startsWith('https://hilm.tech/')).toBe(true)
      }
    }
    expect(publicPath('home', 'en')).toBe('/')
    expect(publicPath('meetings', 'ar')).toBe('/ar/meetings')
    expect(matchPublicPath('/personal/tasks')).toBeNull()
    expect(matchPublicPath('/shared/meeting/abc')).toBeNull()
  })

  it('emits only verified schema.org data', () => {
    const raw = JSON.stringify(PUBLIC_PAGE_IDS.map((id) => pageJsonLd(id, 'en')))
    for (const forbidden of ['aggregateRating', 'review', 'offers', 'ratingValue', 'award']) {
      expect(raw).not.toContain(`"${forbidden}"`)
    }
    expect(raw).not.toContain('hillm.netlify.app')
  })
})

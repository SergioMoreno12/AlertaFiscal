/**
 * Interface language (English or Spanish).
 *
 * The screens render English text. When Spanish is active, `dom.ts` translates the rendered
 * text nodes and the placeholder, title and aria-label attributes with `toSpanish`, and the
 * number and date helpers switch to the es-CO locale. The choice is kept in localStorage.
 */
import { applyLanguage } from './dom'
import { toSpanish } from './translate'

export type Lang = 'en' | 'es'

const STORAGE_KEY = 'af_lang'

function readInitial(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // Storage may be blocked; fall back to the browser language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

let current: Lang = typeof window === 'undefined' ? 'en' : readInitial()

export const getLang = (): Lang => current

/** Locale for Intl number and date formatting. */
export const uiLocale = (): string => (current === 'es' ? 'es-CO' : 'en-US')

/** Translate a text produced outside the DOM (for example CSV headers). */
export const tr = (text: string): string => (current === 'es' ? toSpanish(text) : text)

export function setLang(lang: Lang): void {
  current = lang
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // The choice still applies to this visit.
  }
  document.documentElement.lang = lang
  applyLanguage(lang)
}

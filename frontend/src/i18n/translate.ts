/**
 * Pure text translation from the English source text to Spanish.
 *
 * The interface is written in English. Spanish comes from a dictionary keyed by the English
 * text (`es.ts`):
 * - exact entries ("Income and sales" → "Ingresos y ventas");
 * - templates with numbered slots ("{0} sales" → "{0} ventas"), compiled to regular
 *   expressions; the captured values are translated too when they are known texts;
 * - multi-line texts (alert descriptions) are translated line by line, and a line made of
 *   several sentences is translated sentence by sentence when it has no entry of its own.
 * Unknown text (company names, amounts, user notes) is returned unchanged.
 */
import { ES } from './es'

type Pattern = { re: RegExp; out: string; weight: number }

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const exact = new Map<string, string>()
const patterns: Pattern[] = []

for (const [rawKey, value] of Object.entries(ES)) {
  const key = normalize(rawKey)
  if (!/\{\d\}/.test(key)) {
    exact.set(key, value)
    continue
  }
  const parts = key.split(/\{(\d)\}/)
  let source = '^'
  let weight = 0
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      source += escapeRe(part)
      weight += part.length
    } else {
      source += `(?<s${part}>.*?)`
    }
  })
  patterns.push({ re: new RegExp(`${source}$`), out: value, weight })
}
// The most specific templates (more fixed text) are tried first.
patterns.sort((a, b) => b.weight - a.weight)

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=\S)/
const MAX_DEPTH = 2

function lookup(core: string, depth: number): string | null {
  const hit = exact.get(core)
  if (hit !== undefined) return hit

  for (const pattern of patterns) {
    const match = pattern.re.exec(core)
    if (!match) continue
    const groups = match.groups ?? {}
    return pattern.out.replace(/\{(\d)\}/g, (_, slot: string) => {
      const value = groups[`s${slot}`] ?? ''
      return depth < MAX_DEPTH ? lookup(value.trim(), depth + 1) ?? value : value
    })
  }

  if (depth < MAX_DEPTH && core.includes('·')) {
    // "Retail · Small · Company administrator", or a fragment such as "· version".
    const segments = core.split('·')
    let changed = false
    const translated = segments.map((segment) => {
      const text = segment.trim()
      const result = text ? lookup(text, depth + 1) : null
      if (result === null) return segment
      changed = true
      return segment.replace(text, result)
    })
    if (changed) return translated.join('·')
  }

  if (depth < MAX_DEPTH) {
    const sentences = core.split(SENTENCE_SPLIT)
    if (sentences.length > 1) {
      let changed = false
      const translated = sentences.map((sentence) => {
        const result = lookup(sentence, depth + 1)
        if (result === null) return sentence
        changed = true
        return result
      })
      if (changed) return translated.join(' ')
    }
  }
  return null
}

function translateLine(line: string): string {
  const core = normalize(line)
  if (!core || !/[A-Za-z]/.test(core)) return line
  const result = lookup(core, 0)
  if (result === null) return line
  const lead = /^\s*/.exec(line)?.[0] ?? ''
  const trail = /\s*$/.exec(line)?.[0] ?? ''
  return lead + result + trail
}

const cache = new Map<string, string>()

/** Spanish version of an English UI text, or the same text when it is unknown. */
export function toSpanish(text: string): string {
  if (!text || !/[A-Za-z]/.test(text)) return text
  const cached = cache.get(text)
  if (cached !== undefined) return cached
  const result = text.includes('\n') ? text.split('\n').map(translateLine).join('\n') : translateLine(text)
  if (cache.size > 5000) cache.clear()
  cache.set(text, result)
  return result
}

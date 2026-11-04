/**
 * Applies the interface language to the DOM that React renders.
 *
 * React keeps writing the English source text. A MutationObserver translates every text node
 * and the placeholder, title and aria-label attributes as they appear or change, and keeps the
 * English original so switching back to English restores it. Only text values are changed,
 * never the structure, so React's reconciliation is not affected: React compares against its
 * own virtual tree and rewrites a node only when its English text changes.
 *
 * Elements marked with `data-i18n-skip` (and code, pre, script, style and textarea) are left
 * untouched.
 */
import { toSpanish } from './translate'

type Lang = 'en' | 'es'
type Shown = { orig: string; shown: string }

const ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const
const SKIP_SELECTOR = '[data-i18n-skip], code, pre, script, style, textarea'

const textState = new WeakMap<Text, Shown>()
const attrState = new WeakMap<Element, Map<string, Shown>>()

let lang: Lang = 'en'
let root: HTMLElement | null = null
let observer: MutationObserver | null = null

const target = (orig: string) => (lang === 'es' ? toSpanish(orig) : orig)

function skipped(element: Element | null): boolean {
  return Boolean(element?.closest(SKIP_SELECTOR))
}

function processText(node: Text): void {
  if (skipped(node.parentElement)) return
  const current = node.nodeValue ?? ''
  let state = textState.get(node)
  // A value different from the one we wrote is a new English text written by React.
  if (!state || current !== state.shown) {
    state = { orig: current, shown: current }
    textState.set(node, state)
  }
  const wanted = target(state.orig)
  state.shown = wanted
  if (wanted !== current) node.nodeValue = wanted
}

function processAttributes(element: Element): void {
  if (skipped(element)) return
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name)
    if (current === null) continue
    let states = attrState.get(element)
    if (!states) {
      states = new Map()
      attrState.set(element, states)
    }
    let state = states.get(name)
    if (!state || current !== state.shown) {
      state = { orig: current, shown: current }
      states.set(name, state)
    }
    const wanted = target(state.orig)
    state.shown = wanted
    if (wanted !== current) element.setAttribute(name, wanted)
  }
}

function processTree(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    processText(node as Text)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const element = node as Element
  if (skipped(element)) return
  processAttributes(element)
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let next = walker.nextNode()
  while (next) {
    if (next.nodeType === Node.TEXT_NODE) processText(next as Text)
    else processAttributes(next as Element)
    next = walker.nextNode()
  }
}

/** Start translating everything rendered inside `element`. */
export function startDomTranslation(element: HTMLElement, initial: Lang): void {
  root = element
  lang = initial
  document.documentElement.lang = initial
  observer?.disconnect()
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') processText(mutation.target as Text)
      else if (mutation.type === 'attributes') processAttributes(mutation.target as Element)
      else mutation.addedNodes.forEach(processTree)
    }
  })
  observer.observe(element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  })
  processTree(element)
}

/** Re-apply the whole tree after the user switches language. */
export function applyLanguage(next: Lang): void {
  lang = next
  if (root) processTree(root)
}

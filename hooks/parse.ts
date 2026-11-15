// Finds the blocks of a file (functions, components, styles, keys) and the
// words a designer is likely to trip on. Plain pattern matching: no model.
// The explanations come from the person's own Claude, on click.

import type { Block, FileMap } from '../types'

type Lang = FileMap['lang']

export function langOf(path: string): Lang {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte'].includes(ext)) return 'js'
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css'
  if (ext === 'json') return 'json'
  if (ext === 'py') return 'python'
  if (['html', 'htm'].includes(ext)) return 'html'
  return 'other'
}

const at = (lines: string[], i: number): string => lines[i] ?? ''

// Removes strings and comments so braces inside them are not counted.
function codeOnly(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
}

function braceDelta(line: string): number {
  const c = codeOnly(line)
  let d = 0
  for (const ch of c) {
    if (ch === '{' || ch === '(' || ch === '[') d++
    else if (ch === '}' || ch === ')' || ch === ']') d--
  }
  return d
}

// From a starting line, the last line before the brackets close again.
function endOfBraced(lines: string[], start: number): number {
  let depth = 0
  let opened = false
  for (let i = start; i < lines.length; i++) {
    const d = braceDelta(at(lines, i))
    depth += d
    if (d > 0 || /[{(\[]/.test(codeOnly(at(lines, i)))) opened = true
    if (opened && depth <= 0) return i
    // A one-line declaration with no brackets, like `type A = string`.
    if (!opened && i > start) return i - 1
    if (!opened && /;\s*$/.test(at(lines, i))) return i
  }
  return lines.length - 1
}

const JS_PATTERNS: { re: RegExp; kind: (m: RegExpMatchArray) => string }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: () => 'class' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: () => 'type' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, kind: () => 'type' },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: () => 'list of options' },
  {
    re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    kind: m => (/^[A-Z]/.test((m[1] ?? '')) ? 'component' : 'function'),
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
    kind: m => (/^[A-Z]/.test((m[1] ?? '')) ? 'component' : /^use[A-Z]/.test((m[1] ?? '')) ? 'hook' : 'function'),
  },
  {
    re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:styled|css|React\.forwardRef|forwardRef|memo|React\.memo)\b/,
    kind: () => 'component',
  },
  {
    re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[{\[]/,
    kind: m => (/^[A-Z_]+$/.test((m[1] ?? '')) ? 'settings' : 'data'),
  },
]

function jsBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = at(lines, i)
    // A run of imports is one block.
    if (/^\s*import\b/.test(line)) {
      const start = i
      let end = i
      while (i < lines.length) {
        if (/^\s*import\b/.test(at(lines, i))) {
          // A multi-line import runs to the line naming where it comes from.
          while (i < lines.length - 1 && !/\bfrom\s|^\s*import\s*["'(]|;\s*$/.test(at(lines, i))) i++
          end = i
          i++
        } else if (at(lines, i).trim() === '') i++
        else break
      }
      blocks.push({ name: 'imports', kind: 'imports', start: start + 1, end: end + 1 })
      continue
    }
    // Only top-level declarations: skip anything indented.
    if (/^\S/.test(line)) {
      for (const p of JS_PATTERNS) {
        const m = line.match(p.re)
        if (m) {
          const end = endOfBraced(lines, i)
          blocks.push({ name: (m[1] ?? ''), kind: p.kind(m), start: i + 1, end: end + 1 })
          i = end
          break
        }
      }
    }
    i++
  }
  return blocks
}

function cssBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const c = codeOnly(at(lines, i))
    if (depth === 0 && /\{/.test(c)) {
      const selector = c.slice(0, c.indexOf('{')).trim() || '(rule)'
      const end = endOfBraced(lines, i)
      const kind = selector.startsWith('@media')
        ? 'screen-size rule'
        : selector.startsWith('@keyframes')
          ? 'animation'
          : selector === ':root'
            ? 'tokens'
            : 'style'
      blocks.push({ name: selector.slice(0, 40), kind, start: i + 1, end: end + 1 })
      i = end
      continue
    }
    depth += braceDelta(at(lines, i))
  }
  return blocks
}

function jsonBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const m = at(lines, i).match(/^\s*"([^"]+)"\s*:\s*(.*)$/)
    if (depth === 1 && m) {
      const opens = /^[{\[]/.test((m[2] ?? '').trim())
      const end = opens ? endOfBraced(lines, i) : i
      blocks.push({ name: (m[1] ?? ''), kind: opens ? 'group' : 'value', start: i + 1, end: end + 1 })
      if (opens) {
        i = end
        continue
      }
    }
    depth += braceDelta(at(lines, i))
  }
  return blocks
}

function pythonBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = at(lines, i).match(/^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/)
    if (!m) continue
    let end = i
    for (let j = i + 1; j < lines.length; j++) {
      if (at(lines, j).trim() === '') continue
      if (/^\S/.test(at(lines, j)) && !/^[)\]}]/.test(at(lines, j))) break
      end = j
    }
    blocks.push({ name: (m[2] ?? ''), kind: (m[1] ?? '') === 'class' ? 'class' : 'function', start: i + 1, end: end + 1 })
    i = end
  }
  return blocks
}

function htmlBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  const tags = ['head', 'header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'style', 'script']
  for (let i = 0; i < lines.length; i++) {
    const m = at(lines, i).match(/<([a-z]+)\b([^>]*)>/i)
    if (!m || !tags.includes((m[1] ?? '').toLowerCase())) continue
    const tag = (m[1] ?? '').toLowerCase()
    const id = (m[2] ?? '').match(/(?:id|class)="([^"]+)"/)
    let end = i
    for (let j = i; j < lines.length; j++) {
      if (new RegExp(`</${tag}>`, 'i').test(at(lines, j))) {
        end = j
        break
      }
    }
    blocks.push({ name: id ? `${tag} · ${(id[1] ?? '').split(' ')[0] ?? ''}` : tag, kind: 'section', start: i + 1, end: end + 1 })
    i = end
  }
  return blocks
}

// Words worth a click, per language: kept to what reads as jargon to a designer.
const TERMS: Record<Lang, { term: string; re: RegExp }[]> = {
  js: [
    { term: 'import', re: /\bimport\b/ },
    { term: 'export', re: /\bexport\b/ },
    { term: 'props', re: /\bprops\b|\(\s*\{[^}]*\}\s*[:)]/ },
    { term: 'useState', re: /\buseState\b/ },
    { term: 'useEffect', re: /\buseEffect\b/ },
    { term: 'useRef', re: /\buseRef\b/ },
    { term: 'useMemo', re: /\buseMemo\b/ },
    { term: '=>', re: /=>/ },
    { term: 'async / await', re: /\bawait\b/ },
    { term: 'Promise', re: /\bPromise\b/ },
    { term: 'class', re: /\bclass\s+[A-Z]/ },
    { term: 'extends', re: /\bextends\b/ },
    { term: 'interface', re: /\binterface\b/ },
    { term: 'type', re: /^\s*(export\s+)?type\s/m },
    { term: '.map()', re: /\.map\(/ },
    { term: '?.', re: /\?\./ },
    { term: '??', re: /\?\?/ },
    { term: '...', re: /\.\.\.[A-Za-z_$]/ },
    { term: 'null / undefined', re: /\b(null|undefined)\b/ },
    { term: 'className', re: /\bclassName\b/ },
    { term: 'key', re: /\bkey=\{/ },
    { term: 'fetch', re: /\bfetch\(/ },
    { term: 'try / catch', re: /\btry\s*\{/ },
  ],
  css: [
    { term: 'var(--…)', re: /var\(--/ },
    { term: '--custom property', re: /^\s*--[\w-]+\s*:/m },
    { term: 'display: flex', re: /display\s*:\s*(inline-)?flex/ },
    { term: 'display: grid', re: /display\s*:\s*grid/ },
    { term: '@media', re: /@media/ },
    { term: ':hover', re: /:hover/ },
    { term: '::before / ::after', re: /::?(before|after)/ },
    { term: 'rem', re: /\d(\.\d+)?rem\b/ },
    { term: 'z-index', re: /z-index/ },
    { term: 'position: absolute', re: /position\s*:\s*absolute/ },
    { term: 'transition', re: /\btransition\b/ },
    { term: '@keyframes', re: /@keyframes/ },
    { term: '!important', re: /!important/ },
    { term: 'clamp()', re: /clamp\(/ },
  ],
  json: [
    { term: '{ } object', re: /\{/ },
    { term: '[ ] array', re: /\[/ },
    { term: 'true / false', re: /\b(true|false)\b/ },
    { term: 'null', re: /\bnull\b/ },
    { term: '"$ref" / alias', re: /\$ref|\{[a-z]+\.[a-z.]+\}/i },
  ],
  python: [
    { term: 'def', re: /\bdef\b/ },
    { term: 'class', re: /\bclass\b/ },
    { term: 'self', re: /\bself\b/ },
    { term: 'import', re: /\bimport\b/ },
    { term: 'None', re: /\bNone\b/ },
    { term: '@decorator', re: /^\s*@\w/m },
    { term: 'for … in', re: /\bfor\b.+\bin\b/ },
    { term: 'dict', re: /\{[^}]*:/ },
  ],
  html: [
    { term: '<div>', re: /<div\b/ },
    { term: 'class=', re: /\bclass=/ },
    { term: 'id=', re: /\bid=/ },
    { term: 'aria-', re: /\baria-/ },
    { term: '<script>', re: /<script\b/ },
    { term: '<link>', re: /<link\b/ },
    { term: '<meta>', re: /<meta\b/ },
  ],
  other: [],
}

export function mapFile(path: string, text: string): FileMap {
  const lang = langOf(path)
  const lines = text.split('\n')
  const blocks =
    lang === 'js'
      ? jsBlocks(lines)
      : lang === 'css'
        ? cssBlocks(lines)
        : lang === 'json'
          ? jsonBlocks(lines)
          : lang === 'python'
            ? pythonBlocks(lines)
            : lang === 'html'
              ? htmlBlocks(lines)
              : []
  const terms = TERMS[lang].filter(t => t.re.test(text)).map(t => t.term).slice(0, 10)
  return { path, lang, lines: lines.length, blocks: blocks.slice(0, 60), terms }
}

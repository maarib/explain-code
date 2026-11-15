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
// Each is found where it appears in a line, so the code view can make it a link.
const TERMS: Record<Lang, { term: string; re: RegExp }[]> = {
  js: [
    { term: 'import', re: /\bimport\b/g },
    { term: 'export', re: /\bexport\b/g },
    { term: 'props', re: /\bprops\b|\w+Props\b/g },
    { term: 'useState', re: /\buseState\b/g },
    { term: 'useEffect', re: /\buseEffect\b/g },
    { term: 'useRef', re: /\buseRef\b/g },
    { term: 'useMemo', re: /\buseMemo\b/g },
    { term: '=>', re: /=>/g },
    { term: 'async / await', re: /\b(async|await)\b/g },
    { term: 'Promise', re: /\bPromise\b/g },
    { term: 'class', re: /\bclass\b(?=\s+[A-Z])/g },
    { term: 'extends', re: /\bextends\b/g },
    { term: 'interface', re: /\binterface\b/g },
    { term: 'type', re: /\btype\b(?=\s+[A-Z])/g },
    { term: '.map()', re: /\.map\b/g },
    { term: '?.', re: /\?\./g },
    { term: '??', re: /\?\?/g },
    { term: '...', re: /\.\.\.(?=[A-Za-z_$])/g },
    { term: 'null / undefined', re: /\b(null|undefined)\b/g },
    { term: 'className', re: /\bclassName\b/g },
    { term: 'key', re: /\bkey(?==)/g },
    { term: 'aria-', re: /\baria-[\w-]+/g },
    { term: 'fetch', re: /\bfetch\b/g },
    { term: 'try / catch', re: /\b(try|catch)\b/g },
    { term: '&&', re: /&&/g },
    { term: '? :', re: /\s\?\s/g },
  ],
  css: [
    { term: 'var(--…)', re: /var\(--[\w-]+\)/g },
    { term: '--custom property', re: /--[\w-]+(?=\s*:)/g },
    { term: 'display: flex', re: /display\s*:\s*(inline-)?flex\b/g },
    { term: 'display: grid', re: /display\s*:\s*grid\b/g },
    { term: '@media', re: /@media/g },
    { term: ':hover', re: /:hover\b/g },
    { term: ':disabled', re: /:disabled\b/g },
    { term: '::before / ::after', re: /::?(before|after)\b/g },
    { term: 'rem', re: /\d(\.\d+)?rem\b/g },
    { term: 'z-index', re: /z-index/g },
    { term: 'position', re: /position\s*:\s*(absolute|relative|fixed|sticky)/g },
    { term: 'transition', re: /\btransition\b/g },
    { term: 'transform', re: /\btransform\b/g },
    { term: '@keyframes', re: /@keyframes/g },
    { term: '!important', re: /!important/g },
    { term: 'calc()', re: /calc\(/g },
    { term: 'clamp()', re: /clamp\(/g },
  ],
  json: [
    { term: 'true / false', re: /\b(true|false)\b/g },
    { term: 'null', re: /\bnull\b/g },
    { term: '"$ref" / alias', re: /"\$ref"|\{[a-z]+\.[a-z.]+\}/gi },
  ],
  python: [
    { term: 'def', re: /\bdef\b/g },
    { term: 'class', re: /\bclass\b/g },
    { term: 'self', re: /\bself\b/g },
    { term: 'import', re: /\bimport\b/g },
    { term: 'None', re: /\bNone\b/g },
    { term: '@decorator', re: /^\s*@\w+/g },
    { term: 'return', re: /\breturn\b/g },
  ],
  html: [
    { term: '<div>', re: /<\/?div\b/g },
    { term: 'class=', re: /\bclass=/g },
    { term: 'id=', re: /\bid=/g },
    { term: 'aria-', re: /\baria-[\w-]+/g },
    { term: '<script>', re: /<\/?script\b/g },
    { term: '<link>', re: /<link\b/g },
    { term: '<meta>', re: /<meta\b/g },
  ],
  other: [],
}

// The terms used in some lines of a file, each with the first line using it.
export function termsIn(lines: string[], firstLine: number, lang: Lang): { term: string; line: number }[] {
  const found: { term: string; line: number }[] = []
  for (const t of TERMS[lang]) {
    const re = new RegExp(t.re.source, t.re.flags.replace('g', ''))
    const at = lines.findIndex(l => re.test(l))
    if (at >= 0) found.push({ term: t.term, line: firstLine + at })
  }
  return found.sort((a, b) => a.line - b.line)
}

// Files longer than this show their first lines only, to keep the panel quick.
export const MAX_LINES = 500

export function mapFile(path: string, text: string): FileMap {
  const lang = langOf(path)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
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
  const terms = TERMS[lang]
    .filter(t => new RegExp(t.re.source, t.re.flags.replace('g', '')).test(text))
    .map(t => t.term)
  return {
    path,
    lang,
    lines: lines.length,
    code: lines.slice(0, MAX_LINES),
    blocks: blocks.filter(b => b.start <= MAX_LINES).slice(0, 80),
    terms,
  }
}

// A reply cut into its prose and its fenced code blocks, in order.
export type ReplyPart = { prose: string } | { code: string; lang: string }

export function splitFences(text: string): ReplyPart[] {
  const parts: ReplyPart[] = []
  const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n\1\2[ \t]*$/gm
  let pos = 0
  for (const m of text.matchAll(fence)) {
    const at = m.index ?? 0
    if (at > pos) parts.push({ prose: text.slice(pos, at) })
    parts.push({ code: m[4] ?? '', lang: (m[3] ?? '').toLowerCase() })
    pos = at + m[0].length
  }
  if (pos < text.length) parts.push({ prose: text.slice(pos) })
  return parts.filter(p => !('prose' in p) || p.prose.trim() !== '')
}

// A file name for a fence's language, so the parser and the code view know it.
export function pathForFence(lang: string): string {
  const ext: Record<string, string> = {
    typescript: 'ts', ts: 'ts', tsx: 'tsx', javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'js',
    css: 'css', scss: 'scss', less: 'less', json: 'json', jsonc: 'json',
    python: 'py', py: 'py', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte',
  }
  return `snippet.${ext[lang] ?? (lang || 'txt')}`
}

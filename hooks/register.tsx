import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Block, FileMap } from '../types'
import { mapFile, pathForFence, splitFences, termsIn } from './parse'

const PANE = 'explain-code'
const TITLE = 'Explain This Code'
// A see-through grey that reads on light and dark backgrounds alike.
const TINT = '#8080801f'

// Change the tag when FileMap's fields change: values stored by an earlier
// version are then read as empty instead of in the wrong shape.
const files = atom({ plugin: 'explain-code', key: 'files' } as const, [], { shape: 'files-2' })
const selected = atom({ plugin: 'explain-code', key: 'selected' } as const, null)

// How Claude should answer the questions the panel sends. The explanation
// itself comes from the person's own Claude, which knows why it wrote the code.
const STYLE = {
  id: 'explain-code:style',
  scope: 'session',
  text: [
    '# Explain This Code panel',
    'The person is a designer learning to read the code you write. Their "Explain This Code" panel lists each file you write as blocks and terms; clicking one sends you a question such as "Explain the function `x` (lines 3–20 of a.ts) for a designer".',
    'When you answer those questions:',
    '- Use plain language. Define any technical word you cannot avoid.',
    '- Open with one sentence on what it does for the person using the product.',
    '- Use a design analogy only where it honestly fits: a class or React component is a component; props are component properties; `extends` or inheritance is overriding a main component; CSS custom properties and JSON tokens are design tokens or variables; state is like interactive states (hover, pressed, open); conditionals are variants or boolean properties; `.map()` or loops are a repeated list of instances; imports are using a library; a function is an action that runs when something happens.',
    '- Say why you wrote it this way when you know.',
    '- Keep it short: whole file 3 to 5 sentences, block 2 to 4, term 1 to 2. Quote at most a line or two of code.',
    '- These are questions only: do not edit files while answering them.',
  ].join('\n'),
} as const

// Maps a file and makes it the one the panel shows.
async function remember($: EngineInterface, path: string) {
  let text: string
  try {
    const got = await $.fs.read(path)
    if (typeof got !== 'string') return
    text = got
  } catch {
    return // gone, or over 4 MiB
  }
  const map = mapFile(path, text)
  await update($, files, list => [...list.filter(f => f.path !== path), map].slice(-10))
  await update($, selected, () => path)
  void $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  let cwd = ''

  const rel = (path: string) =>
    cwd && path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'explain',
      description: 'Open the Explain This Code panel, or map a file into it: /explain path/to/file',
    })
    // After an update that changed how files are stored, map the last file
    // shown again, so the panel does not come back empty.
    const [list, last] = [await read($, files), await read($, selected)]
    if (list.length === 0 && typeof last === 'string') await remember($, last)
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'explain' }, async ($, e) => {
    const path = e.args.trim()
    if (path) {
      await remember($, path.startsWith('/') ? path : `${cwd}/${path}`)
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: path ? `Mapped ${path} in the Explain This Code panel.` : 'Explain This Code panel opened.' }
  })

  // Every file Claude writes or edits lands in the panel.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await remember($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e)) // never in the way of the edit itself
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await remember($, e.file_path)
    return ran
  }).catch(($, e, next) => next(e)) // never in the way of the edit itself

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections.filter(s => s.id !== STYLE.id), STYLE] }
  })

  // Code blocks in Claude's replies: the block's border lights up as the
  // pointer passes over it, and each function or component inside it is tinted.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.isSummary || !/(^|\n)[ \t]*(```|~~~)/.test(e.props.text)) return next(e)
    const parts = splitFences(e.props.text)
    if (!parts.some(p => 'code' in p)) return next(e)
    const { Box, Markdown, Code } = $.ui.resolve(e)

    const fence = (code: string, lang: string, i: number) => {
      const path = pathForFence(lang)
      const map = mapFile(path, code)
      const card = { borderStyle: 'round', borderDimColor: true, paddingX: 1, hover: { borderColor: 'claude', borderDimColor: false } } as const
      if (map.blocks.length === 0 || map.lines > map.code.length) {
        return (
          <Box key={`fence:${i}`} flexDirection="column" {...card}>
            <Code source={code} path={path} />
          </Box>
        )
      }
      const pieces = []
      let n = 1
      for (const b of map.blocks) {
        if (b.start < n) continue
        if (b.start > n) pieces.push(<Code source={map.code.slice(n - 1, b.start - 1).join('\n')} path={path} />)
        pieces.push(
          <Box key={`fence:${i}:${b.start}`} hover={{ backgroundColor: TINT }}>
            <Code source={map.code.slice(b.start - 1, b.end).join('\n')} path={path} />
          </Box>,
        )
        n = b.end + 1
      }
      if (n <= map.code.length) pieces.push(<Code source={map.code.slice(n - 1).join('\n')} path={path} />)
      return (
        <Box key={`fence:${i}`} flexDirection="column" {...card}>
          {pieces}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        {parts.map((p, i) => ('prose' in p ? <Markdown text={p.prose.trim()} /> : fence(p.code, p.lang, i)))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code, Select } = $.ui.resolve(e)
    const list = await read($, files)
    const chosen = await read($, selected)
    const file = list.find(f => f.path === chosen) ?? list[list.length - 1]

    const ask = (text: string) => () => {
      $.prompt.submit({ text, asUser: true }).catch(() => $.ui.toast('Could not send the question to Claude.'))
    }

    const brand = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="claude" bold>
          ✻ Explain
        </Text>
        <Text dimColor size="caption">
          code, for designers
        </Text>
      </Box>
    )

    if (!file || !Array.isArray(file.code)) {
      return (
        <Box flexDirection="column">
          {brand}
          <Box marginTop={1} flexDirection="column">
            <Text>No file yet.</Text>
            <Text dimColor>When Claude writes or edits a file, it shows up here, split into blocks.</Text>
            <Text dimColor>Or open one yourself: /explain path/to/file</Text>
          </Box>
        </Box>
      )
    }

    const name = rel(file.path)
    const base = name.split('/').pop() ?? name
    const dir = name.includes('/') ? name.slice(0, name.length - base.length - 1) : ''
    const slice = (a: number, b: number) => file.code.slice(a - 1, Math.min(b, file.code.length))

    const blockQuestion = (b: Block) =>
      b.kind === 'imports'
        ? `Explain the imports at the top of ${name} (lines ${b.start}–${b.end}) for a designer: what each one brings in and why this file needs it.`
        : `Explain the ${b.kind} \`${b.name}\` (lines ${b.start}–${b.end} of ${name}) for a designer: what it does and why you wrote it this way.`

    const termQuestion = (term: string, n: number) => {
      const code = (file.code[n - 1] ?? '').trim().slice(0, 100)
      return `In ${name}, line ${n} (\`${code}\`): what does \`${term}\` mean here? Explain it for a designer in one or two sentences.`
    }

    // A block: its name to click, the code in the app's own code view, its terms.
    const card = (b: Block) => {
      const lines = slice(b.start, b.end)
      const terms = termsIn(lines, b.start, file.lang)
      return (
        <Box
          key={`card:${b.start}`}
          flexDirection="column"
          marginTop={1}
          paddingX={1}
          borderStyle="round"
          borderDimColor
          hover={{ borderColor: 'claude', borderDimColor: false }}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Button key={`block:${b.start}`} plain onPress={ask(blockQuestion(b))}>
              <Text color="claude" bold>
                {b.kind === 'imports' ? 'Imports' : b.name}
              </Text>
            </Button>
            <Text dimColor size="caption">
              {b.kind === 'imports' ? '' : `${b.kind} · `}
              {b.start === b.end ? `line ${b.start}` : `${b.start}–${b.end}`}
            </Text>
          </Box>
          <Code source={lines.join('\n')} path={file.path} startLine={b.start} />
          {terms.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              <Text dimColor size="caption">
                Terms
              </Text>
              {terms.map(t => (
                <Button key={`term:${b.start}:${t.term}`} plain onPress={ask(termQuestion(t.term, t.line))}>
                  <Text color="claude" underline size="caption">
                    {t.term}
                  </Text>
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    // Lines between blocks: shown plainly, unless they are only blank.
    const loose = (a: number, b: number) => {
      const lines = slice(a, b)
      if (lines.every(l => l.trim() === '')) return null
      return (
        <Box key={`loose:${a}`} marginTop={1} paddingX={1}>
          <Code source={lines.join('\n')} path={file.path} startLine={a} />
        </Box>
      )
    }

    const parts = []
    let n = 1
    for (const b of [...file.blocks].sort((x, y) => x.start - y.start)) {
      if (b.start < n) continue
      if (b.start > n) parts.push(loose(n, b.start - 1))
      parts.push(card(b))
      n = Math.min(b.end, file.code.length) + 1
    }
    if (n <= file.code.length) parts.push(loose(n, file.code.length))

    return (
      <Box flexDirection="column">
        {brand}

        {list.length > 1 && (
          <Box marginTop={1}>
            <Select
              key="file"
              label="File"
              value={file.path}
              options={[...list].reverse().map(f => ({ value: f.path, label: rel(f.path) }))}
              onSelect={value => update($, selected, () => value)}
            />
          </Box>
        )}

        <Box marginTop={1} flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="column">
            <Text bold>{base}</Text>
            <Text dimColor size="caption">
              {dir ? `${dir} · ` : ''}
              {file.lines} lines
            </Text>
          </Box>
          <Button
            key="whole-file"
            variant="primary"
            onPress={ask(
              `Explain ${name} for a designer: what the whole file does, what part of the product it is, and how it connects to the other files.`,
            )}
          >
            Explain file
          </Button>
        </Box>
        <Text dimColor size="caption">
          Click a block's name or a term to ask Claude.
        </Text>

        {parts}

        {file.lines > file.code.length && (
          <Box marginTop={1}>
            <Text dimColor size="caption">
              {file.lines - file.code.length} more lines not shown. Use Explain file for the whole thing.
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}

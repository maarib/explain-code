import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Block, FileMap } from '../types'
import { mapFile } from './parse'

const PANE = 'explain-code'
const TITLE = 'Explain This Code'

// Change the tag when FileMap's fields change: values stored by an earlier
// version are then read as empty instead of in the wrong shape.
const files = atom({ plugin: 'explain-code', key: 'files' } as const, [], { shape: 'files-1' })
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
  await update($, files, list => [...list.filter(f => f.path !== path), map].slice(-20))
  await update($, selected, () => path)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const chosen = await read($, selected)
    const file = list.find(f => f.path === chosen) ?? list[list.length - 1]

    const ask = (text: string) => () => {
      $.prompt.submit({ text, asUser: true }).catch(() => $.ui.toast('Could not send the question to Claude.'))
    }

    if (!file) {
      return (
        <Box flexDirection="column">
          <Text>No file yet.</Text>
          <Text dimColor>When Claude writes or edits a file, it shows up here as blocks and terms.</Text>
          <Text dimColor>Click any of them to ask Claude what it does.</Text>
          <Text dimColor>Or map a file yourself: /explain path/to/file</Text>
        </Box>
      )
    }

    const name = rel(file.path)
    const blockQuestion = (b: Block) =>
      b.kind === 'imports'
        ? `Explain the imports at the top of ${name} (lines ${b.start}–${b.end}) for a designer: what each one brings in and why this file needs it.`
        : `Explain the ${b.kind} \`${b.name}\` (lines ${b.start}–${b.end} of ${name}) for a designer: what it does and why you wrote it this way.`

    return (
      <Box flexDirection="column">
        {list.length > 1 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text dimColor>RECENT FILES</Text>
            {[...list].reverse().map(f => (
              <Button
                key={`file:${f.path}`}
                plain
                onPress={() => update($, selected, () => f.path)}
              >
                {f.path === file.path ? '● ' : '○ '}
                {rel(f.path)}
              </Button>
            ))}
          </Box>
        )}

        <Text dimColor>FILE · click to ask Claude</Text>
        <Button
          key="whole-file"
          plain
          onPress={ask(
            `Explain ${name} for a designer: what the whole file does, what part of the product it is, and how it connects to the other files.`,
          )}
        >
          {name} <Text dimColor>{file.lines} lines</Text>
        </Button>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>BLOCKS</Text>
          {file.blocks.length === 0 && (
            <Text dimColor>No blocks found in this kind of file. Ask about the whole file above.</Text>
          )}
          {file.blocks.map(b => (
            <Button key={`block:${b.start}`} plain onPress={ask(blockQuestion(b))}>
              {b.name} <Text dimColor>{b.kind} · {b.start === b.end ? `line ${b.start}` : `${b.start}–${b.end}`}</Text>
            </Button>
          ))}
        </Box>

        {file.terms.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>TERMS</Text>
            {file.terms.map(t => (
              <Button
                key={`term:${t}`}
                plain
                onPress={ask(
                  `In ${name}, what does \`${t}\` mean? Explain it for a designer in one or two sentences, and point to where this file uses it.`,
                )}
              >
                {t}
              </Button>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

import { expect, test } from 'claude-code/testing'

import { mapFile, termsIn } from './parse'

const FORM = `import { useState } from 'react'
import {
  Button,
  Input,
} from './ui'

type FormProps = { onSave: (name: string) => void }

export function Form({ onSave }: FormProps) {
  const [name, setName] = useState('')
  return <Input value={name} onChange={setName} />
}

const handleSubmit = async (name: string) => {
  await fetch('/api', { method: 'POST', body: name })
}
`

const PANE = {
  plugin: 'explain-code',
  component: 'Pane',
  requestId: 'explain-code',
  props: {
    title: 'Explain This Code',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the parser finds the blocks and terms of a TSX file', () => {
  const map = mapFile('/p/src/Form.tsx', FORM)
  expect(map.blocks.map(b => `${b.name}:${b.kind}:${b.start}-${b.end}`)).toEqual([
    'imports:imports:1-5',
    'FormProps:type:7-7',
    'Form:component:9-12',
    'handleSubmit:function:14-16',
  ])
  expect(map.terms).toContain('useState')
  expect(map.terms).toContain('async / await')
})

test('each block lists its terms with the first line using them', () => {
  const lines = FORM.split('\n').slice(8, 12)
  expect(termsIn(lines, 9, 'js')).toEqual([
    { term: 'export', line: 9 },
    { term: 'props', line: 9 },
    { term: 'useState', line: 10 },
  ])
})

test('the parser reads CSS and JSON', () => {
  const css = mapFile('a.css', ':root {\n  --brand: #f00;\n}\n\n.button:hover {\n  color: var(--brand);\n}\n')
  expect(css.blocks.map(b => `${b.name}:${b.kind}`)).toEqual([':root:tokens', '.button:hover:style'])
  const json = mapFile('t.json', '{\n  "color": {\n    "brand": "#f00"\n  },\n  "name": "x"\n}\n')
  expect(json.blocks.map(b => `${b.name}:${b.kind}:${b.start}-${b.end}`)).toEqual(['color:group:2-4', 'name:value:5-5'])
})

test('a file Claude writes shows in the panel, and a click asks Claude', async ($, on) => {
  const asked: string[] = []
  on('command.register', () => ({ value: { command: 'explain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('fs.read', () => ({ value: FORM }))
  on('prompt.submit', (_, e) => {
    asked.push(e.text)
    return { text: e.text }
  })

  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/p/src/Form.tsx', content: FORM })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'whole-file' }))?.text).toBe('Explain file')
    expect(await ui.find({ type: 'Text', text: /^Form\.tsx$/ })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    expect((await ui.find({ key: 'block:14' }))?.text).toBe('handleSubmit')
    expect((await ui.find({ key: 'term:9:useState' }))?.text).toBe('useState')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'block:14' })
  await ui.press({ key: 'term:9:useState' })
  await ui.unmount()

  expect(asked[0]).toContain('`handleSubmit` (lines 14–16 of src/Form.tsx)')
  expect(asked[1]).toContain("line 10 (`const [name, setName] = useState('')`): what does `useState` mean here?")
})

test('the style note joins the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'core', text: 'core', scope: 'shared' }] }))
  const out = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(out.sections.map(s => s.id)).toEqual(['core', 'explain-code:style'])
})

const REPLY = (text: string, surface: 'desktop' | 'terminal' = 'desktop') =>
  ({ plugin: 'explain-code', component: 'AssistantMessage', requestId: 'm1', surface, props: { text, isFirstOfReply: true } }) as const

test('a code block in a reply gets a hover card, its functions a hover tint', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const text = 'Here is the form:\n\n```tsx\n' + FORM.trimEnd() + '\n```\n\nThat is all.'
  const ui = await $.ui.mount(REPLY(text))
  expect(await ui.find({ key: 'fence:1' })).toBeDefined()
  expect(await ui.find({ key: 'fence:1:9' })).toBeDefined() // the Form component
  expect(await ui.find({ key: 'fence:1:14' })).toBeDefined() // handleSubmit
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  await ui.unmount()
})

test('replies without code, and the terminal, keep the app drawing', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const reply of [REPLY('No code here.'), REPLY('```ts\nconst a = 1\n```', 'terminal')]) {
    const ui = await $.ui.mount(reply)
    expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
    await ui.unmount()
  }
})

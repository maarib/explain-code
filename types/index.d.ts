// One block of a file: a function, component, style rule, JSON key…
export type Block = { name: string; kind: string; start: number; end: number }

// The map of one file Claude wrote or edited.
export type FileMap = {
  path: string
  lang: 'js' | 'css' | 'json' | 'python' | 'html' | 'other'
  lines: number
  blocks: Block[]
  terms: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'explain-code': {
      files: Shaped<FileMap[]>
      selected: string | null
    }
  }
}

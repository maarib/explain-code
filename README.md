# Explain This Code

A Claude Code mod for designers who want to understand the code Claude writes.

It adds a side panel, **Explain This Code**, that shows every file Claude writes or edits, split into cards drawn with Claude Code's own code view, at three zoom levels:

1. **File**: the **Explain file** button asks what the whole file does
2. **Blocks**: each import group, component, function, type, style rule or JSON key is a card with its code and line numbers. Click its name to ask about it.
3. **Terms**: under each block, the words and symbols a designer is likely to trip on (`useState`, `=>`, `var(--…)`, `@media`…). Click one to ask what it means on that line.

Each click sends the question to **your own Claude**, which knows why it wrote the code, for example:

> Explain the function `handleSubmit` (lines 14–16 of src/Form.tsx) for a designer: what it does and why you wrote it this way.

The mod also gives Claude a short style note for these answers: plain language, design analogies where they honestly fit (class = component, inheritance = overrides, JSON = token file), short answers, and no file edits.

The mod uses no model or API key of its own. Finding blocks is plain pattern matching, done on your machine.

## Install

At the prompt of a terminal session:

```
/plugin install explain-code --marketplace maarib/explain-code
```

Answer `y` to add the marketplace, then pick a scope (user scope is the first option).

From a shell:

```bash
claude plugin install explain-code --marketplace maarib/explain-code
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `maarib/explain-code`, then **Add plugin**.

## Use

- The panel opens at the start of each session. To open it yourself, type `/explain`.
- When Claude writes or edits a file, the file appears in the panel. Switch between the last 10 files with the dropdown at the top.
- Files over 500 lines show their first 500 lines.
- `/explain path/to/file` maps any file, not just ones Claude wrote.

## Try it

The `examples/` folder has a small product card to explore: a React component (`ProductCard.tsx`) and its design tokens and styles (`tokens.css`). Copy them into your project, or point the panel at them directly:

```
/explain examples/ProductCard.tsx
```

## What it understands

Block-finding works for JavaScript and TypeScript (including React), CSS, SCSS and Less, JSON, Python, and the main HTML sections. For other files you can still ask about the whole file. Only top-level blocks are listed, so methods inside a class don't get their own rows yet.

## License

MIT

# paseo-todo

Opencode-style todo cards for [pi](https://pi.dev): a `todowrite` tool plus a persistent todo card pinned below the editor.

[Paseo](https://github.com/getpaseo/paseo) builds its todo UX on top of opencode: the agent calls a single `todowrite` tool that always passes the full list, and the UI renders it as a live task card in the composer. This extension brings the same UX to pi.

## Features

- **`todowrite` tool** speaking opencode's todo protocol — `{ todos: [{ content, status, priority, activeForm? }] }`. Models trained on opencode's tool usage call it naturally, and the full list is passed on every call (no per-item patch calls).
- **Persistent todo card** pinned below the editor, always visible while tasks exist.
- **Compact pill** — `ctrl+shift+t` toggles between the full card and a one-line pill (`2/5 tasks`). A fully settled list (all completed or cancelled) auto-collapses to the pill.
- **Session persistence** — the list is stored in the session as a custom entry, so `/resume`, `/reload` and forks restore it.
- **`/todo` command** to print the current list without touching the model.

## Install

```sh
pi install npm:paseo-todo
```

Or run it for a single invocation:

```sh
pi -e npm:paseo-todo
```

Restart pi (or run `/reload`) after installing.

> Note: this package registers a tool named `todowrite`. Do not install it alongside another todo extension that claims the same tool name.

## Usage

Ask the agent to plan or track multi-step work; the tool description and prompt guidelines nudge it to call `todowrite`. Statuses:

| Status | Meaning | Rendering |
|---|---|---|
| `pending` | not started | `○` muted |
| `in_progress` | currently working on it | `●` accent, shows `activeForm` |
| `completed` | done | `✓` struck through |
| `cancelled` | dropped | `○` dim |

Example tool call payload:

```json
{
  "todos": [
    { "content": "Read the extension API", "status": "completed" },
    { "content": "Wire the widget", "status": "in_progress", "activeForm": "Wiring the widget", "priority": "high" },
    { "content": "Write the README", "status": "pending" }
  ]
}
```

Keyboard: `ctrl+shift+t` toggles the card. `/todo` prints the current list.

## How it works

- The widget is rendered with `ctx.ui.setWidget(id, lines, { placement: "belowEditor" })`, so it stays below the editor and does not consume transcript space.
- Each update appends a `paseo-todo` custom entry to the session; on `session_start` the last such entry is replayed from `ctx.sessionManager.getBranch()`.
- Todo payloads are normalized defensively: `in_progress` / `inProgress`, `cancelled` / `canceled` are both accepted, unknown statuses fall back to `pending`, and JSON-string payloads are parsed.

## Files

| File | Purpose |
|---|---|
| `index.ts` | extension entry: tool, widget, shortcut, `/todo` command |
| `state.ts` | todo types, normalization, summaries |

## Development

The extension is plain TypeScript with no build step; pi loads `.ts` directly. Host packages (`@earendil-works/pi-*`, `typebox`) are provided by pi at runtime and declared only as `peerDependencies`.

To test a local checkout:

```sh
pi -e /absolute/path/to/paseo-todo
```

## License

MIT

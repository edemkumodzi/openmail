# OpenMail

The open-source TUI email client with integrated calendar.

Built with the same architectural patterns as [OpenCode](https://github.com/anomalyco/opencode): local HTTP server, SolidJS terminal UI, SQLite cache, provider plugin system.

## Features

- Keyboard-driven navigation (vim-style j/k/enter/esc)
- Three-panel layout: sidebar, thread list, calendar
- Folder and label filtering
- Thread conversation view with per-message navigation
- Full-text search with result navigation
- Compose overlay with field tabbing
- Settings with live theme switching (4 built-in themes)
- Responsive layout that adapts to terminal width

## Quick Start

Requires [Bun](https://bun.sh) v1.3+.

```bash
bun install
bun dev
```

## Keybinds

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up/down |
| `enter` | Open thread / select item |
| `tab` | Switch focus between sidebar and threads |
| `q` / `esc` | Go back / close / clear filter |
| `/` | Search threads |
| `c` | Compose new email |
| `,` | Settings |
| `ctrl+b` | Toggle calendar sidebar |
| `ctrl+c` | Quit |

### Thread View

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate between messages |
| `r` | Reply |
| `R` | Reply all |
| `f` | Forward |
| `a` | Archive |
| `d` | Trash |

## Architecture

```
packages/openmail/
  src/
    index.tsx              Entry point
    mail/
      types.ts             Data models (threads, messages, folders, labels, events)
      mock.ts              Mock data for development
    cli/cmd/tui/
      app.tsx              Root component — state, keybinds, layout
      theme.ts             Reactive theme system (OpenCode-compatible JSON themes)
      settings.ts          Persistent settings (~/.openmail/settings.json)
      component/           UI components (sidebar, thread-list, thread-view, etc.)
      theme/               Built-in theme files (opencode, catppuccin, gruvbox, tokyonight)
  test/                    Test suite (bun:test)
```

## Tech Stack

- **Runtime**: Bun
- **Terminal UI**: OpenTUI + SolidJS
- **Server** (planned): Hono + Bun.serve
- **Database** (planned): SQLite via Drizzle ORM
- **Email** (planned): Gmail API provider, IMAP fallback

## Development

```bash
# Run the TUI
bun dev

# Run tests
bun test --cwd packages/openmail

# Typecheck
bun run typecheck
```

## Status

Currently in the TUI-first development phase with mock data. The server, database, and email provider integration are designed in [PLAN.md](./PLAN.md) but not yet implemented.

## License

MIT

# lucid

lucid redraws the Claude Code transcript: replies, your prompts and tool rows. It uses warm greys with one orange accent, keeps every text colour at WCAG AA contrast, and folds tool calls into short rows that say what happened. Text you select with the mouse pastes as clean prose, and code pastes exactly as written.

## Install

```
/plugin marketplace add vvojciech/claude-kit
/plugin install lucid@vvojciech
```

## Features

### Theme and palette

- Follows `/theme` and redraws when you change it.
- A theme name containing "light" or "dark" picks the ground, ANSI themes included. Any other theme reads the terminal background from `COLORFGBG`, and falls back to dark.
- Every colour is a fixed hex value, so ANSI themes get the same palette as the rest.
- Warm grey text in four strengths, one orange accent, and separate colours for running, done, failed, added and removed.
- Text colours meet 4.5:1 on the ground and on the prompt panel. Rules, bars and the accent meet 3:1.
- Daltonized themes swap green for blue, so added and removed lines stay apart.

### Markdown

- Headings: h1 is bold and underlined with a faint rule under it, h2 bold and underlined, h3 bold and muted. Level 1 and 2 headings get a wider gap above them.
- Lists keep their markdown markers. Ordered lists keep their numbers and delimiter. Tasks show `- [ ]` and `- [x]`, and done items are greyed.
- Tables keep their grid when they fit. Numeric columns align right, and text columns shrink before numbers do. When the columns can't fit, each row stacks as `header: value` lines.
- Code blocks show the language as a muted label with no fences. Keywords are bold, comments muted italic. Diffs colour added and removed lines, and shell blocks colour commands, flags and strings.
- A code line wider than the terminal soft-wraps, with a faint `↪` beside each continuation row.
- Inline code sits on a chip. Inline shell commands are coloured, and file paths are picked out with their `:line` suffix.
- Quotes get one bar per nesting level and quieter text. GitHub alerts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) get a label.
- Footnote references read `[1]`, and footnote bodies hang past their label.
- `http`, `https`, `mailto` and `file` links become terminal hyperlinks. Other schemes keep just the label, and relative links show the target as a path.
- Leading YAML front matter shows as a `yaml` block. Thematic breaks draw as a short faint rule.
- HTML: `b`, `i`, `u`, `ins`, `del`, `code`, `kbd`, `a`, `q`, `sup`, `sub` and `br` render. `<pre>` becomes a code block, `<details>` and `<summary>` become a `▸` line, images show as `[image: alt]`, and comments are hidden. Other block tags flow as plain text.
- Named and numeric HTML entities are decoded.
- Very large or deeply nested replies stay within the engine's limits. Past them the rest of the reply draws as plain text.

### Tool rows

- One row per call: a state glyph, a verb and the target, such as `Ran`, `Read`, `Edited`, `Wrote`, `Searched`, `Fetched`, `Watched` or `Loaded skill`.
- Verbs are past tense once a call is done. A call waiting at the permission dialog reads `Wants to run`, `Wants to write` and so on.
- States: pending `◌`, running `◐`, started `○`, done `●`, failed `✗`, and `⊘` for not allowed, stopped or cancelled.
- Paths show relative to the session directory, home as `~`, link to the file, and cut in the middle so the file name stays.
- A settled group gets a headline in kinds and counts, like `Read 2 files, ran 1 command`, with one line per target under it. Failed or refused calls are named in their own state.
- Background shells, monitors and agents read as running until their task ends, and as started when this process never saw the end. Task notifications draw as rows with how long the task ran.
- MCP tools read `Called server › tool`, with the server name humanised.
- Agent calls read `Delegated to <type>`.
- A new file shows its line count and the first 10 lines. An error shows its reason in the error colour and up to 10 lines.
- Running and expanded rows go to the stock renderer, so elapsed time, progress and ctrl+o output stay.

### Prompt panel

- Your prompt sits on a panel with an accent bar on the left, as wide as the terminal.
- Pasted blocks collapse to `[pasted N lines]`. A prompt that is only a paste also shows its first line.

### While a reply streams

- Settled blocks are cached and reused, so each token only re-parses the block still being written.
- Inline markers show as written until they close. See [Streaming](#streaming) below.

### Mouse selection

- Prose sits flush left with no reply bullet, so it pastes like stock.
- Headings carry no `#` marker and are followed by a blank line, so they paste as their own paragraph.
- List and task markers are the markdown they came from.
- Code sits in the same column as prose with no bar or gutter in the way, and long lines are left whole for the terminal to wrap. A selection pastes the exact source.
- The inline code chip is a background colour, so it never ends up in the paste.

For the markdown source, use ditto.

### API for other mods

lucid adds `$.lucid` to the engine:

- `blocks({ text, requestId })` returns the block outline of a reply as lucid parses it: kind, source, depth, start and end offsets in the original text, and the language and body of code blocks. Pass the `requestId` of a reply that is still streaming to get the streaming parse.
- `tone()` returns the ground (`dark` or `light`), whether the theme is daltonized, and a frozen copy of the palette as `#rrggbb` values. It is `undefined` until lucid has drawn once.

Types live in `types/index.d.ts`.

### Layout

- Replies use the full terminal width with no left gutter.
- The prompt panel spans the whole row.
- Widths are measured in terminal cells, so emoji and wide characters count as two.

## Rows left to stock

- The grouped Agent launch row (`N background agents launched`, `N agents finished`). Core draws it outside `ToolUse` and `ToolGroup`, and it is not a `RenderComponent`, so no `ui.render` hook reaches it. Each Agent call drawn on its own row is lucid's.
- Live and expanded rows (`isRunning`, `isActive`, `isExpanded`), so elapsed time, progress and ctrl+o output stay.
- Groups that went well and hold more than calls (`isCallsOnly` false).

## Stopped or denied

A call cut with "User rejected" reads "Stopped" when lucid saw it run: its batch was allowed at the permission check, or a progress pill was drawn for it. PostToolUseFailure would tell an interrupt apart, but another plugin can answer it first, so lucid does not rely on it. It reads "Not allowed" only when it was refused: a deny verdict, a PermissionDenied from the auto-mode classifier, or a "Permission … denied" result. Anything else, a queued call that never started or an ask that ended at Esc, reads "Cancelled", since a dialog "No" and a stop of an ask-approved call look the same. All three marks live in session state, so a reload keeps them.

The tool hooks only watch. When a reload unloads lucid while a call is still running, its session state reads and writes fail; lucid drops the mark it was writing and hands the call's answer and verdict back as they came, so the host prints no rejection.

## Task notifications

A notification row takes the task's own status: done, failed or stopped. An agent that stopped with background work of its own still running sends `completed` with an interim summary ("is waiting on its own background work"). lucid draws that row as started, not done, and does not record the agent as ended; the agent's later notification does.

## Streaming

Inline markdown streams the way stock does. An opener such as `*`, `_`, `**`, `~~`, a backtick, `[`, `<` or `&` shows exactly as written until its closer arrives, and then the span restyles. Nothing inline is hidden or drawn ahead of time, so the text never lags the reply, and a raw marker on screen for a few tokens is expected. References follow the same rule: `[label][ref]` and `[^1]` show as written until their definition has arrived, so `params[:user][:name]` or `a[0][1]` never lose a bracket.

Block syntax is the exception. The last line can be held back while it could still change what kind of block it is: an unfinished fence info line, a table delimiter row, a setext underline, a bare list or quote marker, a `[label]` that may become a definition, and a partial `</pre>`. A pipe row that could be a table header is held until the line under it shows whether it is a delimiter row: once that line starts with `|-` the row draws as a table, and any other line releases it as plain text. At most the last two lines are held, and everything above them is drawn exactly as the finished reply draws it.

A finished reply never goes through any of this.

Inline HTML is a tag only when every bare attribute is a real HTML boolean such as `open` or `disabled`. So `i<a and j>0 ... </a>` and `a<b and c>d ... </b>` stay prose even with a matching closer later in the paragraph, while `<details open>` still works.

## Known limits

- A bare URL long enough to wrap is clickable on its first row only. lucid hands the link to the engine as one element and the engine wraps it, opening the hyperlink on the first row and not on the rows after. Stock re-opens it on every row; a mod can't ask for that.
- Every streamed token re-parses the block that is still being written, so the cost grows with that block's size. Blocks that are already finished are cached. At normal sizes this takes a few milliseconds per token; a single block near 100KB costs 50 to 125ms per token.

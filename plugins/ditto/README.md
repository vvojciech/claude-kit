# ditto

Claude Code renders Claude's markdown in the terminal, so a mouse selection gives you the rendered text: no fences, no `**`, tables redrawn as boxes, link targets gone. ditto copies the raw text instead. Hover a reply or a tool row and click a chip, or type `/ditto`.

## Install

```
/plugin marketplace add vvojciech/claude-mods
/plugin install ditto@vvojciech-mods
```

ditto must load before (outside) any other mod that draws replies, such as lucid. If a mod loaded earlier draws replies first, ditto never sees them. It notices after the first settled reply and leaves a status line saying to list ditto first in `CLAUDE_CODE_PLUGIN_DIRS`. Every `/ditto` answer repeats the warning until it's fixed.

## Features

### Reply chips

- A muted ⧉ sits on its own row under the end of each finished reply, at the right edge.
- Hover it to show the chips. Click one to copy.
- `⧉ reply` copies the whole reply as markdown, including text written before and after tool calls.
- Each code block gets a chip named by its language, such as `⧉ python`. A block with no language is `⧉ code`, a table is `⧉ table`.
- Repeated names are numbered from the top of the reply: `⧉ bash 1`, `⧉ bash 2`.
- A block whose language clashes with a command word (`table`, `code`, `reply`, `file`, `plan`, `output`, `selection`, `help`) is renamed, for example `⧉ table-code`.
- Code blocks copy without their fences. Tables copy as markdown rows.
- Blocks inside quotes, lists and alerts, and indented code, get chips too.
- A reply that was interrupted shows `partial` beside its chips.
- A reply still being written gets its marker when it ends.
- On a resumed session, when two replies end with the same block, the marker offers that block and a note naming `/ditto N` for each whole reply.

### Tool chips

- A settled tool row gets a chip beside its first line, after a gap, so it never covers the row text.
- `⧉ file` on Write, Edit and Read. Write copies what was written. Edit copies the whole file after the edit (every match under `replace_all`). Read copies the text read; images give nothing.
- `⧉ plan` on ExitPlanMode copies the plan.
- `⧉ output` on Bash, Grep, Glob, WebFetch, Agent and MCP tools copies the output with colour codes stripped. Bash gives stdout then stderr, Grep gives matches or file names.
- A folded group of calls gets one chip per call, named by file or tool: `⧉ a.md`, `⧉ bash #1`, `⧉ bash #2`. Repeated names are numbered from the top of the group. A group with one copyable call shows `⧉ output` or `⧉ file`, like a single row.
- A background Agent row gets `⧉ output` once its report arrives, including a report delivered through a handback.
- No chip is drawn while a call runs, when it failed or was interrupted, on an expanded live group, or when there is nothing to copy.

### Commands

`/ditto help` prints the full usage. N counts back from the last, 1 is the last.

| Command | Copies |
| --- | --- |
| `/ditto` | the last reply as markdown |
| `/ditto R` | reply R back, so `/ditto 2` is the reply before the last |
| `/ditto <name>` | one block by its chip name, such as `/ditto ruby 2`, or `/ditto 2 ruby` for an older reply |
| `/ditto code` | the block with no language, or any code block when every block has one |
| `/ditto table` | a table |
| `/ditto file [N]` | the Nth last file Claude wrote, edited or read |
| `/ditto plan` | the last plan |
| `/ditto output [N]` | the Nth last Bash, Grep, Glob, WebFetch, Agent or MCP output |
| `/ditto <call>` | a call by its group chip name, such as `/ditto notes.md`, `/ditto bash` or `/ditto bash #2` |
| `/ditto selection` | the markdown behind what you last selected with the mouse |

- Names are case-insensitive.
- A chip named by digits, such as `⧉ 123`, needs R first: `/ditto 1 123`.
- `/ditto bash 2` is the second bash block in the reply. `/ditto bash #2` is the second bash call in the latest group that has one.
- A group whose names don't fit shows them in a toast, for example "Copy with /ditto <name>: bash #1, a.md, bash #2". Typing one of those names copies that call.
- `/ditto selection` widens a partial selection to balanced inline markup and maps rendered lines back to their source. When the selected text appears in more than one place, it copies nothing and asks you to select more.

### Clipboard

- macOS uses `pbcopy`.
- Linux tries `wl-copy` on Wayland, then `xclip`, then `xsel` on X11.
- Otherwise, and always over SSH, ditto copies through the terminal with OSC 52. Over SSH it never runs a clipboard tool, so the remote machine's clipboard is never mistaken for yours.
- A chip copy confirms in place with `copied (pbcopy)` or `copy failed`. An OSC 52 copy also toasts, because the terminal never reports back: "paste to check". Above 100,000 characters it warns that terminals often cut copies that large.
- `/ditto` answers name what was copied, its line count and the route, such as "Copied python block (4 lines, pbcopy)".
- A failed copy says why, including which Linux tool to install.
- A partial reply copies as such and says "(partial)".

### Narrow panes and the stock renderer

- Chips that don't fit fold into `+N`. Click it for a toast naming the hidden chips and the `/ditto` commands for them.
- When a tool row has no room for the chips, it keeps a lone ⧉. On a single call it copies that call; on a group it names the calls and the commands for them.
- On a tool row, a copy turns ⧉ into ✓ or ✗ in place, so a narrow row still confirms.
- ditto works without another renderer mod. A tool row drawn by the stock renderer can't be measured, so it gets the lone ⧉ at any width.
- Toasts wrap to the pane, folding names that don't fit into `+N`.

### Themes

- When lucid is loaded, ditto takes the tone lucid last drew with, so the marker and chips match it.
- Without lucid, it picks light or dark from the theme name, or from the terminal's `COLORFGBG` under `auto`, and falls back to dark.
- The marker is muted, chips use the text colour, and a hovered chip is bold, underlined and orange, at 4.5:1 contrast or better.

## Known limits

- The ⧉ markers need fullscreen, where clicks can land. Outside it ditto says so once and `/ditto` still works.
- The engine inverts a button under the pointer, and `hover: { inverse: false }` doesn't cancel it. ditto swaps its hover colours to compensate, so a hovered chip sits on ditto's own ground colour (`#141311` dark, `#f5f4f0` light). On a terminal with a different background, a one-row box shows behind the hovered chip.
- A row drawn by the engine can't be measured, so it never gets the chip strip, only ⧉.
- A background agent report that reached the session only as a message ditto can't read gives no chip, and `/ditto output` says so.
- OSC 52 can't confirm a copy. Paste to check.

## Development

Run from the mod directory.

- `dev/check.sh` validates the plugin, runs `claude plugin test`, then checks for drift against a lucid checkout beside ditto. Set `LUCID_DIR` if lucid lives elsewhere. Run it before handing work over.
- `dev/check-clipboard.sh` drives Claude Code in tmux against the real pasteboard: hovers and clicks chips, runs `/ditto` commands, resumes, selects, and checks what lands on the clipboard. It takes a lock so runs never share the clipboard, and restores your clipboard when it ends.

See `dev/README.md` for the rest.

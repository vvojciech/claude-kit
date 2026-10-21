# claude-mods

Claude Code mods I use every day. Needs Claude Code 2.1.287 or later.

```
/plugin marketplace add vvojciech/claude-mods
/plugin install lucid@vvojciech-mods
/plugin install ditto@vvojciech-mods
```

## lucid

A quieter transcript. Warm greys, a single orange accent, and contrast that stays readable on both dark and light terminals. It follows `/theme`, including the ANSI themes. Tool calls collapse into short past-tense rows, like `Ran 2 commands, read 1 file`, and failures and background work get their own marks.

When you select text with the mouse, prose pastes as prose and code pastes exactly as written. If you want the markdown source instead, use ditto.

## ditto

Claude Code renders markdown, so a mouse selection gives you the rendered text, not what Claude wrote. ditto adds a dim `⧉` at the end of each reply and on each tool row. Hover it and pick what to copy: the whole reply as markdown, a single code block without its fences, a table as GFM, a file Claude read or wrote, a plan, or a tool's output. `/ditto help` lists the same thing as commands for the keyboard.

It works with lucid or with the stock renderer. List it first in `CLAUDE_CODE_PLUGIN_DIRS`, or install it first, so it wraps whichever renderer draws the reply.

# claude-kit

Claude Code plugins I use every day. So far they are mods that change the interface, which need Claude Code 2.1.287 or later. Skills and other plugins will live here too.

```
/plugin marketplace add vvojciech/claude-kit
/plugin install lucid@vvojciech
/plugin install ditto@vvojciech
/plugin install mermaid@vvojciech
```

## lucid

A quieter transcript. Warm greys, a single orange accent, and contrast that stays readable on both dark and light terminals. It follows `/theme`, including the ANSI themes. Tool calls collapse into short past-tense rows, like `Ran 2 commands, read 1 file`, and failures and background work get their own marks.

When you select text with the mouse, prose pastes as prose and code pastes exactly as written. If you want the markdown source instead, use ditto.

## ditto

Claude Code renders markdown, so a mouse selection gives you the rendered text, not what Claude wrote. ditto adds a dim `⧉` at the end of each reply and on each tool row. Hover it and pick what to copy: the whole reply as markdown, a single code block without its fences, a table as GFM, a file Claude read or wrote, a plan, or a tool's output. `/ditto help` lists the same thing as commands for the keyboard.

It works with lucid or with the stock renderer. List it first in `CLAUDE_CODE_PLUGIN_DIRS`, or install it first, so it wraps whichever renderer draws the reply.

## mermaid

Claude often answers with a mermaid diagram, and the terminal shows it as a code block you have to picture in your head. mermaid draws each `sequenceDiagram` block in place of its fence: participants, arrows, activations, notes, loop/alt frames, boxes, create and destroy. Long labels wrap inside the diagram. Only when the pane is too narrow to fit every participant does it become a numbered one-line-per-message list.

Anything mermaid itself would reject stays as source, with the problems listed under it. Other diagram types aren't drawn yet.

List it after ditto and before lucid in `CLAUDE_CODE_PLUGIN_DIRS`. lucid draws the reply itself, so a mod listed after it never sees the text.

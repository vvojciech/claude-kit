# claude-mods

Claude Code mods I use every day.

```
/plugin marketplace add vvojciech/claude-mods
/plugin install ditto@vvojciech-mods
```

## ditto

Claude Code renders markdown, so selecting a reply with the mouse gives you rendered text, not the markdown behind it. ditto puts a dim `⧉` under each reply. Hover it for chips that copy the reply's raw markdown, a single code block without its fences, or a table as GFM. `/ditto` does the same from the keyboard.

Load it before any other renderer mod so it can wrap that mod's output.

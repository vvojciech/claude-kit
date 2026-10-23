# claude-kit

Claude Code plugins I use every day. So far they are mods that change the interface, and they need Claude Code 2.1.287 or later. Skills and other plugins will live here too.

```
/plugin marketplace add vvojciech/claude-kit
/plugin install lucid@vvojciech
/plugin install copy-that@vvojciech
/plugin install mermaid@vvojciech
/plugin install peek@vvojciech
```

Each one works on its own. To run them together, load copy-that first and mermaid before lucid. The pages below say why.

## [lucid](plugins/lucid/README.md)

[![lucid](docs/screens/lucid.png)](plugins/lucid/README.md)

A quieter transcript in warm greys with one orange accent, where tool calls fold into short rows like `Read 2 files, searched for 1 pattern`.

## [copy-that](plugins/copy-that/README.md)

[![copy-that](docs/screens/copy-that.png)](plugins/copy-that/README.md)

Copies the raw markdown, code blocks, tables, files, plans and tool output behind a reply from a ⧉ menu or `/copy-that`.

## [mermaid](plugins/mermaid/README.md)

[![mermaid](docs/screens/mermaid.png)](plugins/mermaid/README.md)

Draws mermaid sequence diagrams in the terminal in place of their code fence.

## [peek](plugins/peek/README.md)

[![peek](docs/screens/peek.png)](plugins/peek/README.md)

Shows a thumbnail under each image in the transcript, with `⤢ open` for Preview and `/peek` to put an image on the clipboard.

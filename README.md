# claude-kit

Mods for Claude Code, Anthropic's coding agent in the terminal. A mod is a plugin that redraws part of the Claude Code screen. lucid, copy-that and mermaid need Claude Code 2.1.287 or later. peek needs 2.1.305 or later in iTerm2.

```
/plugin marketplace add vvojciech/claude-kit
/plugin install copy-that@vvojciech
/plugin install peek@vvojciech
/plugin install mermaid@vvojciech
/plugin install lucid@vvojciech
```

Install only the ones you want. A mod works as soon as its install finishes.

## Load order

Each mod works on its own. To run several together, load them in the order above: copy-that, peek, mermaid, lucid. lucid draws replies, prompts and tool rows itself and doesn't pass them on, so a mod loaded after it never sees those rows.

There is no documented way to order plugins installed with `/plugin install`. To fix the order, clone this repo, uninstall the marketplace copies, and list the plugin folders in `CLAUDE_CODE_PLUGIN_DIRS`, for example in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-kit/plugins/copy-that:~/claude-kit/plugins/peek:~/claude-kit/plugins/mermaid:~/claude-kit/plugins/lucid"
  }
}
```

copy-that warns you when it loads in the wrong place. The others don't.

Every screen below is a mock drawn with lucid loaded.

## [copy-that](plugins/copy-that/README.md)

[![copy-that](docs/screens/copy-that.png)](plugins/copy-that/README.md)

A mouse selection copies the rendered text, not the markdown. copy-that copies the raw markdown, code blocks, tables, files, plans and tool output behind a reply from a ⧉ menu or `/copy-that`.

## [peek](plugins/peek/README.md)

[![peek](docs/screens/peek.png)](plugins/peek/README.md)

Shows a thumbnail under each image in the transcript, with `⤢ open` for Preview and `/peek` to put an image on the clipboard. macOS only, in iTerm2, kitty or Ghostty, in fullscreen.

## [mermaid](plugins/mermaid/README.md)

[![mermaid](docs/screens/mermaid.png)](plugins/mermaid/README.md)

Draws mermaid sequence diagrams in the terminal in place of their code fence.

## [lucid](plugins/lucid/README.md)

[![lucid](docs/screens/lucid.png)](plugins/lucid/README.md)

Replaces the default transcript look with warm greys and one orange accent, and folds runs of tool calls into short rows like `Read 2 files, searched for 1 pattern`.

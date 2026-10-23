# mermaid

Claude often answers with a mermaid diagram, and the terminal shows it as a code block you have to picture in your head. mermaid draws each `sequenceDiagram` block as text in place of its fence, between the prose around it. Anything it can't draw stays as source, with a short note saying why.

![A reply about sign-in with a sequence diagram drawn in place: four participants, numbered messages, an activation bar, an alt/else frame, a note and a loop](../../docs/screens/mermaid.png)

## Install

```
/plugin marketplace add vvojciech/claude-kit
/plugin install mermaid@vvojciech
```

## Requirements

- Claude Code 2.1.287 or later.
- Load order: list it after copy-that and before lucid in `CLAUDE_CODE_PLUGIN_DIRS`. lucid draws the reply itself, so a mod listed after it never sees the text.

## Features

### Syntax

- `sequenceDiagram` only, in a closed ```` ```mermaid ```` or `~~~mermaid` fence. Fences inside lists and blockquotes are found too.
- `participant` and `actor`, with `as` aliases, quoted names and `@{ type, alias }` metadata in JSON or YAML form.
- Participant types `queue`, `database`, `entity`, `boundary`, `control` and `collections`, each marked by a glyph before the name.
- `create` and `destroy`.
- `box` groups with a label. Any colour on the box line is dropped.
- Every message arrow: `->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`, `<<->>`, `<<-->>`, and the v11 half arrows, reversed ones included.
- `activate`, `deactivate`, and the `+` and `-` shorthand on arrows.
- `Note left of`, `right of` and `over` one or two participants.
- `loop`, `alt`/`else`, `opt`, `par`/`and`, `par_over`, `critical`/`option`, `break` and `rect`.
- `autonumber` with a start, a step, and `off`.
- `title`, and a title in YAML front matter.
- `;` between statements, `%%` comments, `<br/>` line breaks, and `#35;` or `#quot;` style entities.
- Keywords in any case. `wrap:` and `nowrap:` prefixes, `accTitle` and `accDescr` are read and left out of the drawing.

### Drawing

- Participants sit in boxes of equal height above centred lifelines. Actors get a `☺` mark.
- Arrow heads: `▶` filled, `▷` async, `×` cross, `⇀` half, none for open. Dashed messages draw dashed.
- A label sits on its arrow when it fits on one line, otherwise it wraps above the arrow.
- Self messages draw on one row when the label is short, or as a loop with the label beside it.
- Activation bars thicken the lifeline, and nested activations are offset.
- `loop`, `alt` and the other blocks are framed around the lanes they use, with the condition in brackets on the top edge. Nested frames are inset. `rect` is shaded instead of framed.
- Notes sit on a tinted background in italics. The tint is darker on a dark theme.
- Box groups get a label row above their participants and a rail down each side.
- Autonumbers are dimmed and sit beside their label.
- A created participant starts at its `create` row, and a destroyed one ends in a box.

### Width

- Every row fits the terminal width.
- Spare columns go to the gaps whose labels save the most rows with them.
- Labels wrap at word breaks first, then at `/`, `,`, `→`, `(`, `_` and `::` inside identifiers. Participant names may also fold at a CamelCase hump, up to four lines.
- When a name or label still can't fit, it is cut and the full text goes in a numbered footnote under the diagram. A note with no room leaves a marker and moves to the footnotes.
- Wide characters and emoji count as two cells.
- If not every participant fits with its name whole, or more than a quarter of the messages would end up in footnotes, the diagram becomes a list with one line per message: `Customer → Shop  submit order`, `⇢` for dashed and `↺` for self messages, frames as `┌ ├ └` and notes behind `┆`.

### Fallbacks

- A fence still streaming is left to the next renderer, so a half-written diagram never flashes.
- Other diagram types stay as source with `mermaid: flowchart not drawn yet, sequenceDiagram only` under them.
- An empty fence says there is no diagram type.
- A diagram mermaid.live would reject (unknown lines, an unclosed block, an extra `end`, a `deactivate` while inactive) stays as source with each problem and its line number listed under it.
- Problems mermaid.live accepts, such as `links` lines or a `()` central connection, are listed under the drawn diagram.
- One bad diagram doesn't stop the others in the same reply from drawing. If drawing throws, the reply falls back to source with the reason.

## Commands

None. Diagrams draw as soon as a reply with a closed `mermaid` fence settles.

## Known limits

- Only sequence diagrams are drawn.
- `link`, `links`, `properties` and `details` lines are not shown.
- Central connections `()` are reported, not drawn.
- Box and `rect` colours are dropped. `rect` uses one fixed shade.
- The note tint picks light only when the theme name contains "light", and it is read once per session, so a `/theme` change shows after a reload.
- A diagram inside a list splits it: the list restarts after the diagram.
- Summaries and surfaces other than the terminal are left alone.

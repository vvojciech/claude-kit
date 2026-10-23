# peek

Claude Code shows an image as a line of text: `[Image #1]`, `Read image (412KB)`, or the alt text of a markdown link. peek draws a small thumbnail of the picture under that row, with a `⤢ open` button that opens the original in Preview. `/peek` gets an image onto the clipboard so ctrl+v attaches it.

![Thumbnails under a pasted image, a Read row and a Bash row, each with its name, pixel size and a ⤢ open button, and a band above the prompt showing a dragged-in path with ⧉ clip](../../docs/screens/peek.png)

## Install

```
/plugin marketplace add vvojciech/claude-kit
/plugin install peek@vvojciech
```

## Requirements

- Claude Code 2.1.305 or later. Older versions draw only the alt text.
- iTerm2 3.5 or later, kitty or Ghostty.
- Not inside tmux or screen. Claude Code can't pass pictures through them yet.
- Fullscreen rendering (`/tui fullscreen`).
- macOS, for `sips`, `open` and the clipboard.

Where pictures can't draw, peek shows one quiet line per image instead, `▣ shot.png  ⤢ open`, and the button still works.

## Features

### Thumbnails

- Images pasted into a prompt, under the prompt row. peek reads them from Claude Code's per-session image cache.
- Images Claude reads, writes or edits (`.png .jpg .jpeg .gif .webp .heic`), under the tool row, or under a folded group of rows once it settles.
- Image files a Bash command names, such as `sips ... --out chart.png`, if the file exists afterwards.
- Local `![alt](path)` images in Claude's replies, absolute, `~/` or relative to the working directory. Web URLs are skipped: fetching whatever a reply links to would let a reply make your machine call out.
- Each thumbnail keeps the image's aspect ratio, is at most 8 rows tall and 48 columns wide, and shows the file name and pixel size beside it.
- Up to 4 thumbnails per row.

Non-PNG files, and PNGs over 512 KiB, are converted with `/usr/bin/sips` to an 800 px PNG in `/tmp/claude-<uid>/peek`, stepping down to 512 and 256 px if the result is still over 2 MiB. Conversions are cached by path and modification time.

peek wraps the rows other mods draw rather than replacing them, so it works with lucid and copy-that, and copy-that's `⧉` chips keep working.

### With lucid

lucid draws a reply's local images where they sit in the text, through the API below. peek then leaves those images out of the thumbnails it adds under the reply, so none shows twice. It tells them apart by the picture key: any `Image` in the reply already drawn under the key `$.peek.picture` handed out counts as drawn. Images lucid leaves as placeholders, such as one inside a list, still show under the reply. Without lucid, every reply image shows under the reply as before.

### API for other mods

peek adds `$.peek` to the engine:

- `picture({ path, cwd, columns, isFullscreen, requestId })` returns `{ source: { png }, columns, rows, alt, path, name, caption, open, key }` for a local image, or `{ fallback: 'pictures-off' }` when pictures can't draw and `{ fallback: 'unresolved' }` when the file is missing or not an image. `path` may be absolute, `~/`, `file://` or relative to `cwd` (the session's directory by default). It uses the same conversion, 2 MiB downscale, cache and capability check as the thumbnails. Draw the `Image` under `key`. Pass `requestId` so the capability check can test the picture you drew.
- `open({ path, cwd })` opens the original in Preview and returns `{}`, or `{ error }` after a toast with the reason.

Types live in `types/index.d.ts`.

### Open

`⤢ open` runs `open -a Preview` on the original file, and plain `open` if Preview refuses. If both fail you get a toast with the reason.

### Band above the prompt

While you type, a strip above the prompt shows the images in the draft: each `[Image #N]` you pasted, and any bare image path, such as one iTerm2 pastes when you drag a file in. A bare path gets a `⧉ clip` button that puts it on the clipboard, so ctrl+v turns it into a real attachment.

## Commands

A mod can't attach image bytes to a prompt, so peek puts the image on the macOS clipboard and you press ctrl+v:

- `/peek <path>` takes a file, absolute, `~/` or relative. Quotes and `\ ` escapes are fine.
- `/peek last` takes the newest screenshot or PNG in your screenshot folder, ~/Desktop or ~/Downloads.
- `/peek clipboard-check` says whether the clipboard already holds an image.

The image goes on the clipboard as PNG and a toast says `Image on clipboard: press ctrl+v`. This replaces whatever was on the clipboard.

## Known limits

- No pictures in tmux, screen, Terminal.app, or on Claude Code before 2.1.305. You get the one-line fallback.
- The picture itself can't be clicked. Use the `⤢ open` button beside it.
- A pasted image shows only while Claude Code's session image cache still holds it. A resumed session whose cache was cleared shows nothing for it.
- iTerm2 sends picture bytes in-band, so a transcript full of large images redraws slower. Thumbnails are kept small for that reason.
- Remote images in replies are not fetched.
- `/peek` overwrites the clipboard.

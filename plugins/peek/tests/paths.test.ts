import { describe, expect, test } from 'claude-code/testing'

import { barePaths, imageTags, isImagePath, localImages, resolvePath, toolImagePaths } from '../hooks/paths'

describe('image paths in tool inputs', () => {
  test('takes the file_path of a Read, Write or Edit of an image', () => {
    expect(toolImagePaths('Read', { file_path: '/a/shot.PNG' })).toEqual(['/a/shot.PNG'])
    expect(toolImagePaths('Write', { file_path: 'out/chart.webp', content: '' })).toEqual(['out/chart.webp'])
    expect(toolImagePaths('Edit', { file_path: '/a/b.heic' })).toEqual(['/a/b.heic'])
  })

  test('ignores files that are not images and tools without paths', () => {
    expect(toolImagePaths('Read', { file_path: '/a/notes.md' })).toEqual([])
    expect(toolImagePaths('Grep', { pattern: 'x.png' })).toEqual([])
    expect(toolImagePaths('Read', null)).toEqual([])
    expect(toolImagePaths('Read', { file_path: 3 })).toEqual([])
  })

  test('finds image paths a Bash command names, quoted or with escaped spaces, once each', () => {
    const command = `sips -s format png "/tmp/my shot.jpg" --out /tmp/out.png && open /tmp/out.png; echo done > log.txt`
    expect(toolImagePaths('Bash', { command })).toEqual(['/tmp/my shot.jpg', '/tmp/out.png'])
    expect(toolImagePaths('Bash', { command: 'screencapture -x ~/Desktop/a\\ b.png' })).toEqual(['~/Desktop/a b.png'])
    expect(toolImagePaths('Bash', { command: 'curl -o x https://e.com/a.png' })).toEqual([])
    expect(toolImagePaths('Bash', { command: "open /tmp/shot\\(1\\).png '/tmp/a\\b.png'" })).toEqual(['/tmp/shot(1).png', '/tmp/a\\b.png'])
  })

  test('keeps an escaped shell operator inside its path', () => {
    expect(toolImagePaths('Bash', { command: 'cat /tmp/R\\&D.png /tmp/a\\;b.png|wc' })).toEqual(['/tmp/R&D.png', '/tmp/a;b.png'])
  })

  test('drops relative paths from a command that changes directory, keeping absolute ones', () => {
    expect(toolImagePaths('Bash', { command: 'cd /tmp && sips -s format png in.jpg --out chart.png' })).toEqual([])
    expect(toolImagePaths('Bash', { command: 'pushd /tmp; sips a.jpg --out /tmp/b.png ~/c.png' })).toEqual(['/tmp/b.png', '~/c.png'])
    expect(toolImagePaths('Bash', { command: 'sips in.jpg --out out/cd.png' })).toEqual(['in.jpg', 'out/cd.png'])
  })

  test('knows the image extensions in any case', () => {
    expect(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.heic'].every(isImagePath)).toBe(true)
    expect(isImagePath('a.svg')).toBe(false)
  })
})

describe('local images in a reply', () => {
  test('reads the destination with a title in any quotes, in angle brackets or as a file URL', () => {
    const text = `![a](out/c.png "C") ![b](<my shots/b.jpg>) ![c](file:///tmp/f%20g.png) ![d](d.png 'D') ![e](e.png (E))`
    expect(localImages(text)).toEqual(['out/c.png', 'my shots/b.jpg', '/tmp/f g.png', 'd.png', 'e.png'])
  })

  test('decodes a file URL with an empty or localhost authority, keeping a stray % as written', () => {
    expect(localImages('![a](file:///tmp/c%231.png) ![b](file://localhost/tmp/q%3F.png) ![c](file:///tmp/100%.png)')).toEqual(['/tmp/c#1.png', '/tmp/q?.png', '/tmp/100%.png'])
  })

  test('skips a file URL on another host', () => {
    expect(localImages('![a](file://server/tmp/a.png)')).toEqual([])
  })

  test('decodes a local destination once', () => {
    expect(localImages('![a](out/my%20chart.png) ![b](/tmp/100%.png)')).toEqual(['out/my chart.png', '/tmp/100%.png'])
  })

  test('skips image syntax in code spans, fenced blocks and after a backslash', () => {
    const text = 'Write ``![x](a.png) with ` inside`` like so:\n\n```md\n![y](b.png)\n```\n\n\\![z](c.png) but ![w](d.png)'
    expect(localImages(text)).toEqual(['d.png'])
  })

  test('reads balanced and escaped parentheses in a destination', () => {
    expect(localImages('![a](out/chart(1).png) and ![b](out/b\\).png)')).toEqual(['out/chart(1).png', 'out/b).png'])
  })

  test('finds images nested in lists, tables and links', () => {
    expect(localImages('- ![a](a.png)\n\n| x |\n| - |\n| ![b](b.png) |\n\n[![c](c.png)](https://e.com)')).toEqual(['a.png', 'b.png', 'c.png'])
  })

  test('keeps local images only: no URLs, no plain links, no non-image files', () => {
    expect(localImages('![a](https://e.com/a.png) [b](/tmp/b.png) ![c](/tmp/c.pdf) ![d](./d.gif)')).toEqual(['./d.gif'])
  })
})

describe('resolving a path', () => {
  test('keeps an absolute path, expands ~ and resolves a relative one against cwd', () => {
    expect(resolvePath('/x/a.png', '/w', '/h')).toBe('/x/a.png')
    expect(resolvePath('~/a.png', '/w', '/h')).toBe('/h/a.png')
    expect(resolvePath('./out/a.png', '/w/p/', '/h')).toBe('/w/p/out/a.png')
    expect(resolvePath('../a.png', '/w/p', '/h')).toBe('/w/a.png')
  })
})

describe('the prompt draft', () => {
  test('lists [Image #N] tags once each', () => {
    expect(imageTags('look [Image #2] and [Image #5] again [Image #2]')).toEqual([2, 5])
    expect(imageTags('no images')).toEqual([])
  })

  test('finds bare image paths a drag drops in, escaped or quoted', () => {
    expect(barePaths('compare /home/a/Desktop/Screen\\ Shot.png with ~/b.jpg please')).toEqual(['/home/a/Desktop/Screen Shot.png', '~/b.jpg'])
    expect(barePaths("'/tmp/a b.png' ok")).toEqual(['/tmp/a b.png'])
    expect(barePaths('/tmp/shot\\(1\\).png')).toEqual(['/tmp/shot(1).png'])
    expect(barePaths('see /tmp/notes.txt and a.png')).toEqual([])
  })

  test("finds a quoted path holding the other quote", () => {
    expect(barePaths(`"/tmp/Bob's shot.png" and '/tmp/say "hi".png'`)).toEqual(["/tmp/Bob's shot.png", '/tmp/say "hi".png'])
  })
})

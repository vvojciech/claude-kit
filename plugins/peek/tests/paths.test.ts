import { describe, expect, test } from 'claude-code/testing'

import { barePaths, imageTags, isImagePath, localImages, markdownImages, resolvePath, toolImagePaths } from '../hooks/paths'

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
  })

  test('knows the image extensions in any case', () => {
    expect(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.heic'].every(isImagePath)).toBe(true)
    expect(isImagePath('a.svg')).toBe(false)
  })
})

describe('markdown image links', () => {
  test('reads alt and src, with a title, angle brackets or a file URL', () => {
    const text = 'See ![chart](out/c.png "Chart") and ![](<my shots/a b.jpg>) and ![x](file:///tmp/f%20g.png)'
    expect(markdownImages(text)).toEqual([
      { alt: 'chart', src: 'out/c.png' },
      { alt: '', src: 'my shots/a b.jpg' },
      { alt: 'x', src: '/tmp/f g.png' },
    ])
  })

  test('keeps local images only: no URLs, no plain links, no non-image files', () => {
    const text = '![a](https://e.com/a.png) [b](/tmp/b.png) ![c](/tmp/c.pdf) ![d](./d.gif)'
    expect(localImages(text)).toEqual([{ alt: 'd', src: './d.gif' }])
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
    expect(barePaths('see /tmp/notes.txt and a.png')).toEqual([])
  })
})

# Scribbly Notes

Scribbly Notes is a local-first notebook studio that turns typed study notes into handwritten-style A4 pages. The app runs entirely in the browser: it does not send notes to a server or depend on external fonts or image services.

## Run locally

Serve this folder over `localhost` or HTTPS (required for service-worker caching). For example:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000`. Open the app once while online (or on your local server) to cache its application files and fonts for later offline use. No package installation or build step is required.

## Features

- Live notebook preview with A4 proportions, page navigation, and seeded, subtle handwriting variation.
- Three bundled offline handwriting fonts: Patrick Hand (neat), Caveat (cursive), and Kalam (casual).
- Ruled, blank, grid, and dotted paper; four preset inks and a custom colour picker.
- Markdown-style headings (`#` / `##`), paragraphs, bullets, numbered lists, inline `**bold**` and `*italic*`, and common symbols.
- Text formatting, undo/redo, font size, line spacing, alignment, zoom, and word/character counts.
- High-resolution individual-page PNG export, optional all-page PNG downloads, a single multi-page A4 PDF, and browser printing.
- Automatic local saving, a saved-notes library, and validated JSON backup/restore.
- Browser printing through the standard print dialog.

## Use

1. Type or paste notes in the editor. The example is a starter; replace or clear it whenever you like.
2. Use `# Heading` or `## Heading`, `- bullet`, and `1. numbered item` to format content. Select text and use the toolbar for bold/italic; the heading control adds or removes heading markers.
3. Choose a handwriting style, ink, paper, and spacing. The same deterministic preview is used for exports.
4. Navigate pages, save the current page or all PNG pages, or export the whole notebook as a PDF.
5. Notes are auto-saved in this browser. Use **My Notes** to save named snapshots, or **Settings** for JSON backup and restore.

## Fonts and licensing

All three fonts are distributed under the SIL Open Font License 1.1. The original license texts are included alongside the font files in `assets/fonts/`.

- Patrick Hand — Patrick Wagesreiter
- Caveat — Impallari Type
- Kalam — Indian Type Foundry

The fonts are bundled as local TTF assets; no network requests are required to render text.

## Privacy and offline use

Notes and saved snapshots are stored in the browser's LocalStorage. Exports are generated on the device. When hosted on `localhost` or HTTPS, the service worker caches the app shell and all three local fonts. Browser storage can be cleared by the browser or device owner, so use a JSON backup for portable copies.

This tool is intended for personal study notes and revision, not for submitting generated pages as handwritten academic work.

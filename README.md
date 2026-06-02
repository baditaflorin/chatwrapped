# chatwrapped

[![pages](https://img.shields.io/badge/live-baditaflorin.github.io%2Fchatwrapped-8b5cf6)](https://baditaflorin.github.io/chatwrapped/)
[![version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/baditaflorin/chatwrapped/blob/main/package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

> Drop a chat export, get your private "relationship wrapped" — message counts, who texts first, busiest hours, streaks, top emoji and more. **Computed entirely in your browser. Nothing is uploaded.**

**Live → https://baditaflorin.github.io/chatwrapped/**

Spotify Wrapped, but for a conversation — and private. You drop a WhatsApp or Telegram export, and the whole "wrapped" is computed locally with the browser's `FileReader`. There is no backend, no upload, no analytics. Your chat never leaves the device.

## What you get

A scrollable set of bold stat cards:

- **Total messages** + the date range they span
- **Who said more** — per-person counts and shares, with bars
- **Who texts first** — counts conversation restarts after a >6h silence
- **Busiest hour** of the day and **busiest day** of the week
- **Longest streak** of consecutive days with at least one message
- **Top emoji** and **top words** (with stop-word filtering)
- **Average message length**
- **Night owl** — share of messages sent 12–6am, and the biggest night owl
- **Longest silence** — the largest gap between two messages

Then **⬇ Save card (PNG)** exports the summary as a shareable image (rendered from the DOM, client-side).

## Supported exports

| App      | File    | How to get it                                                         |
| -------- | ------- | --------------------------------------------------------------------- |
| WhatsApp | `.txt`  | Chat → **Export chat** → _Without media_                              |
| Telegram | `.json` | Desktop → **Export chat history** → format _Machine-readable JSON_    |
| _other_  | `.txt`  | Generic `Name: message` transcripts fall back to a best-effort parser |

Both common WhatsApp timestamp variants are handled (`[2024-01-02, 14:33:01] Alex:` and `02/01/2024, 14:33 - Alex:`), including multi-line messages and skipping system lines like the end-to-end-encryption notice and `<Media omitted>`. Telegram `text` is supported both as a plain string and as the segment-array shape.

No real file? Hit **✨ Try with sample data** to load a synthetic conversation.

## How it works

All the heavy lifting is pure, DOM-free, and unit-tested:

- `src/parse.ts` — `parseWhatsApp`, `parseTelegram`, `parseGeneric`, `detectAndParse`
- `src/stats.ts` — each statistic as a pure function over `Message[]` (`{ ts, author, text }`)
- `src/format.ts` — pure display formatting
- `src/main.ts` — a thin wiring layer: `FileReader`, drag-drop, rendering, and PNG export

The test suite (`tests/core.test.ts`) drives the parsers and every stat with fixed timestamps for exact assertions, and round-trips the sample data through the real parser.

## Run it locally

```bash
git clone https://github.com/baditaflorin/chatwrapped
cd chatwrapped
npm install
npm run dev      # http://127.0.0.1:5173
```

## Build & deploy

GitHub Pages serves the committed `docs/` directory on `main`. No CI — a local smoke gate builds and sanity-checks the output:

```bash
npm run smoke    # vitest + vite build → docs/ + output checks
```

## Privacy

100% client-side. There is no backend, no analytics, and no upload — the code makes **zero network requests with your data**. Reading happens via `FileReader`; the PNG export rasterises an on-page element with `html-to-image`. Want to verify? Open the devtools Network tab while you use it.

## License

MIT — see [LICENSE](./LICENSE).

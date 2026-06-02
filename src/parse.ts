// Pure, DOM-free parsers. Each turns a raw chat export into `Message[]`.
//
// Nothing here touches the network, the DOM, FileReader, or globals — it is all
// string/JSON crunching so it can be exercised exhaustively under vitest's node
// environment.

import type { Message, ParseResult, SourceFormat } from "./types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Lines emitted by the apps themselves, never written by a human. */
const SYSTEM_SNIPPETS = [
  "messages and calls are end-to-end encrypted",
  "<media omitted>",
  "media omitted",
  "this message was deleted",
  "you deleted this message",
  "missed voice call",
  "missed video call",
  "changed the subject",
  "changed this group's icon",
  "changed their phone number",
  "created group",
  "added you",
  "joined using this group's invite link",
  "image omitted",
  "video omitted",
  "audio omitted",
  "sticker omitted",
  "gif omitted",
  "document omitted",
  "contact card omitted",
];

/** True when a message body is a system notice rather than real content. */
export function isSystemText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return SYSTEM_SNIPPETS.some((s) => t === s || t.includes(s));
}

function pushMessage(out: Message[], ts: number, author: string, text: string): void {
  const body = text.trim();
  const name = author.trim();
  if (!name) return;
  if (isSystemText(body)) return;
  out.push({ ts, author: name, text: body });
}

// ---------------------------------------------------------------------------
// WhatsApp .txt
// ---------------------------------------------------------------------------
//
// Two header shapes are common across locales/exports:
//
//   Bracketed (iOS):  [2024-01-02, 14:33:01] Alex: hello
//   Dash (Android):   02/01/2024, 14:33 - Alex: hello
//
// A line without a recognised header is a continuation of the previous message.
// System notices have a header but no "Author:" segment (or a known snippet).

interface WaHeader {
  ts: number;
  rest: string; // everything after the timestamp ("Author: text" or a notice)
}

// [2024-01-02, 14:33:01] rest    /  [02/01/2024, 2:05:09 PM] rest
const BRACKET_RE = /^\[(.+?)\]\s?(.*)$/;
// 02/01/2024, 14:33 - rest       /  1/2/24, 2:05 PM - rest
const DASH_RE =
  /^(\d{1,4}[./-]\d{1,2}[./-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s+-\s+(.*)$/;

/** Strip Unicode bidi / narrow-nbsp junk WhatsApp sprinkles into exports. */
function clean(line: string): string {
  return line.replace(/[‎‏‪-‮ ]/g, " ").replace(/﻿/g, "");
}

/**
 * Parse a "DD/MM/YYYY"-ish date + "HH:MM(:SS)( AM/PM)" time into epoch ms.
 * Returns NaN when the shape is unrecognised. Day-first is assumed when the
 * first field is > 12 (common outside the US); otherwise month-first is used.
 */
export function parseWaTimestamp(dateStr: string, timeStr: string): number {
  const dm = dateStr.trim().match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!dm) return NaN;
  let year: number;
  let day: number;
  let month: number;
  if (dm[1]!.length === 4) {
    // YYYY-MM-DD
    year = Number(dm[1]);
    month = Number(dm[2]);
    day = Number(dm[3]);
  } else {
    const a = Number(dm[1]);
    const b = Number(dm[2]);
    year = Number(dm[3]);
    if (year < 100) year += 2000;
    // Heuristic: a value > 12 must be the day → day-first; else month-first.
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else {
      // Ambiguous → assume day-first (most non-US exports).
      day = a;
      month = b;
    }
  }

  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap][Mm])?$/);
  if (!tm) return NaN;
  let hour = Number(tm[1]);
  const min = Number(tm[2]);
  const sec = tm[3] ? Number(tm[3]) : 0;
  const ampm = tm[4]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const d = new Date(year, month - 1, day, hour, min, sec, 0);
  return d.getTime();
}

function matchWaHeader(line: string): WaHeader | null {
  const b = line.match(BRACKET_RE);
  if (b) {
    const inner = b[1]!;
    // Inside the brackets: "2024-01-02, 14:33:01" or "02/01/2024 2:05:09 PM".
    const parts = inner.split(",");
    let datePart: string;
    let timePart: string;
    if (parts.length >= 2) {
      datePart = parts[0]!;
      timePart = parts.slice(1).join(",");
    } else {
      // No comma — split on the first whitespace run.
      const m = inner.trim().match(/^(\S+)\s+(.*)$/);
      if (!m) return null;
      datePart = m[1]!;
      timePart = m[2]!;
    }
    const ts = parseWaTimestamp(datePart, timePart);
    if (Number.isNaN(ts)) return null;
    return { ts, rest: b[2] ?? "" };
  }

  const d = line.match(DASH_RE);
  if (d) {
    const ts = parseWaTimestamp(d[1]!, d[2]!);
    if (Number.isNaN(ts)) return null;
    return { ts, rest: d[3] ?? "" };
  }
  return null;
}

/** Split "Author: body" → [author, body]; null when there is no author. */
function splitAuthor(rest: string): [string, string] | null {
  const idx = rest.indexOf(": ");
  if (idx === -1) {
    // Could be "Author:" with empty body, or a system notice with no colon.
    const bare = rest.match(/^([^:]{1,80}):$/);
    if (bare) return [bare[1]!, ""];
    return null;
  }
  const author = rest.slice(0, idx);
  // An author name should not itself contain a newline; guard against false
  // positives where a continuation happened to contain ": ".
  if (author.includes("\n")) return null;
  return [author, rest.slice(idx + 2)];
}

export function parseWhatsApp(text: string): Message[] {
  const out: Message[] = [];
  const lines = text.split(/\r?\n/);

  let curTs = NaN;
  let curAuthor = "";
  let curText = "";
  let open = false;

  const flush = (): void => {
    if (open) pushMessage(out, curTs, curAuthor, curText);
    open = false;
  };

  for (const raw of lines) {
    const line = clean(raw);
    const header = matchWaHeader(line);
    if (header) {
      flush();
      const split = splitAuthor(header.rest);
      if (!split) {
        // Header with no author → system line (e.g. encryption notice). Skip,
        // but make sure we don't attach following continuations to nothing.
        open = false;
        continue;
      }
      curTs = header.ts;
      curAuthor = split[0]!;
      curText = split[1]!;
      open = true;
    } else if (open) {
      // Continuation of the current message.
      curText += "\n" + line;
    }
    // A non-header line before any header (e.g. a leading blank) is ignored.
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Telegram .json
// ---------------------------------------------------------------------------
//
// Official "Machine-readable JSON" export:
//   { "messages": [ { "type": "message", "date": "2024-01-02T14:33:01",
//                     "from": "Alex", "text": "hi" | [segments] }, ... ] }
// Segments are either strings or { type, text } objects.

interface TgSegment {
  type?: string;
  text?: string;
}
interface TgMessage {
  type?: string;
  date?: string;
  date_unixtime?: string | number;
  from?: string;
  from_id?: string;
  actor?: string;
  text?: string | Array<string | TgSegment>;
}

/** Flatten Telegram's string-or-segment-array `text` into a plain string. */
export function telegramText(text: TgMessage["text"]): string {
  if (text == null) return "";
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text
    .map((seg) => {
      if (typeof seg === "string") return seg;
      if (seg && typeof seg === "object" && typeof seg.text === "string") return seg.text;
      return "";
    })
    .join("");
}

function telegramTs(m: TgMessage): number {
  if (m.date_unixtime != null) {
    const n = Number(m.date_unixtime);
    if (!Number.isNaN(n)) return n * 1000;
  }
  if (typeof m.date === "string") {
    // Telegram writes local time without a zone ("2024-01-02T14:33:01").
    // Treat it as local so the hour-of-day stats match what the user saw.
    const m2 = m.date.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m2) {
      return new Date(
        Number(m2[1]),
        Number(m2[2]) - 1,
        Number(m2[3]),
        Number(m2[4]),
        Number(m2[5]),
        m2[6] ? Number(m2[6]) : 0,
      ).getTime();
    }
    const parsed = Date.parse(m.date);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return NaN;
}

/** Accepts the parsed JSON object (or a raw string) of a Telegram export. */
export function parseTelegram(json: unknown): Message[] {
  let root: unknown = json;
  if (typeof json === "string") {
    try {
      root = JSON.parse(json);
    } catch {
      return [];
    }
  }
  if (!root || typeof root !== "object") return [];
  const messages = (root as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];

  const out: Message[] = [];
  for (const raw of messages as TgMessage[]) {
    if (!raw || typeof raw !== "object") continue;
    // Skip service messages (joins, pins, calls) — only keep real messages.
    if (raw.type && raw.type !== "message") continue;
    const ts = telegramTs(raw);
    if (Number.isNaN(ts)) continue;
    const author = raw.from ?? raw.actor ?? "";
    pushMessage(out, ts, String(author), telegramText(raw.text));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detection + dispatch
// ---------------------------------------------------------------------------

/** True when the raw text is (probably) a Telegram JSON export. */
function looksLikeTelegram(raw: string): boolean {
  const head = raw.slice(0, 4000);
  return /^\s*[{[]/.test(head) && /"messages"\s*:/.test(head);
}

/** True when at least one WhatsApp-style header is present. */
function looksLikeWhatsApp(raw: string): boolean {
  const lines = raw.split(/\r?\n/).slice(0, 200);
  return lines.some((l) => matchWaHeader(clean(l)) !== null);
}

/**
 * Last-resort parser: treat the file as a transcript of "Name: message" lines
 * with no usable timestamps. Timestamps are synthesised one minute apart so the
 * volume/word/emoji stats still work (time-of-day stats will be meaningless).
 */
export function parseGeneric(raw: string): Message[] {
  const out: Message[] = [];
  let t = Date.UTC(2024, 0, 1, 12, 0, 0);
  const step = 60_000;
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = clean(lineRaw).trim();
    if (!line) continue;
    const split = splitAuthor(line);
    if (!split || !split[1]) {
      // No author → attach to previous message if one exists.
      if (out.length) out[out.length - 1]!.text += "\n" + line;
      continue;
    }
    pushMessage(out, t, split[0]!, split[1]!);
    t += step;
  }
  return out;
}

/**
 * Auto-detect the format from content (and the filename as a tiebreaker) and
 * return the parsed messages alongside the chosen format.
 */
export function detectAndParse(raw: string, filename = ""): ParseResult {
  const lower = filename.toLowerCase();

  if (looksLikeTelegram(raw) || lower.endsWith(".json")) {
    const messages = parseTelegram(raw);
    if (messages.length) return { format: "telegram", messages };
  }

  if (looksLikeWhatsApp(raw)) {
    const messages = parseWhatsApp(raw);
    if (messages.length) return { format: "whatsapp", messages };
  }

  // Filename hint without a content match (e.g. a .txt that didn't parse).
  if (lower.endsWith(".txt")) {
    const messages = parseWhatsApp(raw);
    if (messages.length) return { format: "whatsapp", messages };
  }

  const format: SourceFormat = "generic";
  return { format, messages: parseGeneric(raw) };
}

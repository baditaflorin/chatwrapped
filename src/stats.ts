// Pure analytics over `Message[]`. No DOM, no globals, no time-dependence
// beyond the timestamps embedded in the data — every function is deterministic
// for a given input, which is what makes the unit tests exact.

import type { Message } from "./types";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Conversation is considered "restarted" after this much silence. */
export const INITIATION_GAP_MS = 6 * HOUR_MS;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Messages sorted ascending by timestamp (stable, non-mutating). */
export function sortByTime(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.ts - b.ts || 0);
}

/** Distinct authors in first-seen order. */
export function authors(messages: Message[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (!seen.has(m.author)) {
      seen.add(m.author);
      out.push(m.author);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volume + range
// ---------------------------------------------------------------------------

export interface DateRange {
  start: number;
  end: number;
  days: number;
}

/** Inclusive day-span between the first and last message. */
export function dateRange(messages: Message[]): DateRange | null {
  if (!messages.length) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const m of messages) {
    if (m.ts < start) start = m.ts;
    if (m.ts > end) end = m.ts;
  }
  // Inclusive span of local calendar days (e.g. 23:00 → 01:00 next day = 2).
  const days = dayNumber(end) - dayNumber(start) + 1;
  return { start, end, days };
}

export interface PersonCount {
  author: string;
  count: number;
  share: number; // 0..1
}

/** Per-person message counts, sorted high→low, with share of the total. */
export function perPersonCounts(messages: Message[]): PersonCount[] {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
  const total = messages.length || 1;
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author));
}

// ---------------------------------------------------------------------------
// Who texts first (conversation initiations)
// ---------------------------------------------------------------------------

export interface Initiations {
  byAuthor: Record<string, number>;
  topAuthor: string | null;
  total: number;
}

/**
 * Count how often each author sends the first message of a "conversation",
 * where a new conversation starts after a silence longer than `gapMs`. The very
 * first message in the log always counts as an initiation.
 */
export function firstTexter(messages: Message[], gapMs = INITIATION_GAP_MS): Initiations {
  const sorted = sortByTime(messages);
  const byAuthor: Record<string, number> = {};
  let total = 0;
  let prevTs = -Infinity;
  for (const m of sorted) {
    if (m.ts - prevTs > gapMs) {
      byAuthor[m.author] = (byAuthor[m.author] ?? 0) + 1;
      total++;
    }
    prevTs = m.ts;
  }
  let topAuthor: string | null = null;
  let best = -1;
  for (const [author, n] of Object.entries(byAuthor)) {
    if (n > best || (n === best && topAuthor !== null && author.localeCompare(topAuthor) < 0)) {
      best = n;
      topAuthor = author;
    }
  }
  return { byAuthor, topAuthor, total };
}

// ---------------------------------------------------------------------------
// Busiest hour / day-of-week
// ---------------------------------------------------------------------------

/** 24-slot histogram of local message hours (index 0 = midnight hour). */
export function hourHistogram(messages: Message[]): number[] {
  const bins = new Array<number>(24).fill(0);
  for (const m of messages) bins[new Date(m.ts).getHours()]!++;
  return bins;
}

/** 7-slot histogram of local weekday counts (index 0 = Sunday). */
export function weekdayHistogram(messages: Message[]): number[] {
  const bins = new Array<number>(7).fill(0);
  for (const m of messages) bins[new Date(m.ts).getDay()]!++;
  return bins;
}

/** Index of the largest bin (ties → earliest), or -1 for an empty histogram. */
export function argmax(bins: number[]): number {
  let idx = -1;
  let best = -1;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i]! > best) {
      best = bins[i]!;
      idx = i;
    }
  }
  return best <= 0 ? -1 : idx;
}

export function busiestHour(messages: Message[]): number {
  return argmax(hourHistogram(messages));
}

export function busiestWeekday(messages: Message[]): number {
  return argmax(weekdayHistogram(messages));
}

// ---------------------------------------------------------------------------
// Longest daily streak
// ---------------------------------------------------------------------------

/**
 * Day-number (local) for adjacency checks, ignoring the wall-clock time.
 * Consecutive local calendar days differ by exactly 1. Note this is a UTC-based
 * index of the local midnight, so do NOT multiply it back by DAY_MS to recover a
 * timestamp — use `localMidnight()` for that.
 */
function dayNumber(ts: number): number {
  const d = new Date(ts);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY_MS);
}

/** Local-midnight timestamp for the calendar day containing `ts`. */
function localMidnight(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export interface Streak {
  length: number; // consecutive days, each with ≥1 message
  startDay: number | null; // ms at local midnight of the first day
  endDay: number | null;
}

/** Longest run of consecutive calendar days that each have ≥1 message. */
export function longestStreak(messages: Message[]): Streak {
  if (!messages.length) return { length: 0, startDay: null, endDay: null };
  // Map each distinct day-number to its local-midnight timestamp.
  const midnightByDay = new Map<number, number>();
  for (const m of messages) midnightByDay.set(dayNumber(m.ts), localMidnight(m.ts));
  const ordered = [...midnightByDay.keys()].sort((a, b) => a - b);
  let best = 1;
  let cur = 1;
  let bestStartIdx = 0;
  let curStartIdx = 0;
  let bestEndIdx = 0;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]! === ordered[i - 1]! + 1) {
      cur++;
    } else {
      cur = 1;
      curStartIdx = i;
    }
    if (cur > best) {
      best = cur;
      bestStartIdx = curStartIdx;
      bestEndIdx = i;
    }
  }
  return {
    length: best,
    startDay: midnightByDay.get(ordered[bestStartIdx]!) ?? null,
    endDay: midnightByDay.get(ordered[bestEndIdx]!) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

// Match a single emoji grapheme. Covers the main pictographic blocks plus
// variation selectors / ZWJ sequences and skin-tone modifiers so "👍🏽" and
// "👨‍👩‍👧" count as one each, plus two special-cased sequences that are NOT
// covered by \p{Extended_Pictographic} at all:
//   - flag emoji: a pair of Regional_Indicator letters, e.g. "🇺🇸"
//   - keycap emoji: digit/#/* + optional VS16 + combining enclosing keycap,
//     e.g. "1️⃣"
// Without these, chats containing flags or keycaps would silently undercount
// "top emoji" for exactly those glyphs.
const EMOJI_RE =
  /(\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️)?(?:[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️)?(?:[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

export interface EmojiCount {
  emoji: string;
  count: number;
}

/** Top-N emoji across all messages, most-used first. */
export function topEmoji(messages: Message[], limit = 10): EmojiCount[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const matches = m.text.match(EMOJI_RE);
    if (!matches) continue;
    for (const e of matches) {
      // Skip lone digits/symbols that Extended_Pictographic occasionally grabs.
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Top words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set<string>(
  (
    "the a an and or but if then so of to in on at for with from by as is are was were be been " +
    "being am i you he she it we they me him her us them my your his its our their this that these " +
    "those do does did done have has had having will would can could should shay may might must " +
    "not no yes ok okay just like get got go going gonna wanna im im u ur dont doesnt didnt cant " +
    "wont isnt arent wasnt werent ive youre theyre well yeah yea yep nah hey hi hello oh ah um " +
    "about up out down off over under again too very more most some any all what when where who why " +
    "how which there here now also than into one two how lol haha omg ok"
  )
    .split(/\s+/)
    .filter(Boolean),
);

export interface WordCount {
  word: string;
  count: number;
}

/** Tokenise, strip stop-words/short tokens, and rank the remaining words. */
export function topWords(messages: Message[], limit = 12): WordCount[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    // Lowercase, keep letters/numbers (incl. accented) and split on the rest.
    const tokens = m.text.toLowerCase().match(/[\p{L}\p{N}']+/gu);
    if (!tokens) continue;
    for (const raw of tokens) {
      const w = raw.replace(/^'+|'+$/g, "");
      if (w.length < 3) continue;
      if (STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Average message length
// ---------------------------------------------------------------------------

/** Mean message length in characters (0 for an empty log). */
export function avgMessageLength(messages: Message[]): number {
  if (!messages.length) return 0;
  let total = 0;
  for (const m of messages) total += m.text.length;
  return total / messages.length;
}

// ---------------------------------------------------------------------------
// Night owl
// ---------------------------------------------------------------------------

export interface NightOwl {
  share: number; // 0..1 of all messages sent 00:00–05:59
  topAuthor: string | null; // person with the highest night share (min 5 msgs)
  topAuthorShare: number;
}

function isNightHour(ts: number): boolean {
  const h = new Date(ts).getHours();
  return h >= 0 && h < 6;
}

/** Overall night-owl share plus the biggest individual night owl. */
export function nightOwl(messages: Message[]): NightOwl {
  if (!messages.length) return { share: 0, topAuthor: null, topAuthorShare: 0 };
  let night = 0;
  const perAuthorTotal = new Map<string, number>();
  const perAuthorNight = new Map<string, number>();
  for (const m of messages) {
    perAuthorTotal.set(m.author, (perAuthorTotal.get(m.author) ?? 0) + 1);
    if (isNightHour(m.ts)) {
      night++;
      perAuthorNight.set(m.author, (perAuthorNight.get(m.author) ?? 0) + 1);
    }
  }
  let topAuthor: string | null = null;
  let topAuthorShare = -1;
  for (const [author, total] of perAuthorTotal) {
    if (total < 5) continue; // ignore thin samples
    const s = (perAuthorNight.get(author) ?? 0) / total;
    if (
      s > topAuthorShare ||
      (s === topAuthorShare && topAuthor && author.localeCompare(topAuthor) < 0)
    ) {
      topAuthorShare = s;
      topAuthor = author;
    }
  }
  if (topAuthor === null) topAuthorShare = 0;
  return { share: night / messages.length, topAuthor, topAuthorShare };
}

// ---------------------------------------------------------------------------
// Longest silence
// ---------------------------------------------------------------------------

export interface Silence {
  ms: number;
  start: number | null; // ts of the message before the gap
  end: number | null; // ts of the message after the gap
}

/** The single largest gap between consecutive messages. */
export function longestSilence(messages: Message[]): Silence {
  const sorted = sortByTime(messages);
  if (sorted.length < 2) return { ms: 0, start: null, end: null };
  let ms = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.ts - sorted[i - 1]!.ts;
    if (gap > ms) {
      ms = gap;
      start = sorted[i - 1]!.ts;
      end = sorted[i]!.ts;
    }
  }
  return { ms, start, end };
}

// ---------------------------------------------------------------------------
// One-shot bundle for the UI
// ---------------------------------------------------------------------------

export interface WrappedStats {
  total: number;
  range: DateRange | null;
  perPerson: PersonCount[];
  initiations: Initiations;
  busiestHour: number;
  busiestWeekday: number;
  streak: Streak;
  topEmoji: EmojiCount[];
  topWords: WordCount[];
  avgLength: number;
  nightOwl: NightOwl;
  silence: Silence;
}

/** Compute every stat in one pass-friendly call for the renderer. */
export function computeWrapped(messages: Message[]): WrappedStats {
  return {
    total: messages.length,
    range: dateRange(messages),
    perPerson: perPersonCounts(messages),
    initiations: firstTexter(messages),
    busiestHour: busiestHour(messages),
    busiestWeekday: busiestWeekday(messages),
    streak: longestStreak(messages),
    topEmoji: topEmoji(messages),
    topWords: topWords(messages),
    avgLength: avgMessageLength(messages),
    nightOwl: nightOwl(messages),
    silence: longestSilence(messages),
  };
}

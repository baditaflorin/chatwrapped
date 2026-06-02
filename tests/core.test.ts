import { describe, expect, it } from "vitest";
import {
  parseWhatsApp,
  parseTelegram,
  parseGeneric,
  detectAndParse,
  telegramText,
  parseWaTimestamp,
  isSystemText,
} from "../src/parse";
import {
  perPersonCounts,
  firstTexter,
  busiestHour,
  busiestWeekday,
  longestStreak,
  topEmoji,
  topWords,
  nightOwl,
  longestSilence,
  dateRange,
  avgMessageLength,
  computeWrapped,
  argmax,
  authors,
  WEEKDAYS,
} from "../src/stats";
import { sampleWhatsAppExport } from "../src/sample";
import type { Message } from "../src/types";

// A fixed local-time builder so timestamp-derived stats are exact regardless of
// the machine's clock (we still depend on the runner's zone, same as the app's
// own local-time semantics — every test uses Date(...) the same way).
const at = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

const msg = (ts: number, author: string, text: string): Message => ({ ts, author, text });

// ---------------------------------------------------------------------------
// WhatsApp parser
// ---------------------------------------------------------------------------

describe("parseWhatsApp", () => {
  it("parses the bracketed iOS variant", () => {
    const out = parseWhatsApp("[2024-01-02, 14:33:01] Alex: hello there");
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe("Alex");
    expect(out[0]!.text).toBe("hello there");
    expect(out[0]!.ts).toBe(new Date(2024, 0, 2, 14, 33, 1, 0).getTime());
  });

  it("parses the dash Android variant", () => {
    const out = parseWhatsApp("02/01/2024, 14:33 - Sam: hi back");
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe("Sam");
    expect(out[0]!.text).toBe("hi back");
    // 02/01/2024 day-first → Jan 2 2024.
    expect(out[0]!.ts).toBe(at(2024, 1, 2, 14, 33));
  });

  it("joins multi-line continuation onto the previous message", () => {
    const raw = [
      "[2024-01-02, 14:33:01] Alex: line one",
      "line two",
      "line three",
      "[2024-01-02, 14:35:00] Sam: reply",
    ].join("\n");
    const out = parseWhatsApp(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe("line one\nline two\nline three");
    expect(out[1]!.text).toBe("reply");
  });

  it("skips system lines (encryption notice, media omitted)", () => {
    const raw = [
      "[2024-01-02, 14:00:00] Messages and calls are end-to-end encrypted.",
      "[2024-01-02, 14:33:01] Alex: real message",
      "[2024-01-02, 14:34:00] Sam: <Media omitted>",
    ].join("\n");
    const out = parseWhatsApp(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe("Alex");
  });

  it("handles 12-hour AM/PM times", () => {
    const out = parseWhatsApp("[01/02/2024, 2:05:09 PM] Alex: pm message");
    expect(out).toHaveLength(1);
    // 01/02/2024 month-first-ambiguous → day-first heuristic → Feb 1 2024, 14:05:09.
    expect(out[0]!.ts).toBe(new Date(2024, 1, 1, 14, 5, 9, 0).getTime());
  });
});

describe("parseWaTimestamp", () => {
  it("treats >12 first field as day-first", () => {
    expect(parseWaTimestamp("25/12/2023", "09:30")).toBe(at(2023, 12, 25, 9, 30));
  });
  it("parses ISO YYYY-MM-DD", () => {
    expect(parseWaTimestamp("2024-03-04", "00:00")).toBe(at(2024, 3, 4, 0, 0));
  });
  it("returns NaN for garbage", () => {
    expect(Number.isNaN(parseWaTimestamp("not-a-date", "nope"))).toBe(true);
  });
});

describe("isSystemText", () => {
  it("flags media/encryption and empty, keeps real text", () => {
    expect(isSystemText("<Media omitted>")).toBe(true);
    expect(isSystemText("  ")).toBe(true);
    expect(isSystemText("Messages and calls are end-to-end encrypted")).toBe(true);
    expect(isSystemText("see you tomorrow")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Telegram parser
// ---------------------------------------------------------------------------

describe("parseTelegram", () => {
  it("parses string text", () => {
    const json = {
      messages: [{ type: "message", date: "2024-01-02T14:33:01", from: "Alex", text: "hello" }],
    };
    const out = parseTelegram(json);
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe("Alex");
    expect(out[0]!.text).toBe("hello");
    expect(out[0]!.ts).toBe(new Date(2024, 0, 2, 14, 33, 1, 0).getTime());
  });

  it("parses segment-array text and joins segments", () => {
    const json = {
      messages: [
        {
          type: "message",
          date: "2024-01-02T15:00:00",
          from: "Sam",
          text: ["check ", { type: "link", text: "this" }, " out"],
        },
      ],
    };
    const out = parseTelegram(json);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("check this out");
  });

  it("skips service messages and accepts a raw JSON string", () => {
    const raw = JSON.stringify({
      messages: [
        { type: "service", action: "pin_message", date: "2024-01-02T10:00:00" },
        { type: "message", date: "2024-01-02T10:01:00", from: "Alex", text: "yo" },
      ],
    });
    const out = parseTelegram(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.author).toBe("Alex");
  });
});

describe("telegramText", () => {
  it("handles string, array, and nullish", () => {
    expect(telegramText("plain")).toBe("plain");
    expect(telegramText(["a", { text: "b" }, "c"])).toBe("abc");
    expect(telegramText(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Generic + detection
// ---------------------------------------------------------------------------

describe("detectAndParse", () => {
  it("auto-detects WhatsApp", () => {
    const r = detectAndParse("[2024-01-02, 14:33:01] Alex: hi", "chat.txt");
    expect(r.format).toBe("whatsapp");
    expect(r.messages).toHaveLength(1);
  });

  it("auto-detects Telegram JSON", () => {
    const raw = JSON.stringify({
      messages: [{ date: "2024-01-02T14:33:01", from: "A", text: "x" }],
    });
    const r = detectAndParse(raw, "result.json");
    expect(r.format).toBe("telegram");
  });

  it("falls back to generic for plain transcripts", () => {
    const r = detectAndParse("Alex: hey\nSam: yo\nAlex: how are you", "notes.txt");
    expect(r.format).toBe("generic");
    expect(r.messages).toHaveLength(3);
    expect(r.messages[0]!.author).toBe("Alex");
  });
});

describe("parseGeneric", () => {
  it("attaches author-less lines to the previous message", () => {
    const out = parseGeneric("Alex: one\ntwo\nSam: three");
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe("one\ntwo");
  });
});

// ---------------------------------------------------------------------------
// Stats — built on fixed timestamps for exact assertions
// ---------------------------------------------------------------------------

describe("stats", () => {
  // Two-person fixture with deliberate structure:
  //  - Alex sends 3, Sam sends 2  → counts
  //  - A >6h gap creates a 2nd conversation initiated by Sam
  //  - Two messages at 02:00 → night-owl
  const fixture: Message[] = [
    msg(at(2024, 1, 1, 9, 0), "Alex", "good morning 😀 coffee soon"),
    msg(at(2024, 1, 1, 9, 5), "Sam", "yes please 😀"),
    msg(at(2024, 1, 1, 9, 10), "Alex", "great 😀"),
    // big gap (>6h) → new conversation, Sam initiates
    msg(at(2024, 1, 2, 2, 0), "Sam", "still awake 🦉🦉"),
    msg(at(2024, 1, 2, 2, 30), "Alex", "go to sleep"),
  ];

  it("counts messages per person with shares", () => {
    const pc = perPersonCounts(fixture);
    expect(pc[0]!.author).toBe("Alex");
    expect(pc[0]!.count).toBe(3);
    expect(pc[0]!.share).toBeCloseTo(3 / 5);
    const sam = pc.find((p) => p.author === "Sam")!;
    expect(sam.count).toBe(2);
  });

  it("computes the date range in inclusive days", () => {
    const r = dateRange(fixture)!;
    expect(r.start).toBe(at(2024, 1, 1, 9, 0));
    expect(r.end).toBe(at(2024, 1, 2, 2, 30));
    expect(r.days).toBe(2);
  });

  it("attributes conversation initiations across a >6h gap", () => {
    const f = firstTexter(fixture);
    // First message (Alex) + one restart after the night gap (Sam).
    expect(f.total).toBe(2);
    expect(f.byAuthor["Alex"]).toBe(1);
    expect(f.byAuthor["Sam"]).toBe(1);
  });

  it("does not start a new conversation within the gap window", () => {
    const tight: Message[] = [
      msg(at(2024, 5, 1, 10, 0), "Alex", "a"),
      msg(at(2024, 5, 1, 13, 0), "Sam", "b"), // 3h < 6h → same convo
    ];
    expect(firstTexter(tight).total).toBe(1);
  });

  it("finds the busiest hour and weekday", () => {
    // 2024-01-01 is a Monday. Three messages at 09:00 hour.
    expect(busiestHour(fixture)).toBe(9);
    expect(busiestWeekday(fixture)).toBe(1); // Monday
    expect(WEEKDAYS[busiestWeekday(fixture)]).toBe("Monday");
  });

  it("computes the longest streak and a gap breaks it", () => {
    const streaky: Message[] = [
      msg(at(2024, 2, 1, 10, 0), "A", "x"),
      msg(at(2024, 2, 2, 10, 0), "A", "x"),
      msg(at(2024, 2, 3, 10, 0), "A", "x"), // 3-day run
      // gap: skip Feb 4 & 5
      msg(at(2024, 2, 6, 10, 0), "A", "x"),
      msg(at(2024, 2, 7, 10, 0), "A", "x"), // only a 2-day run
    ];
    expect(longestStreak(streaky).length).toBe(3);
  });

  it("ranks top emoji", () => {
    const e = topEmoji(fixture);
    expect(e[0]!.emoji).toBe("😀");
    expect(e[0]!.count).toBe(3);
    const owl = e.find((x) => x.emoji === "🦉")!;
    expect(owl.count).toBe(2);
  });

  it("ranks top words with stop-word filtering", () => {
    const w = topWords(fixture);
    const words = w.map((x) => x.word);
    // "coffee", "morning", "sleep", "awake", "great" survive; "good", "the" don't.
    expect(words).toContain("coffee");
    expect(words).toContain("sleep");
    expect(words).not.toContain("the");
    expect(words).not.toContain("go");
  });

  it("computes night-owl share and the biggest night owl", () => {
    const n = nightOwl(fixture);
    // 2 of 5 messages are in 00:00–05:59.
    expect(n.share).toBeCloseTo(2 / 5);
  });

  it("computes night-owl top author with enough samples", () => {
    // Sam: 6 messages, 5 at night. Alex: 6 messages, 0 at night.
    const owl: Message[] = [];
    for (let i = 0; i < 5; i++) owl.push(msg(at(2024, 3, 1 + i, 2, 0), "Sam", "up"));
    owl.push(msg(at(2024, 3, 6, 14, 0), "Sam", "day"));
    for (let i = 0; i < 6; i++) owl.push(msg(at(2024, 3, 1 + i, 15, 0), "Alex", "hi"));
    const n = nightOwl(owl);
    expect(n.topAuthor).toBe("Sam");
    expect(n.topAuthorShare).toBeCloseTo(5 / 6);
  });

  it("finds the longest silence", () => {
    const s = longestSilence(fixture);
    // Largest gap is 9:10 → 02:00 next day = 16h50m.
    expect(s.ms).toBe(at(2024, 1, 2, 2, 0) - at(2024, 1, 1, 9, 10));
    expect(s.start).toBe(at(2024, 1, 1, 9, 10));
    expect(s.end).toBe(at(2024, 1, 2, 2, 0));
  });

  it("computes average message length", () => {
    const m: Message[] = [msg(1, "A", "abcd"), msg(2, "A", "ab")];
    expect(avgMessageLength(m)).toBe(3);
  });

  it("argmax returns -1 for an all-zero histogram", () => {
    expect(argmax([0, 0, 0])).toBe(-1);
    expect(argmax([1, 3, 2])).toBe(1);
  });

  it("authors lists distinct names in first-seen order", () => {
    expect(authors(fixture)).toEqual(["Alex", "Sam"]);
  });

  it("handles empty input gracefully", () => {
    expect(dateRange([])).toBeNull();
    expect(perPersonCounts([])).toEqual([]);
    expect(busiestHour([])).toBe(-1);
    expect(longestStreak([]).length).toBe(0);
    expect(longestSilence([]).ms).toBe(0);
    expect(avgMessageLength([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sample data round-trips through the real parser + stats
// ---------------------------------------------------------------------------

describe("sample data", () => {
  it("parses into a usable conversation", () => {
    const { format, messages } = detectAndParse(sampleWhatsAppExport(), "sample.txt");
    expect(format).toBe("whatsapp");
    expect(messages.length).toBeGreaterThan(100);
    expect(authors(messages).sort()).toEqual(["Alex", "Sam"]);
  });

  it("computeWrapped produces a complete, sane bundle", () => {
    const { messages } = detectAndParse(sampleWhatsAppExport(), "sample.txt");
    const w = computeWrapped(messages);
    expect(w.total).toBe(messages.length);
    expect(w.range).not.toBeNull();
    expect(w.perPerson.length).toBe(2);
    expect(w.busiestHour).toBeGreaterThanOrEqual(0);
    expect(w.streak.length).toBeGreaterThanOrEqual(1);
    expect(w.silence.ms).toBeGreaterThan(0);
    expect(w.initiations.total).toBeGreaterThan(1);
  });
});

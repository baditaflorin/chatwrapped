// A deterministic synthetic conversation so the app works on first load and is
// demoable/testable without a real export. Rendered as a WhatsApp-style .txt so
// it also exercises the WhatsApp parser end-to-end.

/** A small, plausible two-person chat spanning a few months. */
export function sampleWhatsAppExport(): string {
  const lines: string[] = [];
  const people = ["Alex", "Sam"];

  // Deterministic PRNG (mulberry32) so the sample never changes between loads.
  let s = 0x1234abcd >>> 0;
  const rnd = (): number => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const openers = [
    "morning ☀️ coffee?",
    "you up? 🦉",
    "did you see that link I sent",
    "okay so hear me out",
    "lunch plan??",
    "guess what happened today",
    "random thought 💭",
    "can't sleep lol",
  ];
  const replies = [
    "haha yes 😂",
    "omg no way",
    "on my way",
    "give me 5 min",
    "that is so true",
    "I love that idea ❤️",
    "ugh same",
    "sounds good 👍",
    "let's do it 🎉",
    "tell me everything",
    "🤣🤣🤣",
    "okay deal",
  ];

  const pad = (n: number): string => String(n).padStart(2, "0");
  const fmt = (d: Date): string =>
    `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;

  // ~110 days, most days have a burst of messages; a couple of gaps create a
  // believable "longest silence" and break the streak.
  const start = new Date(2024, 0, 5, 8, 0, 0);
  let day = 0;
  while (day < 110) {
    // Two deliberate silences (skip several days).
    if (day === 40) day += 9;
    if (day === 80) day += 4;

    const skip = rnd() < 0.12; // a few quiet days
    if (!skip) {
      const burst = 2 + Math.floor(rnd() * 7);
      // Random hour, biased so Sam often messages late at night (night owl).
      let starter = rnd() < 0.6 ? 0 : 1; // Alex starts more often (first-texter)
      const date = new Date(start.getTime());
      date.setDate(start.getDate() + day);
      const lateOwl = starter === 1 && rnd() < 0.5;
      date.setHours(lateOwl ? Math.floor(rnd() * 5) : 8 + Math.floor(rnd() * 13));
      date.setMinutes(Math.floor(rnd() * 60));
      date.setSeconds(Math.floor(rnd() * 60));

      lines.push(`${fmt(date)} ${people[starter]}: ${openers[Math.floor(rnd() * openers.length)]}`);
      // a multi-line message to exercise continuation handling
      if (rnd() < 0.2) lines.push("...and another thing");

      let t = date.getTime();
      for (let i = 1; i < burst; i++) {
        starter = 1 - starter;
        t += (1 + Math.floor(rnd() * 9)) * 60_000;
        const who = people[starter];
        lines.push(`${fmt(new Date(t))} ${who}: ${replies[Math.floor(rnd() * replies.length)]}`);
      }
    }
    day++;
  }

  // System lines that must be skipped.
  lines.unshift("[2024-01-05, 07:59:59] Messages and calls are end-to-end encrypted.");
  lines.push("[2024-04-30, 22:00:00] Sam: <Media omitted>");

  return lines.join("\n");
}

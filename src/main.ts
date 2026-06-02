// Thin DOM wiring over the pure parse/stats modules.
//
// PRIVACY: the only way data enters this module is FileReader (local) or the
// in-memory sample generator. There is no fetch/XHR/WebSocket/sendBeacon, and
// html-to-image rasterises an existing DOM node entirely client-side. Nothing
// the user drops is ever sent anywhere.

import { toPng } from "html-to-image";
import { detectAndParse } from "./parse";
import { computeWrapped, WEEKDAYS, type WrappedStats } from "./stats";
import { sampleWhatsAppExport } from "./sample";
import type { Message, SourceFormat } from "./types";
import {
  formatCount,
  formatDate,
  formatDuration,
  formatHour,
  formatPercent,
  formatRange,
} from "./format";

// ---- DOM helpers ----------------------------------------------------------
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function div(className: string, html?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  if (html != null) d.innerHTML = html;
  return d;
}

/** Escape user-derived text before it touches innerHTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const intro = el<HTMLElement>("intro");
const results = el<HTMLElement>("results");
const grid = el<HTMLElement>("stat-grid");
const toastEl = el<HTMLElement>("toast");

function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 2200);
}

const FORMAT_LABEL: Record<SourceFormat, string> = {
  whatsapp: "WhatsApp export",
  telegram: "Telegram export",
  generic: "generic transcript",
};

// ---- stat card rendering --------------------------------------------------

function statCard(label: string, value: string, sub = "", wide = false): HTMLElement {
  const card = div(`stat${wide ? " wide" : ""}`);
  card.appendChild(div("stat-label", esc(label)));
  card.appendChild(div("stat-value", value));
  if (sub) card.appendChild(div("stat-sub", sub));
  return card;
}

function renderStats(stats: WrappedStats, format: SourceFormat): void {
  grid.replaceChildren();

  // 1. Total messages + range.
  const rangeStr = stats.range
    ? `${formatDate(stats.range.start)} → ${formatDate(stats.range.end)} · ${stats.range.days} days`
    : "";
  grid.appendChild(statCard("Total messages", formatCount(stats.total), rangeStr));

  // 2. Per-person split with bars (wide).
  const split = div("stat wide");
  split.appendChild(div("stat-label", "Who said more"));
  const bars = div("bars");
  for (const p of stats.perPerson) {
    const row = div("bar-row");
    row.appendChild(
      div(
        "bar-head",
        `<span><b>${esc(p.author)}</b></span><span>${formatCount(p.count)} · ${formatPercent(p.share)}</span>`,
      ),
    );
    const track = div("bar-track");
    const fill = div("bar-fill");
    fill.style.width = `${Math.max(2, Math.round(p.share * 100))}%`;
    track.appendChild(fill);
    row.appendChild(track);
    bars.appendChild(row);
  }
  split.appendChild(bars);
  grid.appendChild(split);

  // 3. Who texts first.
  const init = stats.initiations;
  grid.appendChild(
    statCard(
      "Texts first",
      init.topAuthor ? esc(init.topAuthor) : "—",
      init.topAuthor
        ? `started ${formatCount(init.byAuthor[init.topAuthor] ?? 0)} of ${formatCount(init.total)} convos`
        : "",
    ),
  );

  // 4. Busiest hour.
  grid.appendChild(
    statCard("Busiest hour", formatHour(stats.busiestHour), "most messages of the day"),
  );

  // 5. Busiest day of week.
  grid.appendChild(
    statCard(
      "Busiest day",
      stats.busiestWeekday >= 0 ? (WEEKDAYS[stats.busiestWeekday] ?? "—") : "—",
      "favourite weekday",
    ),
  );

  // 6. Longest streak.
  grid.appendChild(
    statCard(
      "Longest streak",
      `${formatCount(stats.streak.length)} ${stats.streak.length === 1 ? "day" : "days"}`,
      stats.streak.startDay
        ? `${formatDate(stats.streak.startDay)} → ${formatDate(stats.streak.endDay!)}`
        : "consecutive days chatting",
    ),
  );

  // 7. Average message length.
  grid.appendChild(
    statCard("Avg message", `${Math.round(stats.avgLength)}`, "characters per message"),
  );

  // 8. Night owl.
  const owl = stats.nightOwl;
  grid.appendChild(
    statCard(
      "Night owl 🦉",
      formatPercent(owl.share),
      owl.topAuthor
        ? `of all texts are 12–6am · ${esc(owl.topAuthor)} most (${formatPercent(owl.topAuthorShare)})`
        : "of all texts are sent 12–6am",
    ),
  );

  // 9. Longest silence.
  grid.appendChild(
    statCard(
      "Longest silence",
      formatDuration(stats.silence.ms),
      stats.silence.start
        ? `${formatDate(stats.silence.start)} → ${formatDate(stats.silence.end!)}`
        : "biggest gap between texts",
    ),
  );

  // 10. Top emoji (wide chips).
  if (stats.topEmoji.length) {
    const e = div("stat wide");
    e.appendChild(div("stat-label", "Top emoji"));
    const chips = div("chips");
    for (const item of stats.topEmoji.slice(0, 8)) {
      chips.appendChild(
        div("chip", `<span class="emoji-big">${esc(item.emoji)}</span><b>${item.count}</b>`),
      );
    }
    e.appendChild(chips);
    grid.appendChild(e);
  }

  // 11. Top words (wide chips).
  if (stats.topWords.length) {
    const w = div("stat wide");
    w.appendChild(div("stat-label", "Top words"));
    const chips = div("chips");
    for (const item of stats.topWords.slice(0, 12)) {
      chips.appendChild(div("chip", `${esc(item.word)}<b>${item.count}</b>`));
    }
    w.appendChild(chips);
    grid.appendChild(w);
  }

  // Header + meta.
  el<HTMLElement>("card-range").textContent = stats.range
    ? formatRange(stats.range.start, stats.range.end)
    : "";
  const people = stats.perPerson.map((p) => p.author).join(" & ");
  el<HTMLElement>("results-meta").textContent =
    `${people || "—"} · ${formatCount(stats.total)} messages · parsed from ${FORMAT_LABEL[format]}`;
}

// ---- flow ------------------------------------------------------------------

function showResults(messages: Message[], format: SourceFormat): void {
  if (!messages.length) {
    toast("Couldn't find any messages in that file 🤔");
    return;
  }
  const stats = computeWrapped(messages);
  renderStats(stats, format);
  intro.hidden = true;
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleRaw(raw: string, filename: string): void {
  try {
    const { messages, format } = detectAndParse(raw, filename);
    showResults(messages, format);
  } catch (err) {
    console.error(err);
    toast("Something went wrong parsing that file.");
  }
}

function handleFile(file: File): void {
  // FileReader is local-only — the file is read off disk into memory, never
  // uploaded.
  const reader = new FileReader();
  reader.onload = () => handleRaw(String(reader.result ?? ""), file.name);
  reader.onerror = () => toast("Couldn't read that file.");
  reader.readAsText(file);
}

function reset(): void {
  results.hidden = true;
  intro.hidden = false;
  grid.replaceChildren();
  el<HTMLInputElement>("file").value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- wiring ----------------------------------------------------------------

function wire(): void {
  const dropzone = el<HTMLElement>("dropzone");
  const fileInput = el<HTMLInputElement>("file");

  const openPicker = (): void => fileInput.click();
  dropzone.addEventListener("click", openPicker);
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  el("pick").addEventListener("click", openPicker);

  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
  });

  // Drag & drop.
  const stop = (e: DragEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      stop(e as DragEvent);
      dropzone.classList.add("drag");
    }),
  );
  ["dragleave", "dragend"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      stop(e as DragEvent);
      dropzone.classList.remove("drag");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    stop(e as DragEvent);
    dropzone.classList.remove("drag");
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  // Stop the browser from navigating if a file is dropped outside the zone.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  el("sample").addEventListener("click", () => {
    handleRaw(sampleWhatsAppExport(), "sample-chat.txt");
    toast("Loaded a synthetic sample chat ✨");
  });

  el("reset").addEventListener("click", reset);

  el("export-png").addEventListener("click", async () => {
    const card = el<HTMLElement>("card");
    try {
      const dataUrl = await toPng(card, {
        pixelRatio: 2,
        backgroundColor: "#0f0c1c",
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "chatwrapped.png";
      a.click();
      toast("Saved your wrapped card 📸");
    } catch (err) {
      console.error(err);
      toast("Couldn't export the image.");
    }
  });

  el<HTMLElement>("version").textContent = `v${__APP_VERSION__} · ${__GIT_COMMIT__}`;
}

wire();

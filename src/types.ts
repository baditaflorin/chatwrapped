// Shared, DOM-free data model for the whole app.
//
// A chat export of any supported format is normalised into a flat list of
// `Message`s. Every stat function operates only on `Message[]`, which keeps the
// analytics layer pure and trivially unit-testable.

export interface Message {
  /** Unix timestamp in milliseconds. */
  ts: number;
  /** Sender display name, trimmed. */
  author: string;
  /** Message body (continuation lines joined with "\n"). */
  text: string;
}

/** Which parser produced a `Message[]`, surfaced in the UI for transparency. */
export type SourceFormat = "whatsapp" | "telegram" | "generic";

export interface ParseResult {
  format: SourceFormat;
  messages: Message[];
}

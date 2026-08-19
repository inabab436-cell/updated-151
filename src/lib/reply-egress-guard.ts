/**
 * CONTENT-DERIVED EGRESS GUARD (root-cause layer).
 *
 * Every previous leak fix was SHAPE based: a list of headings, delimiters,
 * tags or vocabulary. That approach can only ever block the leak types we
 * already saw — a new internal section, a new delimiter, a new knowledge
 * block or a new tool result immediately produces a brand-new leak type.
 *
 * This layer is different: it does not know or care what the internal text
 * looks like. It receives the EXACT internal material that was injected into
 * the model for this turn (system prompt, fresh store snapshot, knowledge
 * base, payment configuration, tool results, internal hints) and removes from
 * the customer-facing reply anything that is a verbatim copy of it.
 *
 * Because the index is built from the real injected content, it automatically
 * covers every future internal section without any code change.
 *
 * Deliberately conservative so legitimate answers survive:
 *  - only WHOLE lines that are verbatim copies of an internal line are
 *    dropped (a paraphrased store fact is never a whole-line exact copy),
 *  - long digit sequences (phone numbers, ids) that exist only in internal
 *    material — never in what the customer wrote and not explicitly allowed
 *    — are removed with their sentence.
 */

export interface InternalContextIndex {
  /** Every internal line/segment, normalised. */
  lines: Set<string>;
  /**
   * Structured internal lines (key: value, pipe-separated records, long
   * blocks, bracketed tags). A single verbatim copy of one of these is always
   * a leak — no legitimate reply reproduces a configuration record.
   */
  structured: Set<string>;
  digits: Set<string>;
}

const MIN_LINE_LEN = 12;
const MIN_DIGITS = 7;

/** Normalises text so formatting differences cannot bypass the comparison. */
export function normalizeForLeakCheck(input: string): string {
  return String(input ?? "")
    .replace(/[\u064B-\u0652\u0640]/g, "") // Arabic diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function digitRuns(text: string): string[] {
  return (String(text ?? "").match(/\d[\d\s\-()]{5,}\d/g) ?? [])
    .map((m) => m.replace(/\D/g, ""))
    .filter((d) => d.length >= MIN_DIGITS);
}

/**
 * Builds the leak index from the internal material of THIS turn.
 *
 * @param internalSources every internal string handed to the model
 * @param allowed        text that is legitimately customer-facing this turn
 *                       (e.g. the merchant's own order-confirmation wording)
 *                       plus everything the customer themselves wrote
 */
export function buildInternalContextIndex(
  internalSources: Array<string | null | undefined>,
  allowed: Array<string | null | undefined> = [],
): InternalContextIndex {
  const lines = new Set<string>();
  const structured = new Set<string>();
  const digits = new Set<string>();

  for (const src of internalSources) {
    const text = String(src ?? "");
    if (!text.trim()) continue;
    for (const rawLine of text.split(/\r?\n/)) {
      // Index the whole line and its pipe/semicolon separated segments so a
      // single copied field is caught as well as a copied line.
      const isStructured =
        /[|:：]/.test(rawLine) ||
        /^\s*[-*•]/.test(rawLine) ||
        /[\[\]<>{}]/.test(rawLine) ||
        rawLine.trim().length >= 40;
      for (const piece of [rawLine, ...rawLine.split(/[|؛;•]/)]) {
        const norm = normalizeForLeakCheck(piece);
        if (norm.length >= MIN_LINE_LEN) {
          lines.add(norm);
          if (isStructured) structured.add(norm);
        }
      }
    }
    for (const d of digitRuns(text)) digits.add(d);
  }

  for (const ok of allowed) {
    const text = String(ok ?? "");
    if (!text.trim()) continue;
    for (const rawLine of text.split(/\r?\n/)) {
      const norm = normalizeForLeakCheck(rawLine);
      if (norm) {
        lines.delete(norm);
        structured.delete(norm);
      }
      for (const piece of rawLine.split(/[|؛;•]/)) {
        const p = normalizeForLeakCheck(piece);
        if (p) {
          lines.delete(p);
          structured.delete(p);
        }
      }
    }
    for (const d of digitRuns(text)) digits.delete(d);
  }

  return { lines, structured, digits };
}

function splitSentences(line: string): string[] {
  return line.match(/[^.؟?!\n]*[.؟?!]+|[^.؟?!\n]+/g) ?? [line];
}

/**
 * Removes from `reply` everything that is a verbatim copy of internal
 * material. Never returns an empty string when the reply had content.
 */
export function scrubInternalContextLeaks(
  reply: string,
  index: InternalContextIndex,
): string {
  const original = String(reply ?? "");
  if (!original.trim()) return "";

  const rawLines = original.split(/\r?\n/);
  // A single plain fact stated verbatim is normal service; two or more
  // verbatim internal lines in one reply is a dump of internal material.
  const plainMatches = rawLines.filter((l) => {
    const n = normalizeForLeakCheck(l);
    return n.length >= MIN_LINE_LEN && index.lines.has(n);
  }).length;

  const keptLines: string[] = [];
  for (const line of rawLines) {
    const norm = normalizeForLeakCheck(line);
    if (norm.length >= MIN_LINE_LEN && index.lines.has(norm)) {
      if (index.structured.has(norm) || plainMatches >= 2) continue;
    }

    // Sentence-level pass for internal-only phone numbers / identifiers.
    let out = line;
    if (index.digits.size > 0 && /\d/.test(line)) {
      const sentences = splitSentences(line);
      out = sentences
        .filter((s) => {
          const runs = digitRuns(s);
          return !runs.some((d) => index.digits.has(d));
        })
        .join("")
        .trim();
      // A bare fragment carrying only an internal number disappears entirely.
      if (!out && sentences.length === 1) continue;
    }
    keptLines.push(out);
  }

  const cleaned = keptLines
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

/** Convenience: index + scrub in one call. */
export function scrubAgainstInternalContext(
  reply: string,
  internalSources: Array<string | null | undefined>,
  allowed: Array<string | null | undefined> = [],
): string {
  return scrubInternalContextLeaks(reply, buildInternalContextIndex(internalSources, allowed));
}

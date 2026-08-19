/**
 * Truncate a string on full Unicode code-point boundaries instead of raw
 * UTF-16 code units, so emoji / surrogate pairs and combining sequences
 * are never split mid-character (which would otherwise produce a broken
 * replacement character in the output).
 */
export function safeSlice(text: string, start: number, end: number): string {
  if (text == null) return "";
  const chars = Array.from(String(text));
  return chars.slice(start, end).join("");
}

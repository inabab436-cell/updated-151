/**
 * MISSING INFORMATION STATUS — what THIS conversation is still waiting for.
 *
 * Pure function (no network, no database). The chat route loads the topics
 * this conversation asked about and renders them here, so the agent:
 *   - never stops the conversation because one fact is missing,
 *   - knows exactly which question is still unanswered by the brand owner,
 *   - answers a repeated ask with "الإدارة لسه ما ردتش" instead of guessing,
 *   - treats an answered topic as CONFIRMED store knowledge.
 */

export interface MissingInfoStatusRow {
  question: string;
  product?: string | null;
  field?: string | null;
  status: string;
  /** Title of the knowledge the brand owner added (any interface). */
  resolvedTitle?: string | null;
  /** The answer itself — confirmed data, may be used with the customer. */
  resolvedAnswer?: string | null;
}

export const MISSING_INFO_STATUS_HEADING = "MISSING INFORMATION STATUS";

function line(r: MissingInfoStatusRow): string {
  const head = `- "${r.question}"${r.product ? ` (المنتج: ${r.product})` : ""}${
    r.field ? ` [${r.field}]` : ""
  }`;
  if (r.status === "resolved") {
    const answer = (r.resolvedAnswer ?? "").trim();
    return (
      `${head} — تم الرد من الإدارة${r.resolvedTitle ? ` (${r.resolvedTitle})` : ""}: ` +
      `${answer || "المعلومة أصبحت مضافة في بيانات المتجر بالأعلى."}`
    );
  }
  return `${head} — لسه الإدارة ما ردتش على المعلومة دي.`;
}

export function buildMissingInfoStatusBlock(rows: MissingInfoStatusRow[]): string {
  if (!rows.length) return "";
  return (
    `\n\n${MISSING_INFO_STATUS_HEADING} (خاص بهذه المحادثة فقط):\n` +
    rows.map(line).join("\n") +
    "\n\nقواعد ملزمة:\n" +
    "- نقص أي معلومة لا يوقف المحادثة أبدًا. كمّل عادي وساعد العميل في كل حاجة تانية تقدر تجاوب عليها.\n" +
    "- لو العميل سأل تاني عن معلومة لسه الإدارة ما ردتش عليها: قول له بصراحة ولطف إنك سألت الإدارة ولسه مافيش رد، وإنك هتبلّغه أول ما يوصلك، وما تخترعش إجابة وما تكررش الإبلاغ عنها.\n" +
    "- أي معلومة مكتوب جنبها «تم الرد من الإدارة» هي معلومة مؤكَّدة من صاحب البراند: استخدمها فورًا مع العميل زي أي بيانات المتجر.\n"
  );
}

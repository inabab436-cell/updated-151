/**
 * IMMEDIATE IDENTITY INTAKE VALIDATION
 * ====================================
 *
 * The three identity fields (name / phone / address) used to be validated only
 * at `create_order` time, so a one-word name or a 10-digit phone surfaced as a
 * surprise question AFTER the customer had already approved the whole order.
 *
 * This module turns the same deterministic rules (see
 * `order-input-validation.ts`) into a per-turn check: the moment a value is
 * understood from the customer, it is validated, and the agent is told to fix
 * it in the very same turn — before moving on to any next step.
 *
 * Pure module: no database, no literal keyword matching on the customer's
 * wording. It only inspects the field values themselves.
 */
import {
  validateAddress,
  validateCustomerName,
  validateEgyptianPhone,
} from "@/lib/order-input-validation";

export type IdentityField = "name" | "phone" | "address";

export interface IdentityIssue {
  field: IdentityField;
  /** Machine-readable reason from the shared validators. */
  reason: string;
  /** What is still missing inside an address (governorate / area / street). */
  missing?: string[];
  /** Arabic instruction telling the agent exactly what to ask for now. */
  ask: string;
  /** The raw value that was checked (used to word the correction precisely). */
  value?: string;
}

export interface IdentityCandidates {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
}

const ADDRESS_PART_LABEL: Record<string, string> = {
  governorate: "المحافظة",
  area: "المنطقة أو الحي",
  street_or_landmark: "الشارع أو علامة مميزة واضحة",
};

function nameAsk(reason: string): string {
  if (reason === "contains_digits" || reason === "contains_symbols") {
    return "الاسم اللي وصلك فيه أرقام أو رموز. اطلب من العميل الاسم الحقيقي بحروف فقط (اسم ثنائي على الأقل) دلوقتي، بأسلوب ودود وبدون أي كلام عن خطأ أو سيستم.";
  }
  if (reason === "too_many_words") {
    return "الاسم اللي وصلك طويل جدًا. اطلب الاسم في صورة اسم ثنائي أو ثلاثي فقط دلوقتي، بلطف وبدون لوم العميل.";
  }
  return "الاسم اللي وصلك كلمة واحدة بس. اطلب الاسم بالكامل (اسم أول واسم تاني على الأقل) دلوقتي قبل أي خطوة تانية، بصيغة إنسانية بسيطة.";
}

/** The four real Egyptian mobile prefixes, used only to word the correction. */
const REAL_PREFIXES = ["010", "011", "012", "015"];

/**
 * Reduces the number to its local `01…` form and says WHICH properties are
 * wrong. When more than one thing is wrong at the same time, the correction
 * stays generic instead of listing every reason.
 */
function analyzePhoneProblems(raw: string): {
  badPrefix: boolean;
  tooShort: boolean;
  tooLong: boolean;
  missingDigits: number;
  count: number;
} {
  let d = String(raw ?? "")
    .replace(/[٠-٩]/g, (ch) => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)))
    .replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length >= 12) d = d.slice(2);
  if (/^1[0-9]/.test(d)) d = `0${d}`;

  const badPrefix = d.startsWith("01") ? !REAL_PREFIXES.some((p) => d.startsWith(p)) : true;
  const tooShort = d.length > 0 && d.length < 11;
  const tooLong = d.length > 11;
  return {
    badPrefix,
    tooShort,
    tooLong,
    missingDigits: tooShort ? 11 - d.length : 0,
    count: [badPrefix, tooShort, tooLong].filter(Boolean).length,
  };
}

function phoneAsk(reason: string, value: string): string {
  const problems = analyzePhoneProblems(value);
  if (reason === "dummy") {
    return "رقم التليفون اللي وصلك شكله مش حقيقي. اطلب رقم للتواصل صحيح دلوقتي بلطف من غير ما تتهم العميل.";
  }
  if (problems.count === 1 && problems.badPrefix) {
    return "الرقم اللي وصلك بدايته مش من بدايات أرقام الموبايل المصرية. قول للعميل الغلط ده مباشرة بجملة قصيرة وودودة (إن بداية الرقم مش مظبوطة) من غير ما يسأل، واطلب منه الرقم الصحيح، ومتصححش الرقم من عندك.";
  }
  if (problems.count === 1 && problems.tooShort) {
    if (problems.missingDigits === 1) {
      return "الرقم اللي وصلك ناقص خانة واحدة. قول للعميل بشكل مباشر وودود إن الرقم ناقص، واطلب منه يبعت الرقم كامل، ومتكملش الرقم من عندك.";
    }
    return "الرقم اللي وصلك ناقص أكتر من خانة. قول للعميل بشكل عام وطبيعي إن الرقم ناقص أو مش كامل، من غير ما تحدد عدد الخانات الناقصة، واطلب منه يبعت الرقم كامل.";
  }
  if (problems.count === 1 && problems.tooLong) {
    return "الرقم اللي وصلك فيه رقم زيادة. قول للعميل الغلط ده مباشرة بجملة قصيرة وودودة (إن فيه رقم زيادة) من غير ما يسأل، واطلب منه الرقم الصحيح، ومتصححش الرقم من عندك.";
  }
  return "الرقم اللي وصلك فيه أكتر من حاجة غلط. قول بس إن الرقم مش مظبوط واطلب الرقم الصحيح بأسلوب ودود مختصر، من غير ما تفصّل الأسباب كلها.";
}

/**
 * Customer-facing correction used as a deterministic final reply guard.
 *
 * When exactly ONE thing is wrong (only the prefix, or only the digit count),
 * the reply names that mistake straight away — the customer should not have to
 * ask what is wrong. When several things are wrong together, it only says the
 * number is not right and asks for the correct one. The phrasing is picked
 * from a pool so the same sentence is not repeated verbatim every time (an
 * optional `avoid` value keeps it different from the last one).
 */
const PHONE_DUMMY_REPLIES = [
  "الرقم ده شكله مش رقم تواصل حقيقي يا فندم، ياريت حضرتك تبعت رقم نتواصل بيه.",
  "محتاج رقم تواصل فعلي يا فندم عشان نقدر نوصلك، ياريت حضرتك تبعته.",
  "الرقم ده مش هينفع للتواصل يا فندم، ممكن حضرتك تبعت رقمك الصحيح؟",
];

const PHONE_BAD_PREFIX_REPLIES = [
  "بداية الرقم مش مظبوطة يا فندم، ياريت حضرتك تبعت رقم الموبايل الصحيح.",
  "الرقم بدايته غريبة شوية يا فندم، ممكن حضرتك تراجعها وتبعت الرقم تاني؟",
  "يظهر إن بداية الرقم فيها غلط يا فندم، ياريت حضرتك تبعته صح.",
];

const PHONE_ONE_DIGIT_SHORT_REPLIES = [
  "الرقم ناقص رقم يا فندم، ياريت حضرتك تبعته كامل.",
  "واضح إن الرقم ناقص رقم يا فندم، ممكن حضرتك تبعته كامل؟",
];

const PHONE_TOO_SHORT_REPLIES = [
  "الرقم ناقص يا فندم، ياريت حضرتك تبعته كامل.",
  "الرقم مش كامل يا فندم، ياريت حضرتك تكمّله وتبعته.",
  "واضح إن الرقم مش كامل يا فندم، ممكن حضرتك تبعته تاني؟",
];

const PHONE_TOO_LONG_REPLIES = [
  "الرقم فيه رقم زيادة يا فندم، ياريت حضرتك تراجعه وتبعته تاني.",
  "شكل الرقم زايد عن كده يا فندم، ممكن حضرتك تتأكد منه وتبعته؟",
  "الرقم فيه رقم زيادة يا فندم، ياريت حضرتك تبعته صح.",
];

const PHONE_GENERIC_REPLIES = [
  "الرقم فيه خطأ يا فندم، ياريت حضرتك تبعته تاني.",
  "الرقم مش مظبوط يا فندم، ياريت حضرتك تتأكد منه وتبعته.",
  "واضح إن الرقم مكتوب غلط يا فندم، ممكن حضرتك تراجعه وتبعته تاني؟",
  "معلش يا فندم الرقم شكله مش صح، ياريت حضرتك تبعته تاني.",
];

function pickReply(pool: string[], avoid?: string | null): string {
  const options = pool.filter((option) => option !== (avoid ?? "").trim());
  const list = options.length > 0 ? options : pool;
  return list[Math.floor(Math.random() * list.length)] ?? pool[0] ?? "الرقم مش مظبوط يا فندم، ياريت حضرتك تبعته تاني.";
}

export function buildPhoneCorrectionReply(
  reason: string,
  avoid?: string | null,
  value?: string | null,
): string {
  if (reason === "dummy") return pickReply(PHONE_DUMMY_REPLIES, avoid);

  // Prefer the value itself: it tells whether ONE thing is wrong or several.
  const problems = value ? analyzePhoneProblems(value) : null;
  if (problems && problems.count === 1) {
    if (problems.badPrefix) return pickReply(PHONE_BAD_PREFIX_REPLIES, avoid);
    if (problems.tooShort) {
      const pool = problems.missingDigits === 1
        ? PHONE_ONE_DIGIT_SHORT_REPLIES
        : PHONE_TOO_SHORT_REPLIES;
      return pickReply(pool, avoid);
    }
    if (problems.tooLong) return pickReply(PHONE_TOO_LONG_REPLIES, avoid);
  }
  if (!problems) {
    // No raw value available — fall back to the single reason we were given.
    if (reason === "bad_prefix") return pickReply(PHONE_BAD_PREFIX_REPLIES, avoid);
    if (reason === "too_short") return pickReply(PHONE_TOO_SHORT_REPLIES, avoid);
    if (reason === "too_long") return pickReply(PHONE_TOO_LONG_REPLIES, avoid);
  }
  return pickReply(PHONE_GENERIC_REPLIES, avoid);
}



/**
 * Validates every identity value understood so far. Only fields that actually
 * carry a value are checked — a field the customer has not given yet belongs
 * to the normal collection flow, not to this correction path.
 */
export function checkIdentityIntake(candidates: IdentityCandidates): IdentityIssue[] {
  const issues: IdentityIssue[] = [];

  const name = String(candidates.name ?? "").trim();
  if (name) {
    const check = validateCustomerName(name);
    if (!check.ok) {
      issues.push({ field: "name", reason: check.reason ?? "invalid", ask: nameAsk(check.reason ?? "") });
    }
  }

  const phone = String(candidates.phone ?? "").trim();
  if (phone) {
    const check = validateEgyptianPhone(phone);
    if (!check.ok) {
      issues.push({
        field: "phone",
        reason: check.reason ?? "invalid",
        value: phone,
        ask: phoneAsk(check.reason ?? "", phone),
      });
    }
  }

  const address = String(candidates.address ?? "").trim();
  if (address) {
    const check = validateAddress(address);
    if (!check.ok) {
      const parts = (check.missing ?? []).map((m) => ADDRESS_PART_LABEL[m] ?? m);
      issues.push({
        field: "address",
        reason: check.reason ?? "incomplete_address",
        missing: check.missing,
        ask:
          `العنوان المُستلم غير مفصّل بما يكفي للتوصيل. اطلب الآن الناقص فقط: ${parts.join(" + ")}` +
          " — ولا تطلب العنوان كله من جديد، ورقم العمارة والدور اختياريان.",
      });
    }
  }

  return issues;
}

/**
 * Prompt block appended next to the trusted instructions. It carries no
 * customer text — only field names and what must be asked — so it cannot be
 * used as an injection surface.
 */
export function buildIdentityIntakeBlock(issues: IdentityIssue[]): string {
  if (!issues.length) return "";
  const lines = [
    "\n\nتحقّق فوري من بيانات العميل (إلزامي — أعلى أولوية في هذا الدور):",
    "البيانات التالية استُلمت من العميل لكنها غير مكتملة أو غير صحيحة. اطلب تصحيحها في ردّك الحالي فورًا، قبل الانتقال لأي خطوة تالية في الطلب، وقبل أي ملخص أو طلب تأكيد. لا تؤجل أي منها للنهاية.",
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.ask}`);
  }
  lines.push(
    "اطلب عنصرًا ناقصًا واحدًا في كل رسالة بأسلوب طبيعي ومهذّب، ولا تخترع أو تكمّل أي قيمة من عندك.",
    "ممنوع تكرار نفس الجملة أكثر من مرة. لو العميل سأل عن سبب المشكلة أو استفسر \"في إيه؟\"، جاوبه فورًا بسبب مختصر وبشري وودود (مثل إن الرقم ناقص أو مش كامل، أو فيه رقم زيادة، أو بدايته مش شكل أرقام الموبايل المعروفة) بجملة واحدة قصيرة من غير سرد قواعد أو تعليمات، وبعدها اطلب الرقم تاني بصياغة جديدة مختلفة عن اللي قبلها. متقولش ناقص رقم إلا لو الناقص خانة واحدة فعلًا.",
    "الصياغة لازم تبان من موظف حقيقي: لو أنت اللي نسيت تسأل أو غلطت، اعترف ببساطة (\"معلش أنا نسيت أسأل حضرتك عن كذا\"). ولو العميل هو اللي ماذكرش الحاجة دي أصلًا، قول كده بلطف (\"حضرتك لسه ماقلتيش كذا، ممكن تفيديني بيه؟\") من غير ما تنسبها لنفسك.",
    "ممنوع تمامًا أي كلام عن سيستم أو خطأ تقني أو التباس أو مشكلة في النظام — الكلام ده بيخلي العميل يحس إنه بيكلم روبوت.",
  );

  return lines.join("\n");
}

/**
 * Deterministic phone candidate detection for the CURRENT message.
 *
 * The identity block used to depend only on the AI field extraction, so a turn
 * where the extractor returned nothing (long conversations, many retries) left
 * the number completely unvalidated and the agent could call an impossible
 * number "correct". This function does not look at wording at all: it only
 * inspects digit runs and keeps the ones shaped like an attempt at an Egyptian
 * mobile number, so the structural check always runs.
 */
export function extractPhoneCandidate(text: string): string | null {
  const normalized = String(text ?? "")
    .replace(/[٠-٩]/g, (ch) => String("٠١٢٣٤٥٦٧٨٩".indexOf(ch)))
    .replace(/[\s\-().+]/g, "");

  const runs = normalized.match(/\d{7,}/g) ?? [];
  for (const run of runs) {
    let d = run;
    if (d.startsWith("0020")) d = d.slice(4);
    else if (d.startsWith("20") && d.length >= 12) d = d.slice(2);
    if (/^1[0-9]/.test(d) && d.length >= 9) d = `0${d}`;
    // Shaped like a mobile attempt: local form starting with 01, of a length
    // that can only be a phone number (never a quantity or an order number).
    if (/^01\d{6,10}$/.test(d)) return d;
  }
  return null;
}

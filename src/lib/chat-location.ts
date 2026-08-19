/**
 * Live location sharing in the customer chat.
 *
 * A shared location travels as a message ATTACHMENT (kind: "location") so it
 * reuses the existing message/attachment pipeline end-to-end: it is stored on
 * the message row, returned by `fetch`, rendered in the chat UI, and — most
 * importantly — described in plain Arabic text inside the model history so the
 * agent can READ it (coordinates, accuracy, map link, live/stopped state, and
 * how fresh the last update is).
 */

export type LocationAttachment = {
  kind: "location";
  /** Google Maps link — also what makes the attachment openable anywhere. */
  url: string;
  lat: number;
  lng: number;
  /** GPS accuracy radius in metres, when the browser reports one. */
  accuracy?: number | null;
  /** Optional human label the customer typed / the browser resolved. */
  label?: string | null;
  /** True while the customer is streaming live updates. */
  live?: boolean;
  /** ISO timestamp of the last coordinate update. */
  updated_at?: string | null;
  /** ISO timestamp after which live updates are considered stopped. */
  expires_at?: string | null;
  source: "customer";
};

/** Default live-sharing window: 15 minutes. */
export const LIVE_LOCATION_DURATION_MS = 15 * 60 * 1000;
/** How often the browser pushes a live coordinate update. */
export const LIVE_LOCATION_UPDATE_MS = 15_000;

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function isLocationAttachment(att: unknown): att is LocationAttachment {
  if (!att || typeof att !== "object") return false;
  const a = att as Record<string, unknown>;
  if (a.kind !== "location") return false;
  return num(a.lat) !== null && num(a.lng) !== null;
}

/**
 * Normalizes anything the client sends into a trusted location attachment.
 * Returns null when the payload is not a usable coordinate pair.
 */
export function sanitizeLocationAttachment(raw: unknown): LocationAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "location") return null;
  const lat = num(o.lat);
  const lng = num(o.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const accuracy = num(o.accuracy);
  const label = typeof o.label === "string" ? o.label.slice(0, 200) : null;
  const updatedAt =
    typeof o.updated_at === "string" && o.updated_at ? o.updated_at : new Date().toISOString();
  const live = o.live === true;
  const expiresAt =
    typeof o.expires_at === "string" && o.expires_at
      ? o.expires_at
      : live
        ? new Date(Date.now() + LIVE_LOCATION_DURATION_MS).toISOString()
        : null;
  return {
    kind: "location",
    url: mapsUrl(lat, lng),
    lat,
    lng,
    accuracy: accuracy !== null ? Math.round(accuracy) : null,
    label,
    live,
    updated_at: updatedAt,
    expires_at: expiresAt,
    source: "customer",
  };
}

export function isLiveLocationActive(att: LocationAttachment, now = Date.now()): boolean {
  if (!att.live) return false;
  if (!att.expires_at) return true;
  const t = Date.parse(att.expires_at);
  return Number.isFinite(t) ? t > now : true;
}

function minutesAgo(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/**
 * Arabic, model-readable description of the locations attached to one message.
 * Returns an empty string when there is nothing to describe.
 */
export function describeLocationsForModel(
  attachments: unknown,
  opts: { isLatest?: boolean; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const list = (Array.isArray(attachments) ? attachments : []).filter(isLocationAttachment);
  if (list.length === 0) return "";
  const lines = list.map((a) => {
    const parts = [
      `خط العرض: ${a.lat.toFixed(6)}`,
      `خط الطول: ${a.lng.toFixed(6)}`,
      `رابط الخريطة: ${mapsUrl(a.lat, a.lng)}`,
    ];
    if (a.accuracy != null) parts.push(`دقة التحديد: ±${a.accuracy} متر`);
    if (a.label) parts.push(`وصف العميل للمكان: ${a.label}`);
    const mins = minutesAgo(a.updated_at, now);
    if (isLiveLocationActive(a, now)) {
      parts.push(
        `الحالة: مشاركة موقع حي جارية${mins != null ? ` (آخر تحديث منذ ${mins} دقيقة)` : ""}`,
      );
    } else if (a.live) {
      parts.push("الحالة: مشاركة الموقع الحي انتهت — هذه آخر نقطة مسجلة");
    } else {
      parts.push(`الحالة: موقع لحظي واحد${mins != null ? ` (تم إرساله منذ ${mins} دقيقة)` : ""}`);
    }
    return `- ${parts.join(" | ")}`;
  });
  const header = opts.isLatest
    ? "[موقع العميل الحالي — أرسله العميل بنفسه عبر زر مشاركة الموقع. اعتبره بيانات موثوقة واستخدمه في تحديد منطقة الشحن أو تأكيد العنوان، واسأل العميل عن تفاصيل العنوان الناقصة فقط (رقم العمارة/الشقة/علامة مميزة). لا تذكر الإحداثيات نفسها للعميل إلا إذا طلبها.]"
    : "[موقع أرسله العميل سابقاً في هذه المحادثة — سياق فقط، وقد يكون قديماً.]";
  return `${header}\n${lines.join("\n")}`;
}

/** Short Arabic summary used in the chat UI bubble. */
export function formatLocationSummary(a: LocationAttachment, now = Date.now()): string {
  if (isLiveLocationActive(a, now)) return "موقع حي — يتم التحديث تلقائياً";
  if (a.live) return "انتهت مشاركة الموقع الحي";
  return "الموقع الحالي";
}

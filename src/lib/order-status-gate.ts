/**
 * Single source of truth for the "no fulfilment before payment" rule.
 *
 * An order can only move to prepared / shipped / delivered after its payment
 * has been confirmed (payment_status !== 'pending').
 */
export const PAYMENT_REQUIRED_MESSAGE =
  "لا يمكن بدء تنفيذ الطلب قبل تأكيد الدفع، لضمان عدم تجهيز أو شحن طلب غير مدفوع.";

export function isOrderPaid(paymentStatus: string | null | undefined): boolean {
  return String(paymentStatus ?? "confirmed") !== "pending";
}

export function canStartFulfillment(paymentStatus: string | null | undefined): boolean {
  return isOrderPaid(paymentStatus);
}

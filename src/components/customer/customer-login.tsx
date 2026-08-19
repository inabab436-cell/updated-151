/**
 * Storefront customer login gate — passwordless (Email + 6-digit OTP).
 *
 * This is completely independent of the merchant login UI. It talks only to
 * `requestCustomerOtp` / `verifyCustomerOtp` server functions.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogIn, Mail, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useCountdownTo } from "@/lib/use-countdown";
import {
  getCustomerSession,
  requestCustomerOtp,
  verifyCustomerOtp,
} from "@/lib/customer-auth.functions";
import type {
  CustomerOtpSendResult,
  CustomerOtpVerifyResult,
  CustomerSessionInfo,
} from "@/lib/customer-auth-types";

export function useCustomerSession() {
  const fn = useServerFn(getCustomerSession);
  return useQuery<CustomerSessionInfo>({
    queryKey: ["customer-session"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function CustomerLoginPanel({
  merchantId,
  visitorId,
  brandName,
  onSuccess,
  onCancel,
  themePrimary,
}: {
  merchantId: string;
  visitorId?: string | null;
  brandName?: string;
  onSuccess?: (email: string) => void;
  onCancel?: () => void;
  themePrimary?: string;
}) {
  const qc = useQueryClient();
  const sendFn = useServerFn(requestCustomerOtp);
  const verifyFn = useServerFn(verifyCustomerOtp);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [cooldownTarget, setCooldownTarget] = useState<number | null>(null);
  const [blockTarget, setBlockTarget] = useState<number | null>(null);

  const cooldownRemaining = useCountdownTo(cooldownTarget);
  const blockRemaining = useCountdownTo(blockTarget);
  const isBlocked = blockRemaining > 0;

  function applySend(res: CustomerOtpSendResult) {
    setMessage({ text: res.message, tone: res.ok ? "info" : "error" });
    if (res.retryAfterSeconds && res.retryAfterSeconds > 0) {
      setCooldownTarget(Date.now() + res.retryAfterSeconds * 1000);
    }
    if (res.blockedUntil) setBlockTarget(new Date(res.blockedUntil).getTime());
  }
  function applyVerify(res: CustomerOtpVerifyResult) {
    if (res.ok) {
      setMessage({ text: res.message, tone: "info" });
      qc.invalidateQueries({ queryKey: ["customer-session"] });
      onSuccess?.(res.email ?? email);
      return;
    }
    setMessage({ text: res.message, tone: "error" });
    if (res.blockedUntil) setBlockTarget(new Date(res.blockedUntil).getTime());
  }

  const sendMut = useMutation({
    mutationFn: async () => sendFn({ data: { merchant_id: merchantId, email } }),
    onSuccess: (res) => {
      applySend(res);
      // TEST MODE: no email is sent — complete sign-in immediately.
      if (res.ok && res.testMode && res.devCode) {
        setCode(res.devCode);
        verifyFn({
          data: {
            merchant_id: merchantId,
            email,
            code: res.devCode,
            visitor_id: visitorId ?? null,
          },
        })
          .then(applyVerify)
          .catch((err: unknown) =>
            setMessage({
              text: err instanceof Error ? err.message : "خطأ غير متوقع.",
              tone: "error",
            }),
          );
        return;
      }
      if (res.ok) setStep("code");
    },
    onError: (err) =>
      setMessage({ text: err instanceof Error ? err.message : "خطأ غير متوقع.", tone: "error" }),
  });

  const verifyMut = useMutation({
    mutationFn: async () =>
      verifyFn({
        data: {
          merchant_id: merchantId,
          email,
          code,
          visitor_id: visitorId ?? null,
        },
      }),
    onSuccess: applyVerify,
    onError: (err) =>
      setMessage({ text: err instanceof Error ? err.message : "خطأ غير متوقع.", tone: "error" }),
  });

  const btnStyle: React.CSSProperties | undefined = themePrimary
    ? { background: themePrimary }
    : undefined;

  return (
    <div className="rounded-2xl border bg-background p-5 shadow-elegant" dir="rtl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <LogIn className="h-4 w-4" /> تسجيل الدخول عبر البريد الإلكتروني
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {brandName ? `للمتابعة مع ${brandName}، ` : ""}
            أدخل بريدك الإلكتروني وسنرسل لك رمز تحقق مكوّن من ٦ أرقام.
          </p>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="rounded p-1 hover:bg-muted" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isBlocked || cooldownRemaining > 0 || sendMut.isPending) return;
            sendMut.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="cust-email">البريد الإلكتروني</Label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="cust-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isBlocked || sendMut.isPending}
                className="pr-9"
                placeholder="you@example.com"
              />
            </div>
          </div>
          {message && (
            <div
              className={
                message.tone === "error"
                  ? "text-sm font-medium text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {message.text}
            </div>
          )}
          <Button
            type="submit"
            className="w-full text-white"
            style={btnStyle}
            disabled={isBlocked || cooldownRemaining > 0 || sendMut.isPending || !email}
          >
            {sendMut.isPending
              ? "جارٍ الإرسال…"
              : cooldownRemaining > 0
                ? `إعادة الإرسال بعد ${cooldownRemaining} ث`
                : "إرسال رمز التحقق"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isBlocked || verifyMut.isPending || code.length !== 6) return;
            verifyMut.mutate();
          }}
          className="space-y-3"
        >
          <p className="text-xs text-muted-foreground">
            أرسلنا رمزًا إلى <span dir="ltr" className="font-medium text-foreground">{email}</span>.
            الرمز صالح لمدة 30 دقيقة.
          </p>
          <div className="space-y-2">
            <Label htmlFor="cust-otp">رمز التحقق</Label>
            <InputOTP
              id="cust-otp"
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={isBlocked || verifyMut.isPending}
              dir="ltr"
              className="justify-center"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {message && (
            <div
              className={
                message.tone === "error"
                  ? "text-sm font-medium text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {message.text}
            </div>
          )}
          <Button
            type="submit"
            className="w-full text-white"
            style={btnStyle}
            disabled={isBlocked || verifyMut.isPending || code.length !== 6}
          >
            <ShieldCheck className="ml-1 h-4 w-4" />
            {verifyMut.isPending ? "جارٍ التحقق…" : "تأكيد وتسجيل الدخول"}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage(null);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              تغيير البريد
            </button>
            <button
              type="button"
              disabled={cooldownRemaining > 0 || isBlocked || sendMut.isPending}
              onClick={() => sendMut.mutate()}
              className="font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              {cooldownRemaining > 0
                ? `إعادة إرسال الرمز خلال ${cooldownRemaining} ث`
                : sendMut.isPending
                  ? "جارٍ الإرسال…"
                  : "إعادة إرسال الرمز"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Small inline "sign in with your email" gate: shows the currently signed-in
 * customer, or the OTP form when signed out. Used inside the chat page and
 * the storefront checkout.
 */
export function CustomerAuthGate({
  merchantId,
  visitorId,
  brandName,
  themePrimary,
  children,
}: {
  merchantId: string;
  visitorId?: string | null;
  brandName?: string;
  themePrimary?: string;
  children?: React.ReactNode;
}) {
  const session = useCustomerSession();
  if (session.isLoading) {
    return (
      <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
        جارٍ التحقق من الجلسة…
      </div>
    );
  }
  if (session.data?.loggedIn) {
    return <>{children}</>;
  }
  return (
    <CustomerLoginPanel
      merchantId={merchantId}
      visitorId={visitorId}
      brandName={brandName}
      themePrimary={themePrimary}
    />
  );
}
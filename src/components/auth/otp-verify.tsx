import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { SpamNotice } from "@/components/auth/auth-card";
import {
  formatMinutesSeconds,
  useCountdownTo,
} from "@/lib/use-countdown";
import {
  CODE_TTL_MINUTES,
  type OtpPurpose,
  type OtpSendResult,
  type OtpVerifyResult,
} from "@/lib/auth-types";
import {
  resendPasswordResetOtp,
  resendSignupOtp,
  resetPassword,
  verifySignupOtp,
} from "@/lib/auth.functions";

const MIN_PASSWORD = 8;

export function OtpVerify({
  email,
  purpose,
  withNewPassword = false,
  onSuccess,
  initialCooldownSeconds = 60,
}: {
  email: string;
  purpose: OtpPurpose;
  withNewPassword?: boolean;
  onSuccess: () => void;
  initialCooldownSeconds?: number;
}) {
  const verifySignup = useServerFn(verifySignupOtp);
  const resetPw = useServerFn(resetPassword);
  const resendSignup = useServerFn(resendSignupOtp);
  const resendReset = useServerFn(resendPasswordResetOtp);

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    tone: "info" | "error";
  } | null>(null);

  const [cooldownTarget, setCooldownTarget] = useState<number | null>(
    () => Date.now() + initialCooldownSeconds * 1000,
  );
  const [blockTarget, setBlockTarget] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const cooldownRemaining = useCountdownTo(cooldownTarget);
  const blockRemaining = useCountdownTo(blockTarget);
  const isBlocked = blockRemaining > 0;

  function applySendResult(res: OtpSendResult) {
    setMessage({
      text: res.message,
      tone: res.ok ? "info" : "error",
    });
    if (res.retryAfterSeconds && res.retryAfterSeconds > 0) {
      setCooldownTarget(Date.now() + res.retryAfterSeconds * 1000);
    }
    if (res.blockedUntil) {
      setBlockTarget(new Date(res.blockedUntil).getTime());
    }
    if (res.ok && res.remainingSends !== undefined && res.remainingSends <= 1) {
      toast.warning(
        res.remainingSends === 0
          ? "لقد استنفدت طلبات إرسال الرمز المتاحة حاليًا."
          : "تبقّى طلب واحد فقط قبل حظر إرسال المزيد من الرموز.",
      );
    }
  }

  function applyVerifyResult(res: OtpVerifyResult) {
    if (res.ok) {
      toast.success(res.message);
      onSuccess();
      return;
    }
    setMessage({ text: res.message, tone: "error" });
    if (res.blockedUntil) {
      setBlockTarget(new Date(res.blockedUntil).getTime());
    }
  }

  async function handleResend() {
    if (cooldownRemaining > 0 || isBlocked || resending) return;
    setResending(true);
    setMessage(null);
    try {
      const res =
        purpose === "signup"
          ? await resendSignup({ data: { email } })
          : await resendReset({ data: { email } });
      applySendResult(res);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "حدث خطأ غير متوقع.",
        tone: "error",
      });
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isBlocked || submitting) return;
    if (code.length !== 6) {
      setMessage({ text: "يرجى إدخال الرمز المكوّن من ٦ أرقام.", tone: "error" });
      return;
    }
    if (withNewPassword) {
      if (password.length < MIN_PASSWORD) {
        setMessage({
          text: `يجب أن تحتوي كلمة المرور على ${MIN_PASSWORD} أحرف على الأقل.`,
          tone: "error",
        });
        return;
      }
      if (password !== confirmPassword) {
        setMessage({ text: "كلمتا المرور غير متطابقتين.", tone: "error" });
        return;
      }
    }
    setSubmitting(true);
    setMessage(null);
    try {
      if (withNewPassword) {
        const res = await resetPw({
          data: { email, code, password, confirmPassword },
        });
        applyVerifyResult(res);
      } else {
        const res = await verifySignup({ data: { email, code } });
        applyVerifyResult(res);
      }
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "حدث خطأ غير متوقع.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <SpamNotice />

      <p className="text-sm text-muted-foreground">
        أرسلنا رمزًا مكوّنًا من ٦ أرقام إلى{" "}
        <span className="font-medium text-foreground" dir="ltr">{email}</span>. الرمز صالح لمدة {CODE_TTL_MINUTES} دقيقة.
      </p>

      <div className="space-y-2">
        <Label htmlFor="otp">رمز التحقق</Label>
        <InputOTP
          id="otp"
          maxLength={6}
          value={code}
          onChange={setCode}
          disabled={isBlocked || submitting}
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

      {withNewPassword ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isBlocked || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">تأكيد كلمة المرور الجديدة</Label>
            <Input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isBlocked || submitting}
            />
          </div>
        </>
      ) : null}

      {isBlocked ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium leading-relaxed text-destructive">
          لقد تجاوزت الحدّ الأقصى لعدد المحاولات. يُرجى إعادة المحاولة بعد{" "}
          <span dir="ltr">{formatMinutesSeconds(blockRemaining)}</span>.
        </div>
      ) : message ? (
        <div
          className={
            message.tone === "error"
              ? "text-sm font-medium text-destructive"
              : "text-sm font-medium text-muted-foreground"
          }
        >
          {message.text}
        </div>
      ) : null}

      <Button type="submit" size="lg" className="w-full shadow-elegant" disabled={isBlocked || submitting}>
        {submitting
          ? "جارٍ التحقق…"
          : withNewPassword
            ? "تعيين كلمة المرور"
            : "تأكيد الرمز"}
      </Button>

      <div className="text-center text-sm">
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldownRemaining > 0 || isBlocked || resending}
          className="font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {cooldownRemaining > 0
            ? `إعادة إرسال الرمز خلال ${cooldownRemaining} ث`
            : resending
              ? "جارٍ الإرسال…"
              : "إعادة إرسال الرمز"}
        </button>
      </div>
    </form>
  );
}

import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth.functions";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "استعادة كلمة المرور · كيوباي" },
      {
        name: "description",
        content: "اطلب رمزًا لاستعادة كلمة المرور الخاصة بحسابك.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const request = useServerFn(requestPasswordReset);

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await request({ data: { email } });
      if (res.ok || res.status === "cooldown") {
        navigate({
          to: "/reset-password",
          search: {
            email: email.trim().toLowerCase(),
            cooldown: res.retryAfterSeconds ?? 60,
          },
        });
        return;
      }
      setError(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="نسيت كلمة المرور؟"
      subtitle="أدخل بريدك الإلكتروني وسنرسل لك رمز إعادة التعيين."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          العودة إلى تسجيل الدخول
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">البريد الإلكتروني</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : null}
        <Button type="submit" className="w-full shadow-elegant" size="lg" disabled={submitting}>
          {submitting ? "جارٍ الإرسال…" : "إرسال رمز الاستعادة"}
        </Button>
      </form>
    </AuthCard>
  );
}

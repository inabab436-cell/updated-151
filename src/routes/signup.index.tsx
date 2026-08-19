import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpStart } from "@/lib/auth.functions";

export const Route = createFileRoute("/signup/")({
  head: () => ({
    meta: [
      { title: "إنشاء حساب · كيوباي" },
      {
        name: "description",
        content: "أنشئ حسابك في كيوباي وقم بتفعيل بريدك الإلكتروني.",
      },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const start = useServerFn(signUpStart);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await start({
        data: { email, password, confirmPassword },
      });
      if (res.ok || res.status === "cooldown") {
        navigate({
          to: "/signup/verify",
          search: { email: email.trim().toLowerCase(), cooldown: res.retryAfterSeconds ?? 60 },
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
      title="أنشئ حسابك الجديد"
      subtitle="ابدأ باستخدام كيوباي في أقل من دقيقة."
      footer={
        <span>
          لديك حساب بالفعل؟{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            تسجيل الدخول
          </Link>
        </span>
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
        <div className="space-y-2">
          <Label htmlFor="password">كلمة المرور</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : null}
        <Button type="submit" className="w-full shadow-elegant" size="lg" disabled={submitting}>
          {submitting ? "جارٍ الإنشاء…" : "متابعة"}
        </Button>
      </form>
    </AuthCard>
  );
}

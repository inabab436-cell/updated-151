import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/auth.functions";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول · كيوباي" },
      { name: "description", content: "سجّل الدخول إلى حسابك في كيوباي." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const doLogin = useServerFn(login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await doLogin({ data: { email, password } });
      if (res.ok) {
        toast.success("مرحبًا بعودتك!");
        navigate({ to: res.nextRoute ?? "/welcome" });
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
      title="مرحبًا بعودتك"
      subtitle="سجّل الدخول إلى حسابك للمتابعة."
      footer={
        <span>
          ليس لديك حساب؟{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            أنشئ حسابًا جديدًا
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">كلمة المرور</Label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              نسيت كلمة المرور؟
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : null}
        <Button type="submit" className="w-full shadow-elegant" size="lg" disabled={submitting}>
          {submitting ? "جارٍ التحقق…" : "تسجيل الدخول"}
        </Button>
      </form>
    </AuthCard>
  );
}

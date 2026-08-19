import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AuthCard } from "@/components/auth/auth-card";
import { OtpVerify } from "@/components/auth/otp-verify";

export const Route = createFileRoute("/signup/verify")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
    cooldown:
      typeof search.cooldown === "number"
        ? search.cooldown
        : Number(search.cooldown) || 60,
  }),
  head: () => ({
    meta: [
      { title: "تفعيل البريد الإلكتروني · كيوباي" },
      {
        name: "description",
        content: "أدخل رمز التفعيل المرسل إلى بريدك الإلكتروني.",
      },
    ],
  }),
  component: SignupVerifyPage,
});

function SignupVerifyPage() {
  const { email, cooldown } = Route.useSearch();
  const navigate = useNavigate();

  if (!email) {
    return (
      <AuthCard title="تفعيل البريد الإلكتروني" subtitle="لم يتم تحديد البريد الإلكتروني.">
        <button
          className="text-sm font-medium text-primary hover:underline"
          onClick={() => navigate({ to: "/signup" })}
        >
          العودة إلى إنشاء الحساب
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="تفعيل البريد الإلكتروني"
      subtitle="أدخل الرمز المكوّن من ٦ أرقام الذي أرسلناه إلى بريدك."
    >
      <OtpVerify
        email={email}
        purpose="signup"
        initialCooldownSeconds={cooldown}
        onSuccess={() => navigate({ to: "/welcome" })}
      />
    </AuthCard>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AuthCard } from "@/components/auth/auth-card";
import { OtpVerify } from "@/components/auth/otp-verify";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
    cooldown:
      typeof search.cooldown === "number"
        ? search.cooldown
        : Number(search.cooldown) || 60,
  }),
  head: () => ({
    meta: [
      { title: "تعيين كلمة مرور جديدة · كيوباي" },
      {
        name: "description",
        content: "أدخل رمز الاستعادة واختر كلمة مرور جديدة.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { email, cooldown } = Route.useSearch();
  const navigate = useNavigate();

  if (!email) {
    return (
      <AuthCard title="تعيين كلمة مرور جديدة" subtitle="لم يتم تحديد البريد الإلكتروني.">
        <button
          className="text-sm font-medium text-primary hover:underline"
          onClick={() => navigate({ to: "/forgot-password" })}
        >
          العودة إلى طلب الاستعادة
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="تعيين كلمة مرور جديدة"
      subtitle="أدخل الرمز الذي أرسلناه إلى بريدك واختر كلمة مرور جديدة."
    >
      <OtpVerify
        email={email}
        purpose="password_reset"
        withNewPassword
        initialCooldownSeconds={cooldown}
        onSuccess={() => navigate({ to: "/login" })}
      />
    </AuthCard>
  );
}

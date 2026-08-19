import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { completeSetup } from "@/lib/auth.functions";
import logoAsset from "@/assets/cupai-logo.png.asset.json";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "مرحبًا بك · كيوباي" },
      {
        name: "description",
        content: "مرحبًا بك في كيوباي. أعدّ وكيل المبيعات الذكي الخاص بك.",
      },
    ],
  }),
  component: WelcomePage,
});

function WelcomePage() {
  const navigate = useNavigate();
  const finish = useServerFn(completeSetup);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await finish({});
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background bg-gradient-surface px-4 py-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-64 max-w-4xl rounded-full bg-gradient-brand opacity-10 blur-3xl" />
      <div className="relative w-full max-w-lg rounded-2xl border border-border/70 bg-card/95 p-8 text-center shadow-card backdrop-blur sm:p-10">
        <img
          src={logoAsset.url}
          alt="كيوباي"
          className="mx-auto h-20 w-20 rounded-2xl bg-card object-contain p-1.5 shadow-elegant"
        />
        <h1 className="mt-6 text-3xl font-black tracking-tight text-gradient-brand">
          أهلًا بك في كيوباي
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          كل شيء جاهز. الخطوة التالية هي إعداد الوكيل الذكي الخاص بك ليبدأ
          بالردّ على عملائك تلقائيًا بلغتك وبأسلوب علامتك التجارية.
        </p>
        <div className="mt-8">
          <Button onClick={handleContinue} disabled={submitting} size="lg" className="w-full shadow-glow">
            {submitting ? "جارٍ التحضير…" : "إكمال إعداد الوكيل"}
          </Button>
        </div>
      </div>
    </div>
  );
}

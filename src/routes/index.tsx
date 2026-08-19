import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { getSessionInfo, logout } from "@/lib/auth.functions";
import logoAsset from "@/assets/cupai-logo.png.asset.json";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const fetchSession = useServerFn(getSessionInfo);
  const doLogout = useServerFn(logout);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchSession()
      .then((res) => {
        if (active) setEmail(res.email);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchSession]);

  async function handleLogout() {
    await doLogout();
    setEmail(null);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background bg-gradient-surface">
      {/* Top nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <img
            src={logoAsset.url}
            alt="كيوباي"
            className="h-11 w-11 rounded-xl bg-card object-contain p-1 shadow-elegant"
          />
          <span className="text-lg font-extrabold tracking-tight text-gradient-brand">
            كيوباي
          </span>
        </div>
        <nav className="flex items-center gap-2">
          {loading ? null : email ? (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link to="/dashboard">لوحة التحكم</Link>
              </Button>
              <Button variant="outline" onClick={handleLogout}>
                تسجيل الخروج
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link to="/login">تسجيل الدخول</Link>
              </Button>
              <Button asChild className="shadow-elegant">
                <Link to="/signup">إنشاء حساب</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <main className="relative mx-auto flex max-w-6xl flex-col items-center px-6 pb-24 pt-10 text-center sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 py-1.5 text-xs font-semibold text-muted-foreground shadow-elegant backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-gradient-brand" />
          مدعوم بالذكاء الاصطناعي
        </span>

        <h1 className="mt-8 text-balance text-4xl font-black leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
          وكيل ذكي يردّ على عملائك
          <br className="hidden sm:inline" />
          <span className="text-gradient-brand"> على مدار الساعة</span>
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          كيوباي منصة ذكاء اصطناعي متكاملة تُدير محادثات عملائك، تُصنّف
          استفساراتهم، وترسل الردود المناسبة تلقائيًا — بلغتهم وبأسلوب علامتك التجارية.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {loading ? (
            <div className="h-11 w-40 animate-pulse rounded-lg bg-muted" />
          ) : email ? (
            <>
              <Button asChild size="lg" className="shadow-glow">
                <Link to="/dashboard">فتح لوحة التحكم</Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                مسجّل الدخول بـ <span className="font-semibold text-foreground">{email}</span>
              </span>
            </>
          ) : (
            <>
              <Button asChild size="lg" className="shadow-glow">
                <Link to="/signup">ابدأ مجانًا الآن</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">لديّ حساب بالفعل</Link>
              </Button>
            </>
          )}
        </div>

        {/* Feature cards */}
        <div className="mt-20 grid w-full gap-5 sm:grid-cols-3">
          {[
            {
              title: "ردود فورية",
              body: "يُجيب الوكيل على استفسارات عملائك خلال ثوانٍ، بأسلوبٍ طبيعي واحترافي.",
            },
            {
              title: "تصنيف ذكي",
              body: "يُنظّم رسائل عملائك ويُميّز الاستفسارات المهمة قبل أن تصلك.",
            },
            {
              title: "تكامل كامل",
              body: "يعمل مع منتجاتك وسياساتك ومحتوى موقعك دون أي إعداد معقّد.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border/70 bg-card/90 p-6 text-start shadow-card backdrop-blur transition-all hover:-translate-y-0.5 hover:shadow-elegant"
            >
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gradient-brand text-primary-foreground shadow-elegant" aria-hidden />
              <h3 className="text-base font-bold text-card-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

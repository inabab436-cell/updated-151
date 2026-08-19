import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import logoAsset from "@/assets/cupai-logo.png.asset.json";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background bg-gradient-surface px-4 py-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-64 max-w-4xl rounded-full bg-gradient-brand opacity-10 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img
            src={logoAsset.url}
            alt="كيوباي"
            className="h-16 w-16 rounded-2xl bg-card object-contain p-1.5 shadow-elegant"
          />
          <span className="text-xl font-extrabold tracking-tight text-gradient-brand">
            كيوباي
          </span>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-card backdrop-blur-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-card-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          ) : null}
          <div className="mt-7">{children}</div>
        </div>
        {footer ? (
          <div className="mt-5 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SpamNotice() {
  return (
    <div
      className={cn(
        "rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-medium leading-relaxed text-amber-800",
        "dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
      )}
    >
      قد تصل الرسالة إلى مجلد الرسائل غير المرغوب فيها (Spam)، يُرجى التحقق منه.
    </div>
  );
}

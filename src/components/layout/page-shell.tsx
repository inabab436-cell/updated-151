import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import logo from "@/assets/cupai-logo.png.asset.json";

/**
 * Shared page shell for authenticated inner pages.
 * Sticky brand header + soft brand-gradient background surface.
 * Purely presentational — no data or business logic.
 */
export function PageShell({
  children,
  dir = "rtl",
  maxWidth = "max-w-6xl",
  backTo = "/dashboard",
  backLabel = "لوحة التحكم",
}: {
  children: ReactNode;
  dir?: "rtl" | "ltr";
  maxWidth?: string;
  backTo?: "/dashboard" | "/" | "/published";
  backLabel?: string;
}) {
  const isRtl = dir === "rtl";
  return (
    <div dir={dir} className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className={`mx-auto flex w-full ${maxWidth} items-center justify-between gap-3 px-4 py-3`}>
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <img src={logo.url} alt="cupai" className="h-8 w-8 shrink-0 rounded-lg shadow-card" />
            <span className="truncate text-sm font-semibold tracking-tight">cupai</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to={backTo}>
              <ArrowLeft className={`${isRtl ? "ml-1" : "mr-1"} h-4 w-4`} />
              {backLabel}
            </Link>
          </Button>
        </div>
      </header>
      <div className={`mx-auto w-full ${maxWidth} space-y-8 px-4 py-8 sm:py-10`}>{children}</div>
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  highlight,
  description,
  actions,
  icon,
}: {
  eyebrow?: string;
  title: ReactNode;
  highlight?: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            {icon ? <span className="grid h-4 w-4 place-items-center text-primary">{icon}</span> : <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            {eyebrow}
          </div>
        )}
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
          {highlight && <> <span className="text-gradient-brand">{highlight}</span></>}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

export function SurfaceCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border/60 bg-background/80 shadow-elegant backdrop-blur-xl ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeader({
  icon,
  title,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold sm:text-base">
        {icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-brand text-primary-foreground shadow-glow">
            {icon}
          </span>
        )}
        <span className="truncate">{title}</span>
      </h2>
      {action}
    </header>
  );
}

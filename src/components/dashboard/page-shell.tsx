import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import logo from "@/assets/cupai-logo.png.asset.json";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageShell({ title, description, icon, actions, children }: Props) {
  return (
    <div dir="rtl" className="min-h-screen bg-gradient-surface">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src={logo.url} alt="cupai" className="h-8 w-8 rounded-lg shadow-card" />
            <span className="text-sm font-semibold tracking-tight">cupai</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              لوحة التحكم
              <ChevronRight className="mr-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="rounded-xl bg-gradient-brand p-2.5 text-primary-foreground shadow-glow">
                {icon}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>

        {children}
      </div>
    </div>
  );
}
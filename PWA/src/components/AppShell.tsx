import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Droplets, Gauge, History, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: Gauge },
  { to: "/history", label: "History", icon: History },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-primary px-5 py-4 text-primary-foreground">
        <Droplets className="size-6" />
        <h1 className="flex-1 text-lg font-bold tracking-tight">{title}</h1>
        {action}
      </header>

      <main className="flex-1 space-y-4 px-4 py-5 pb-28">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-lg justify-around border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] pt-2">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

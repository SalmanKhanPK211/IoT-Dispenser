import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BellOff, Check, Droplet, TriangleAlert, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime, useDevice, useTick } from "@/hooks/useDevice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — AquaSense Water Dispenser" },
      { name: "description", content: "Low water and device alerts from your water dispenser." },
      { property: "og:title", content: "Alerts — AquaSense Water Dispenser" },
      {
        property: "og:description",
        content: "Low water and device alerts from your water dispenser.",
      },
    ],
  }),
  component: AlertsPage,
});

type Alert = {
  id: number;
  type: string;
  message: string;
  level_pct: number | null;
  acknowledged: boolean;
  created_at: string;
};

const ICONS: Record<string, typeof Droplet> = {
  low_water: Droplet,
  dry_run: TriangleAlert,
  offline: WifiOff,
};

function AlertsPage() {
  const now = useTick();
  const { device } = useDevice();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unack">("all");

  const load = useCallback(async () => {
    if (!device?.id) return;
    const { data } = await supabase
      .from("alerts")
      .select("id,type,message,level_pct,acknowledged,created_at")
      .eq("device_id", device.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setAlerts((data ?? []) as Alert[]);
    setLoading(false);
  }, [device?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!device?.id) return;
    const channel = supabase
      .channel(`alerts-${device.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `device_id=eq.${device.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [device?.id, load]);

  const acknowledge = async (id: number) => {
    const { error } = await supabase.from("alerts").update({ acknowledged: true }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    }
  };

  const shown = filter === "all" ? alerts : alerts.filter((a) => !a.acknowledged);

  return (
    <AppShell title="Alerts">
      <div className="flex gap-2">
        {(["all", "unack"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "secondary"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : "Unacknowledged"}
          </Button>
        ))}
      </div>

      {loading && <Skeleton className="h-24 w-full rounded-2xl" />}

      {!loading && shown.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <BellOff className="size-8 text-muted-foreground" />
            <p className="font-semibold">No alerts</p>
            <p className="text-sm text-muted-foreground">
              You'll see low-water warnings here as soon as they happen.
            </p>
          </CardContent>
        </Card>
      )}

      {shown.map((alert) => {
        const Icon = ICONS[alert.type] ?? TriangleAlert;
        return (
          <Card key={alert.id} className={cn(alert.acknowledged && "opacity-60")}>
            <CardContent className="flex items-start gap-3 pt-5">
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl",
                  alert.acknowledged
                    ? "bg-muted text-muted-foreground"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                <Icon className="size-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{alert.message}</p>
                <p className="text-xs text-muted-foreground tnum">
                  {alert.level_pct != null && `${Number(alert.level_pct).toFixed(0)}% · `}
                  {relativeTime(alert.created_at, now)}
                </p>
              </div>
              {!alert.acknowledged && (
                <Button size="icon" variant="ghost" onClick={() => void acknowledge(alert.id)}>
                  <Check className="size-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </AppShell>
  );
}

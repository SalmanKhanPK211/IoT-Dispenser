import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Minus,
  RotateCcw,
  Settings2,
  Thermometer,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PairDevice } from "@/components/PairDevice";
import { TankGauge, levelTone } from "@/components/TankGauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deriveStatus, relativeTime, useDevice, useReadings, useTick } from "@/hooks/useDevice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — AquaSense Water Dispenser" },
      {
        name: "description",
        content: "Live water level, temperature and usage for your smart water dispenser.",
      },
      { property: "og:title", content: "Dashboard — AquaSense Water Dispenser" },
      {
        property: "og:description",
        content: "Live water level, temperature and usage for your smart water dispenser.",
      },
    ],
  }),
  component: Dashboard,
});

const TONE_TEXT: Record<string, string> = {
  water: "text-primary",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

function Dashboard() {
  const now = useTick();
  const { device, loading, reload } = useDevice();
  const { latest, prevHour, usageToday, loading: readingsLoading } = useReadings(device?.id);

  const status = deriveStatus(device?.last_seen ?? null, now);
  const offline = status !== "online";
  const pct = latest?.level_pct != null ? Number(latest.level_pct) : null;
  const tone = levelTone(pct);
  const lowWater =
    pct != null && device?.low_level_pct != null && pct < Number(device.low_level_pct);

  const tankHeight = device?.tank_height_in != null ? Number(device.tank_height_in) : null;
  const capacityL = tankHeight != null ? tankHeight * 0.4 : null; // rough tank volume estimate
  const remainingL = capacityL != null && pct != null ? (capacityL * pct) / 100 : null;

  const tempC = latest?.temp_c != null ? Number(latest.temp_c) : null;
  const tempPrev = prevHour?.temp_c != null ? Number(prevHour.temp_c) : null;
  const tempTrend =
    tempC != null && tempPrev != null
      ? tempC - tempPrev > 0.3
        ? "up"
        : tempPrev - tempC > 0.3
          ? "down"
          : "flat"
      : null;

  if (loading) {
    return (
      <AppShell title="AquaSense">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </AppShell>
    );
  }

  if (!device) {
    return (
      <AppShell title="AquaSense">
        <PairDevice onPaired={() => void reload()} />
      </AppShell>
    );
  }

  return (
    <AppShell
      title={device.name}
      action={
        <Link to="/alerts" aria-label="Alerts">
          <Bell className="size-5" />
        </Link>
      }
    >
      {lowWater && (
        <div className="flex items-center gap-3 rounded-xl bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground">
          <TriangleAlert className="size-5 shrink-0" />
          Water low — refill the tank ({pct?.toFixed(0)}%)
        </div>
      )}

      {offline && (
        <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <WifiOff className="mt-0.5 size-4 shrink-0" />
          <span>
            {status === "never"
              ? "Waiting for the dispenser's first report."
              : "Dispenser offline — showing last known values. Real-time alerts are paused while the dispenser is offline."}
          </span>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold">Water Level</h2>
              <p className="text-xs text-muted-foreground">
                {offline ? "Last known level" : "Live tank level"}
              </p>
            </div>
            {latest && (
              <span className="text-[11px] text-muted-foreground">
                {relativeTime(latest.created_at, now)}
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <TankGauge pct={pct} stale={offline} />
            <div className="text-right">
              {readingsLoading ? (
                <Skeleton className="h-12 w-24" />
              ) : (
                <>
                  <p className={cn("text-4xl font-extrabold tnum", TONE_TEXT[tone])}>
                    {pct != null ? `${pct.toFixed(0)}%` : "—"}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">Level</p>
                  <p className="mt-4 text-lg font-bold tnum">
                    {remainingL != null ? `~${remainingL.toFixed(1)} L` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Remaining</p>
                </>
              )}
            </div>
          </div>

          {tankHeight == null && (
            <Link
              to="/setup"
              className="mt-4 block rounded-xl bg-secondary px-4 py-3 text-center text-sm font-semibold text-secondary-foreground"
            >
              Tank height not configured. Tap to set up.
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Thermometer className="size-4 text-primary" /> Temperature
            </div>
            <p className="flex items-center gap-1 text-2xl font-bold tnum">
              {tempC != null ? `${tempC.toFixed(1)}°C` : "—"}
              {tempTrend === "up" && <ArrowUp className="size-4 text-warning" />}
              {tempTrend === "down" && <ArrowDown className="size-4 text-primary" />}
              {tempTrend === "flat" && <Minus className="size-4 text-muted-foreground" />}
            </p>
            <p className="text-xs text-muted-foreground">
              {offline ? "Stale" : tempTrend ? "vs 1h ago" : "Normal"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-1 pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <RotateCcw className="size-4 text-primary" /> Total Usage
            </div>
            <p className="text-2xl font-bold tnum">
              {latest?.total_liters != null ? `${Number(latest.total_liters).toFixed(1)} L` : "—"}
            </p>
            <p className="text-xs text-muted-foreground tnum">
              Today {usageToday.toFixed(1)} L
            </p>
            <p className="text-[11px] text-muted-foreground">
              Reset {device.total_liters_reset_at ? relativeTime(device.total_liters_reset_at, now) : "never"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between pt-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Device Status</p>
            <p
              className={cn(
                "flex items-center gap-2 text-base font-bold",
                status === "online" ? "text-success" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  status === "online" ? "bg-success" : "bg-muted-foreground",
                )}
              />
              {status === "online" ? "Online" : status === "offline" ? "Offline" : "Never seen"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Last seen {relativeTime(device.last_seen, now)}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button asChild variant="secondary">
          <Link to="/setup">
            <Settings2 className="size-4" /> Setup Mode
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/settings">
            <RotateCcw className="size-4" /> Reset Usage
          </Link>
        </Button>
      </div>
    </AppShell>
  );
}

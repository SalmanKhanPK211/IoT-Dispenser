import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useDevice, type Reading } from "@/hooks/useDevice";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "History — AquaSense Water Dispenser" },
      {
        name: "description",
        content: "Water level, temperature and usage trends for your water dispenser.",
      },
      { property: "og:title", content: "History — AquaSense Water Dispenser" },
      {
        property: "og:description",
        content: "Water level, temperature and usage trends for your water dispenser.",
      },
    ],
  }),
  component: HistoryPage,
});

const RANGES = [
  { key: "6h", label: "6h", hours: 6 },
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 168 },
] as const;

const GAP_MINUTES = 3;

function HistoryPage() {
  const { device } = useDevice();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [rows, setRows] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!device?.id) return;
    setLoading(true);
    const since = new Date(Date.now() - range.hours * 3600_000).toISOString();
    void supabase
      .from("readings")
      .select("*")
      .eq("device_id", device.id)
      .gte("created_at", since)
      .order("id", { ascending: true })
      .then(({ data }) => {
        setRows((data ?? []) as Reading[]);
        setLoading(false);
      });
  }, [device?.id, range]);

  // Insert null points where the device went quiet so charts show a break,
  // never a drop to zero. Usage is charted as per-interval deltas.
  const series = useMemo(() => {
    const out: {
      t: number;
      label: string;
      level: number | null;
      temp: number | null;
      usage: number | null;
    }[] = [];
    let prevTime: number | null = null;
    let lastTotal: number | null = null;

    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (prevTime !== null && t - prevTime > GAP_MINUTES * 60_000) {
        out.push({ t: prevTime + 1, label: "", level: null, temp: null, usage: null });
        lastTotal = r.total_liters != null ? Number(r.total_liters) : null;
      }
      const total = r.total_liters != null ? Number(r.total_liters) : null;
      let usage: number | null = null;
      if (total != null && lastTotal != null) usage = total >= lastTotal ? total - lastTotal : total;
      if (total != null) lastTotal = total;

      out.push({
        t,
        label: new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        level: r.level_pct != null ? Number(r.level_pct) : null,
        temp: r.temp_c != null ? Number(r.temp_c) : null,
        usage,
      });
      prevTime = t;
    }
    return out;
  }, [rows]);

  const charts = [
    { title: "Water level (%)", key: "level" as const, color: "var(--color-chart-1)", domain: [0, 100] },
    { title: "Temperature (°C)", key: "temp" as const, color: "var(--color-chart-3)", domain: undefined },
    { title: "Usage per reading (L)", key: "usage" as const, color: "var(--color-chart-2)", domain: undefined },
  ];

  return (
    <AppShell title="History">
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={range.key === r.key ? "default" : "secondary"}
            onClick={() => setRange(r)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {loading && <Skeleton className="h-56 w-full rounded-2xl" />}

      {!loading && series.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No readings in this period yet.
          </CardContent>
        </Card>
      )}

      {!loading &&
        series.length > 0 &&
        charts.map((c) => (
          <Card key={c.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{c.title}</CardTitle>
            </CardHeader>
            <CardContent className="h-48 px-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis
                    width={38}
                    domain={c.domain ?? ["auto", "auto"]}
                    tickFormatter={(v: number) =>
                      Number.isFinite(v) ? Number(v.toFixed(2)).toString() : ""
                    }
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={c.key}
                    stroke={c.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
    </AppShell>
  );
}

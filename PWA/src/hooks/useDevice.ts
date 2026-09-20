import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const DEVICE_COLS =
  "id,owner_id,name,tank_height_in,measured_height_in,sensor_offset_in,low_level_pct,total_liters_reset_at,last_seen,firmware_version,created_at";

export type Device = {
  id: string;
  owner_id: string | null;
  name: string;
  tank_height_in: number | null;
  measured_height_in: number | null;
  sensor_offset_in: number;
  low_level_pct: number;
  total_liters_reset_at: string | null;
  last_seen: string | null;
  firmware_version: string | null;
  created_at: string;
};

export type Reading = {
  id: number;
  device_id: string;
  level_pct: number | null;
  level_in: number | null;
  temp_c: number | null;
  flow_lpm: number | null;
  total_liters: number | null;
  created_at: string;
};

export type DeviceStatus = "online" | "offline" | "never";

/** Ticks every `ms` so derived time values (status, "x ago") stay fresh. */
export function useTick(ms = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function deriveStatus(lastSeen: string | null, now: number): DeviceStatus {
  if (!lastSeen) return "never";
  return now - new Date(lastSeen).getTime() < 60_000 ? "online" : "offline";
}

export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "never";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The user's device (v1 = a single device per account) plus live updates. */
export function useDevice() {
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("devices")
      .select(DEVICE_COLS)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) setError(error.message);
    else setDevice((data as Device | null) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!device?.id) return;
    const channel = supabase
      .channel(`device-${device.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "devices", filter: `id=eq.${device.id}` },
        ({ new: row }) => setDevice((prev) => ({ ...(prev as Device), ...(row as Device) })),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [device?.id]);

  return { device, loading, error, reload: load, setDevice };
}

/** Latest reading + live inserts, plus usage-today computed from deltas. */
export function useReadings(deviceId: string | undefined) {
  const [latest, setLatest] = useState<Reading | null>(null);
  const [today, setToday] = useState<Reading[]>([]);
  const [prevHour, setPrevHour] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!deviceId) return;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [{ data: todayRows }, { data: hourRows }] = await Promise.all([
      supabase
        .from("readings")
        .select("*")
        .eq("device_id", deviceId)
        .gte("created_at", midnight.toISOString())
        .order("id", { ascending: true }),
      supabase
        .from("readings")
        .select("*")
        .eq("device_id", deviceId)
        .lte("created_at", new Date(Date.now() - 3600_000).toISOString())
        .order("id", { ascending: false })
        .limit(1),
    ]);
    const rows = (todayRows ?? []) as Reading[];
    setToday(rows);
    setPrevHour(((hourRows ?? [])[0] as Reading | undefined) ?? null);
    if (rows.length > 0) setLatest(rows[rows.length - 1] ?? null);
    else {
      const { data } = await supabase
        .from("readings")
        .select("*")
        .eq("device_id", deviceId)
        .order("id", { ascending: false })
        .limit(1);
      setLatest(((data ?? [])[0] as Reading | undefined) ?? null);
    }
    setLoading(false);
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deviceId) return;
    const channel = supabase
      .channel(`readings-${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "readings",
          filter: `device_id=eq.${deviceId}`,
        },
        ({ new: row }) => {
          const r = row as Reading;
          setLatest(r);
          setToday((prev) => [...prev, r]);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [deviceId]);

  // Usage today: sum of deltas. Immune to gaps (one big delta) and
  // counter resets (delta restarts from the new, lower total).
  const usageToday = useMemo(() => {
    let last: number | null = null;
    let sum = 0;
    for (const r of today) {
      const total = r.total_liters;
      if (total == null) continue;
      if (last !== null) sum += total >= last ? total - last : total;
      last = total;
    }
    return sum;
  }, [today]);

  return { latest, today, prevHour, usageToday, loading, reload: load };
}

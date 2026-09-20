import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, LogOut, Moon, RotateCcw, Sun } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { deriveStatus, relativeTime, useDevice, useTick } from "@/hooks/useDevice";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AquaSense Water Dispenser" },
      {
        name: "description",
        content: "Configure tank height, sensor offset, low-level threshold and usage counter.",
      },
      { property: "og:title", content: "Settings — AquaSense Water Dispenser" },
      {
        property: "og:description",
        content: "Configure tank height, sensor offset, low-level threshold and usage counter.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const now = useTick();
  const navigate = useNavigate();
  const { device, loading, reload } = useDevice();
  const [name, setName] = useState("");
  const [offset, setOffset] = useState("");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (!device) return;
    setName(device.name);
    setOffset(String(device.sensor_offset_in ?? 0));
    setThreshold(String(device.low_level_pct ?? 10));
  }, [device]);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const status = deriveStatus(device?.last_seen ?? null, now);

  const save = async () => {
    if (!device) return;
    setSaving(true);
    const { error } = await supabase
      .from("devices")
      .update({
        name,
        sensor_offset_in: Number(offset) || 0,
        low_level_pct: Number(threshold) || 10,
      })
      .eq("id", device.id);
    if (error) toast.error(error.message);
    else {
      await supabase.from("device_commands").insert({
        device_id: device.id,
        command: "reload_config",
      });
      toast.success("Settings saved");
      void reload();
    }
    setSaving(false);
  };

  const resetCounter = async () => {
    if (!device) return;
    setConfirmReset(false);
    setResetting(true);
    const { data, error } = await supabase
      .from("device_commands")
      .insert({ device_id: device.id, command: "reset_counter", payload: {} })
      .select("id")
      .single();
    if (error || !data) {
      setResetting(false);
      toast.error(error?.message ?? "Could not send the reset");
      return;
    }

    const commandId = data.id;
    const started = Date.now();
    const poll = setInterval(async () => {
      const { data: row } = await supabase
        .from("device_commands")
        .select("status")
        .eq("id", commandId)
        .maybeSingle();
      if (row && row.status !== "pending") {
        clearInterval(poll);
        setResetting(false);
        void reload();
        if (row.status === "done") toast.success("Usage counter reset");
        else toast.error(`Reset ${row.status}`);
      } else if (Date.now() - started > 90_000) {
        clearInterval(poll);
        setResetting(false);
        toast.error("The dispenser did not respond in time");
      }
    }, 3000);
  };

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };

  if (loading) {
    return (
      <AppShell title="Settings">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      {device && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Dispenser</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Device name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tank height</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={
                      device.tank_height_in != null
                        ? `${Number(device.tank_height_in).toFixed(1)} in`
                        : "Not configured"
                    }
                  />
                  <Button asChild variant="secondary">
                    <Link to="/setup">Reconfigure</Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="offset">Sensor offset (in)</Label>
                  <Input
                    id="offset"
                    type="number"
                    step="0.1"
                    value={offset}
                    onChange={(e) => setOffset(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="threshold">Low level (%)</Label>
                  <Input
                    id="threshold"
                    type="number"
                    step="1"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>
              </div>
              <Button className="w-full" onClick={() => void save()} disabled={saving}>
                Save changes
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Usage counter</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="secondary"
                className="w-full"
                disabled={status !== "online" || resetting}
                title={status !== "online" ? "Dispenser must be online to reset." : undefined}
                onClick={() => setConfirmReset(true)}
              >
                {resetting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {resetting ? "Waiting for the dispenser…" : "Reset usage counter"}
              </Button>
              {status !== "online" && (
                <p className="text-xs text-muted-foreground">
                  Dispenser must be online to reset.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Last reset{" "}
                {device.total_liters_reset_at
                  ? relativeTime(device.total_liters_reset_at, now)
                  : "never"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Device info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p className="break-all">ID: {device.id}</p>
              <p>Firmware: {device.firmware_version ?? "unknown"}</p>
              <p>Last seen: {relativeTime(device.last_seen, now)}</p>
              <p>Paired: {new Date(device.created_at).toLocaleDateString()}</p>
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={toggleTheme}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut();
            void navigate({ to: "/auth" });
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the usage counter?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set the dispenser's usage counter back to 0.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void resetCounter()}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Ruler, Timer } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useDevice } from "@/hooks/useDevice";

export const Route = createFileRoute("/_authenticated/setup")({
  head: () => ({
    meta: [
      { title: "Setup Mode — AquaSense Water Dispenser" },
      {
        name: "description",
        content: "Measure and confirm your tank height with the dispenser's ultrasonic sensor.",
      },
      { property: "og:title", content: "Setup Mode — AquaSense Water Dispenser" },
      {
        property: "og:description",
        content: "Measure and confirm your tank height with the dispenser's ultrasonic sensor.",
      },
    ],
  }),
  component: SetupPage,
});

type Session = {
  id: string;
  measured_height_in: number | null;
  status: string;
  expires_at: string;
};

function SetupPage() {
  const navigate = useNavigate();
  const { device, reload } = useDevice();
  const [session, setSession] = useState<Session | null>(null);
  const [manual, setManual] = useState("");
  const [starting, setStarting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timedOut = useRef(false);

  const start = async () => {
    if (!device) return;
    setStarting(true);
    timedOut.current = false;
    const { data, error } = await supabase
      .from("setup_sessions")
      .insert({ device_id: device.id, status: "active" })
      .select("id,measured_height_in,status,expires_at")
      .single();
    if (error || !data) {
      setStarting(false);
      toast.error(error?.message ?? "Could not start setup");
      return;
    }
    const s = data as Session;
    setSession(s);
    const { error: cmdError } = await supabase.from("device_commands").insert({
      device_id: device.id,
      command: "enter_setup_mode",
      payload: { setup_id: s.id },
    });
    setStarting(false);
    if (cmdError) toast.error(cmdError.message);
  };

  const finish = useCallback(
    async (status: "cancelled" | "timed_out") => {
      if (!session || !device) return;
      await supabase.from("setup_sessions").update({ status }).eq("id", session.id);
      await supabase
        .from("device_commands")
        .insert({ device_id: device.id, command: "cancel_setup", payload: {} });
      setSession(null);
      toast.message(status === "timed_out" ? "Setup timed out" : "Setup cancelled");
    },
    [session, device],
  );

  const confirm = async (value: number) => {
    if (!session || !device) return;
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid height");
      return;
    }
    await supabase.from("devices").update({ tank_height_in: value }).eq("id", device.id);
    await supabase.from("setup_sessions").update({ status: "confirmed" }).eq("id", session.id);
    await supabase
      .from("device_commands")
      .insert({ device_id: device.id, command: "reload_config", payload: {} });
    setSession(null);
    void reload();
    toast.success(`Tank height set to ${value.toFixed(1)} in`);
    void navigate({ to: "/" });
  };

  // Live measured height from the dispenser
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`setup-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "setup_sessions",
          filter: `id=eq.${session.id}`,
        },
        ({ new: row }) => setSession((prev) => ({ ...(prev as Session), ...(row as Session) })),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.id]);

  // Countdown + timeout
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const left = Math.max(0, new Date(session.expires_at).getTime() - Date.now());
      setRemaining(left);
      if (left === 0 && !timedOut.current) {
        timedOut.current = true;
        void finish("timed_out");
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session?.expires_at, finish, session]);

  const measured = session?.measured_height_in != null ? Number(session.measured_height_in) : null;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  return (
    <AppShell title="Setup Mode">
      {!session ? (
        <Card>
          <CardHeader>
            <CardTitle>Set up tank height</CardTitle>
            <CardDescription>
              Empty the tank, then start setup. The dispenser measures from the sensor down to the
              tank floor and shows the value here and on its own screen. You have two minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current height:{" "}
              <span className="font-semibold text-foreground tnum">
                {device?.tank_height_in != null
                  ? `${Number(device.tank_height_in).toFixed(1)} in`
                  : "not configured"}
              </span>
            </p>
            <Button className="w-full" onClick={() => void start()} disabled={starting || !device}>
              {starting ? <Loader2 className="size-4 animate-spin" /> : <Ruler className="size-4" />}
              Start setup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Setting up tank height</CardTitle>
            <CardDescription>Also shown on the dispenser screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl bg-secondary px-4 py-6 text-center">
              <p className="text-xs font-semibold text-muted-foreground">Measured</p>
              <p className="text-4xl font-extrabold tnum">
                {measured != null ? `${measured.toFixed(1)} in` : "waiting…"}
              </p>
            </div>

            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground tnum">
              <Timer className="size-4" />
              {mm}:{String(ss).padStart(2, "0")} remaining
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Button disabled={measured == null} onClick={() => void confirm(measured ?? 0)}>
                {measured != null ? `Confirm ${measured.toFixed(1)} in` : "Confirm"}
              </Button>
              <Button variant="outline" onClick={() => void finish("cancelled")}>
                Cancel
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual">Or type your own (in)</Label>
              <div className="flex gap-2">
                <Input
                  id="manual"
                  type="number"
                  step="0.1"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
                <Button variant="secondary" onClick={() => void confirm(Number(manual))}>
                  Use
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

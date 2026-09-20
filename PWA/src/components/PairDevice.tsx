import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PairDevice({ onPaired }: { onPaired: () => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("Water Dispenser");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const trimmedName = name.trim();
    const { data, error } = await supabase.rpc("pair_device", {
      p_device_id: deviceId.trim(),
      ...(trimmedName ? { p_name: trimmedName } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = (data as { id: string; device_token: string }[] | null)?.[0];
    if (row) setToken(row.device_token);
    toast.success("Dispenser paired");
  };

  if (token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Save this device key</CardTitle>
          <CardDescription>
            Paste it into your dispenser's <code>secrets.h</code>. It is shown only once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-3">
            <code className="flex-1 break-all text-xs">{token}</code>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(token);
                toast.success("Copied");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Button className="w-full" onClick={onPaired}>
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add your dispenser</CardTitle>
        <CardDescription>
          Enter the device ID shown on the dispenser screen the first time it starts up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={pair} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="device-id">Device ID</Label>
            <Input
              id="device-id"
              required
              placeholder="00000000-0000-0000-0000-000000000000"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-name">Name</Label>
            <Input
              id="device-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            Pair dispenser
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

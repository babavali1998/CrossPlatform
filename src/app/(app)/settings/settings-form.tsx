"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

export function SettingsForm({ name: n, timezone: tz, email }: { name: string; timezone: string; email: string }) {
  const [name, setName] = useState(n);
  const [timezone, setTimezone] = useState(tz);
  const [zones, setZones] = useState<string[]>([]);
  const loadZones = () => !zones.length && setZones(Intl.supportedValuesOf?.("timeZone") ?? []);

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/settings", { method: "PATCH", json: { name, timezone } });
          toast.success("Settings saved");
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" className="mt-1" value={email} disabled />
      </div>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="tz">Timezone for bulk uploads</Label>
        <Input id="tz" className="mt-1" list="zones" value={timezone} onFocus={loadZones} onChange={(e) => setTimezone(e.target.value)} />
        <datalist id="zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </div>
      <Button variant="primary" size="sm">
        Save
      </Button>
    </form>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { farmer } from "@/data/mock-farm";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — KRISHI-NEXUS" },
      {
        name: "description",
        content:
          "Set your farm profile, preferred language and how KRISHI-NEXUS alerts you about field decisions.",
      },
      { property: "og:title", content: "Settings — KRISHI-NEXUS" },
      {
        property: "og:description",
        content: "Farm profile, preferred language and alert preferences.",
      },
    ],
  }),
  component: SettingsPage,
});

const alerts = [
  { id: "weather", label: "Weather advisories", detail: "Rain, heat and wind warnings for your village" },
  { id: "pest", label: "Pest & disease alerts", detail: "Scouting thresholds crossed in any plot" },
  { id: "irrigation", label: "Irrigation reminders", detail: "When to open or hold the canal" },
  { id: "market", label: "Market price updates", detail: "Kolar mandi modal price movement" },
];

function SettingsPage() {
  return (
    <div className="space-y-5">
      <header className="panel field-grid p-5 sm:p-7">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <SettingsIcon className="size-6 text-primary" />
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interface preview — nothing is saved yet.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="text-lg font-bold">Farm profile</h2>
          <div className="mt-4 space-y-4">
            {[
              { id: "name", label: "Farmer name", value: farmer.name },
              { id: "village", label: "Village", value: farmer.village },
              { id: "district", label: "District", value: farmer.district },
              { id: "area", label: "Land holding", value: farmer.landHolding },
            ].map((field) => (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input id={field.id} defaultValue={field.value} className="rounded-xl" />
              </div>
            ))}
            <Button className="rounded-full">Save profile</Button>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-lg font-bold">Language</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used across the dashboard and spoken replies.
          </p>
          <div className="mt-3 flex gap-2">
            <Button className="rounded-full">English</Button>
            <Button variant="outline" className="rounded-full">
              ಕನ್ನಡ
            </Button>
          </div>

          <h2 className="mt-7 text-lg font-bold">Alerts</h2>
          <ul className="mt-3 space-y-3">
            {alerts.map((alert, index) => (
              <li
                key={alert.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-muted/40 p-3"
              >
                <div>
                  <p className="text-sm font-semibold">{alert.label}</p>
                  <p className="text-xs text-muted-foreground">{alert.detail}</p>
                </div>
                <Switch defaultChecked={index < 3} aria-label={alert.label} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

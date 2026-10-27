import { createRoot } from "react-dom/client";
import { TitleModelSettings } from "../src/TitleModelSettings";
import { ProductModelSettings } from "../src/product/ProductModelSettings";
import "../src/ui/tailwind.css";

const models = [{ provider: "test", id: "current", label: "Current model", thinking: ["off", "low"] }];
let titles = { selection: { provider: "test", model: "removed-title" } as { provider: string; model: string } | null, models };
let defaults = {
  models,
  profiles: [
    { name: "coordinator", description: "Run coordinator", provider: "test", model: "removed", thinking: "off" },
    { name: "standard", description: "Agents", provider: "test", model: "current", thinking: "max" },
  ],
};
window.fetch = async (_input, init) => {
  const call = JSON.parse(String(init?.body));
  if (call.method === "ragents.settings.titles.save") {
    titles = { ...titles, ...call.params.value };
    document.body.dataset.savedTitle = JSON.stringify(call.params.value);
  }
  if (call.method === "test.product.modelSettings.save") {
    const profiles = defaults.profiles.map((profile) => ({ ...profile, ...call.params.value.profiles.find((entry: { name: string }) => entry.name === profile.name) }));
    defaults = { ...defaults, profiles };
    document.body.dataset.savedDefaults = JSON.stringify(call.params.value);
  }
  return Response.json({ jsonrpc: "2.0", id: call.id, result: call.method.startsWith("ragents.settings.titles.") ? titles : defaults });
};
createRoot(document.getElementById("root")!).render(<main className="grid gap-8 p-6">
  <TitleModelSettings />
  <ProductModelSettings pluginId="test.product" />
</main>);

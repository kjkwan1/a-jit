import { loadCatalog } from "../src/capabilities/catalog.js";
import { compileComponent } from "../src/sandbox/compile.js";
import { ContractSchema, validateContract } from "../src/sandbox/contract.js";
import { createSandbox } from "../src/sandbox/sandbox.js";
import { createPageServer } from "../src/sandbox/server.js";

// Shows a few fixed components on the page, to check the page without a model.
const { capabilities, errors } = await loadCatalog(new URL("../examples/bindings/", import.meta.url).pathname);
if (errors.length) {
  console.error("Bindings failed to load:", errors);
  process.exit(1);
}
const sandbox = createSandbox();

// Stand-ins for what the model will eventually submit.
const sources: Record<string, string> = {
  counter: `
    import { useState } from "preact/hooks";

    export default function Counter() {
      const [count, setCount] = useState(0);
      return (
        <div style={{ fontFamily: "system-ui" }}>
          <h1>Counter</h1>
          <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
        </div>
      );
    }
  `,
  // Its <h1> rule should not restyle the counter's <h1>: slots are shadow-scoped.
  clock: `
    import { useEffect, useState } from "preact/hooks";

    export default function Clock() {
      const [now, setNow] = useState(new Date());
      useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
      }, []);
      return (
        <div style={{ fontFamily: "system-ui" }}>
          <style>{"h1 { color: crimson; }"}</style>
          <h1>Clock</h1>
          <p>{now.toLocaleTimeString()}</p>
        </div>
      );
    }
  `,
  // Live data from examples/bindings: an eager request that can re-run with
  // other input, an eager stream keeping the last 5 values, and a subscription
  // started and stopped by a button.
  weather: `
    import { useState } from "preact/hooks";
    import { useData } from "a-jit";

    const CITIES = {
      Berlin: { latitude: 52.52, longitude: 13.41 },
      Paris: { latitude: 48.85, longitude: 2.35 },
    };

    export default function Weather() {
      const [city, setCity] = useState("Berlin");
      const forecast = useData("forecast");
      const nas = useData("nas");
      const alerts = useData("alerts");
      const running = alerts.status === "loading" || alerts.status === "open";
      const temps = forecast.value?.temperature?.slice(0, 12) ?? [];

      const show = (name) => {
        setCity(name);
        forecast.run({ ...CITIES[name], fields: ["temperature"] });
      };

      return (
        <div style={{ fontFamily: "system-ui" }}>
          <h2>{city}, next 12 hours</h2>
          {Object.keys(CITIES).map((name) => (
            <button onClick={() => show(name)} disabled={name === city}>{name}</button>
          ))}
          <p>
            {forecast.status === "loading" ? "Loading… " : ""}
            {forecast.status === "error" ? "Forecast failed: " + forecast.error.message : ""}
            {temps.map((t) => Math.round(t) + "°").join("  ")}
          </p>
          <p>NAS CPU: {nas.value ? Math.round(nas.value.cpu_usage) + "%" : "…"} ({nas.values.length} readings kept)</p>
          <button onClick={() => (running ? alerts.cancel() : alerts.run())}>
            {running ? "Stop" : "Start"} backyard alerts
          </button>
          <ul>{alerts.values.map((a) => <li>{a.alert} ({a.entity})</li>)}</ul>
        </div>
      );
    }
  `,
  // Throws on render: should show an error in its own slot and leave the others alone.
  broken: `
    export default function Broken(): any {
      throw new Error("boom");
    }
  `,
};

const contracts: Record<string, unknown> = {
  weather: {
    forecast: {
      capability: "weather.hourly",
      start: "mount",
      input: { latitude: 52.52, longitude: 13.41, fields: ["temperature"] },
    },
    nas: { capability: "nas.telemetry", start: "mount", keep: 5 },
    alerts: { capability: "camera.telemetry", keep: "all", input: { name: "backyard" } },
  },
};

// Checked the same way submit_component checks the model's submissions.
for (const [id, source] of Object.entries(sources)) {
  const contract = ContractSchema.parse(contracts[id] ?? {});
  const contractErrors = validateContract(contract, capabilities);
  if (contractErrors.length) {
    console.error(`Contract invalid for "${id}":`, contractErrors);
    process.exit(1);
  }
  const result = await compileComponent(source, id);
  if (!result.ok) {
    console.error(`Compile failed for "${id}":`, result.errors);
    process.exit(1);
  }
  sandbox.set(id, result.code, contract);
}

console.log(`Open ${await createPageServer(sandbox, capabilities).start(3000)}`);

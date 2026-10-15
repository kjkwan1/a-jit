import weather from "../examples/weather.js";
import { compileComponent } from "../src/sandbox/compile.js";
import { createSandbox } from "../src/sandbox/sandbox.js";
import { createPageServer } from "../src/sandbox/server.js";

// Shows a few fixed components on the page, to check the page without a model.
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
  // Throws on render: should show an error in its own slot and leave the others alone.
  broken: `
    export default function Broken(): any {
      throw new Error("boom");
    }
  `,
};

for (const [id, source] of Object.entries(sources)) {
  const result = await compileComponent(source, id);
  if (!result.ok) {
    console.error(`Compile failed for "${id}":`, result.errors);
    process.exit(1);
  }
  sandbox.set(id, result.code);
}

console.log(`Open ${await createPageServer(sandbox, weather).start(3000)}`);

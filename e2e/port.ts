// Port of the hermetic e2e companion; override with SCOUT_E2E_PORT. It is never
// 47821, the default companion port, where a real companion may be serving.
export const PORT = process.env.SCOUT_E2E_PORT ?? "47899";
if (PORT === "47821") {
  throw new Error(
    "SCOUT_E2E_PORT must not be 47821, the real companion's port",
  );
}

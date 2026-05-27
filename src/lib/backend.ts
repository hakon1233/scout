// Resolves how Scout reaches Anthropic + Exa.
//
// - `local`  → call the @scout/sidecar at NEXT_PUBLIC_SCOUT_SIDECAR_URL
//              (default http://127.0.0.1:47832). API keys aren't needed.
// - `byo-key`→ call api.anthropic.com / api.exa.ai directly with the user's
//              own keys (the github.io static build's existing behaviour).
//
// We resolve at module-load time because Next exposes `NEXT_PUBLIC_*` as
// build-time constants in the static export.

const DEFAULT_SIDECAR_URL = "http://127.0.0.1:47832";

export type ScoutBackend = "local" | "byo-key";

function resolveBackend(): ScoutBackend {
  const raw = process.env.NEXT_PUBLIC_SCOUT_BACKEND?.trim().toLowerCase();
  if (raw === "local" || raw === "byo-key") return raw;
  // No explicit setting: default to BYO-key. `pnpm dev` will set NEXT_PUBLIC_SCOUT_BACKEND=local
  // via .env.local so local development gets the sidecar without rebuilds.
  return "byo-key";
}

function resolveSidecarUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SCOUT_SIDECAR_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_SIDECAR_URL).replace(/\/$/, "");
}

export const SCOUT_BACKEND: ScoutBackend = resolveBackend();
export const SIDECAR_URL: string = resolveSidecarUrl();

export const ANTHROPIC_ENDPOINT: string =
  SCOUT_BACKEND === "local"
    ? `${SIDECAR_URL}/anthropic/messages`
    : "https://api.anthropic.com/v1/messages";

export const EXA_ENDPOINT: string =
  SCOUT_BACKEND === "local"
    ? `${SIDECAR_URL}/exa/search`
    : "https://api.exa.ai/search";

export const BACKEND_NEEDS_USER_KEYS: boolean = SCOUT_BACKEND === "byo-key";

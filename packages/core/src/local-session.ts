// The Scout team account's automatic sign-in on the Mac (docs/ARCHITECTURE.md,
// "Signing in on the Mac"). The gateway holds TEAM_RUNNER_TOKEN and asks the
// Worker for a fresh session; the browser gets it the way a Supabase email
// link hands one over (the implicit flow's URL fragment), so src/lib/auth.ts
// stays the only owner of the session.
//
//   POST LOCAL_SESSION_PATH  `Authorization: Bearer <TEAM_RUNNER_TOKEN>`, no
//                            body -> LocalSession. The Worker creates the
//                            account once and marks it local.
//   GET  LOCAL_SIGNIN_PATH   on the gateway only, for the tailnet owner
//                            (`Tailscale-User-Login`): a redirect to the
//                            sign-in page with the session in the fragment.

export const LOCAL_SESSION_PATH = "/team/local-session";
export const LOCAL_SIGNIN_PATH = "/local-signin";
// The account's name in Supabase Auth (user_metadata.display_name).
export const LOCAL_ACCOUNT_NAME = "Scout team";

export type LocalSession = {
  accessToken: string;
  refreshToken: string;
  // Seconds until the access token expires.
  expiresIn: number;
  tokenType: "bearer";
};

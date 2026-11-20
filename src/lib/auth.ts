// Hosted sign-in: Google or an email link (magic link), no passwords.
//
// The only module that holds the Supabase client and the session
// (src/lib/boundaries.test.ts checks that nothing else imports supabase-js).
// Callers see five calls and plain-language errors; how the session is kept,
// refreshed and read back from the sign-in redirect stays in here.
//
// Every sign-in comes back to the sign-in page (`/app/signin/`). The client
// reads the session from the URL there, so a static export needs no callback
// route. The implicit flow puts the tokens in the URL fragment, which never
// reaches a server, and lets an email link opened on another device still sign
// that device in (the PKCE flow would need the browser that asked for the link).

import { createClient } from "@supabase/supabase-js";

export type AuthUser = { id: string; email: string | null };

export interface Auth {
  /** The signed-in reader, or null. Throws an AuthError when the page was
   *  opened from a sign-in link that failed (expired, already used). */
  currentUser(): Promise<AuthUser | null>;
  /** Leaves the page for Google; the reader comes back signed in. */
  signInWithGoogle(): Promise<void>;
  /** Emails a sign-in link. Throws an AuthError the page can show as is. */
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** The signed-in reader's access token (a JWT, refreshed when near expiry)
   *  for the hosted data calls, or null when signed out. */
  accessToken(): Promise<string | null>;
  /** Called with the reader on every sign-in and sign-out. Returns unsubscribe. */
  onAuthChange(listener: (user: AuthUser | null) => void): () => void;
}

/** A sign-in failure, with a message written for the reader. */
export class AuthError extends Error {
  override name = "AuthError";
}

/** The slice of supabase-js `client.auth` this module uses: the seam that
 *  tests fill with a stub. */
export type AuthClient = {
  initialize(): Promise<{ error: AuthClientError | null }>;
  getSession(): Promise<{
    data: { session: { user: ClientUser; access_token?: string } | null };
    error: AuthClientError | null;
  }>;
  signInWithOAuth(args: {
    provider: "google";
    options: { redirectTo: string };
  }): Promise<{ error: AuthClientError | null }>;
  signInWithOtp(args: {
    email: string;
    options: { emailRedirectTo: string; shouldCreateUser: boolean };
  }): Promise<{ error: AuthClientError | null }>;
  signOut(): Promise<{ error: AuthClientError | null }>;
  onAuthStateChange(
    callback: (event: string, session: { user: ClientUser } | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
};

type ClientUser = { id: string; email?: string | null };
type AuthClientError = { message: string; status?: number; code?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Builds the module over any AuthClient; the app uses `hostedAuth()`. */
export function createAuth(
  client: AuthClient,
  opts: { redirectTo: string; clearCallbackUrl?: () => void },
): Auth {
  return {
    async currentUser() {
      const init = await client.initialize();
      if (init.error) {
        opts.clearCallbackUrl?.();
        throw new AuthError(callbackMessage(init.error));
      }
      const { data, error } = await client.getSession();
      if (error) throw new AuthError(GENERIC);
      return toUser(data.session?.user);
    },

    async accessToken() {
      const { data, error } = await client.getSession();
      if (error) throw new AuthError(GENERIC);
      return data.session?.access_token ?? null;
    },

    async signInWithGoogle() {
      const { error } = await client.signInWithOAuth({
        provider: "google",
        options: { redirectTo: opts.redirectTo },
      });
      if (error) throw new AuthError(sendMessage(error));
    },

    async sendMagicLink(email) {
      const address = email.trim();
      if (!EMAIL.test(address)) {
        throw new AuthError("Enter an email address like name@example.com.");
      }
      const { error } = await client.signInWithOtp({
        email: address,
        options: { emailRedirectTo: opts.redirectTo, shouldCreateUser: true },
      });
      if (error) throw new AuthError(sendMessage(error));
    },

    async signOut() {
      const { error } = await client.signOut();
      if (error) throw new AuthError("Couldn't sign out. Try again.");
    },

    onAuthChange(listener) {
      const { data } = client.onAuthStateChange((_event, session) => {
        listener(toUser(session?.user));
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

const GENERIC = "Something went wrong. Try again.";

function toUser(user: ClientUser | undefined): AuthUser | null {
  return user ? { id: user.id, email: user.email ?? null } : null;
}

function sendMessage(error: AuthClientError): string {
  if (error.status === 429 || /rate.?limit/i.test(error.code ?? "")) {
    return "Too many sign-in attempts. Wait a minute and try again.";
  }
  if (/email_address_invalid|validation_failed/.test(error.code ?? "")) {
    return "Enter an email address like name@example.com.";
  }
  if (error.code === "provider_disabled" || error.code === "otp_disabled") {
    return "This sign-in option is turned off right now.";
  }
  return GENERIC;
}

function callbackMessage(error: AuthClientError): string {
  const text = `${error.code ?? ""} ${error.message}`;
  if (/otp_expired|expired|invalid/i.test(text)) {
    return "That sign-in link has expired or was already used. Send a new one.";
  }
  if (/access_denied/i.test(text)) {
    return "Sign-in was cancelled. Try again.";
  }
  return "Couldn't finish signing in. Try again.";
}

/** The hosted backend, read from public env vars at build time. Null when this
 *  build has none (the local companion build): hosted sign-in stays hidden. */
export function hostedConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

/** True in the hosted build: the app talks to Supabase and the Worker instead
 *  of a local companion. */
export function isHostedBuild(): boolean {
  return hostedConfig() !== null;
}

let hosted: Auth | null | undefined;

/** The app's one Auth, or null when the build has no hosted config. */
export function hostedAuth(): Auth | null {
  if (hosted !== undefined) return hosted;
  const config = hostedConfig();
  if (!config || typeof window === "undefined") return (hosted = null);
  const client = createClient(config.url, config.anonKey, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  hosted = createAuth(client.auth, {
    redirectTo: `${window.location.origin}${basePath}/app/signin/`,
    clearCallbackUrl: () =>
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      ),
  });
  return hosted;
}

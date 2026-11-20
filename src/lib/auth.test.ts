import assert from "node:assert/strict";
import test from "node:test";

import { AuthError, createAuth, hostedAuth, type AuthClient } from "./auth";

// The auth module over a stubbed client: no network, no Supabase.

const REDIRECT = "https://example.test/scout/app/signin/";
const anna = { id: "user-anna", email: "anna@example.test" };

type Session = { user: { id: string; email?: string | null } } | null;

function stubClient(over: Partial<AuthClient> = {}) {
  const calls: { name: string; args: unknown }[] = [];
  let listener: ((event: string, session: Session) => void) | null = null;
  let unsubscribed = false;
  const client: AuthClient = {
    async initialize() {
      return { error: null };
    },
    async getSession() {
      return { data: { session: null }, error: null };
    },
    async signInWithOAuth(args) {
      calls.push({ name: "signInWithOAuth", args });
      return { error: null };
    },
    async signInWithOtp(args) {
      calls.push({ name: "signInWithOtp", args });
      return { error: null };
    },
    async signOut() {
      calls.push({ name: "signOut", args: null });
      return { error: null };
    },
    onAuthStateChange(cb) {
      listener = cb;
      return {
        data: {
          subscription: {
            unsubscribe() {
              unsubscribed = true;
            },
          },
        },
      };
    },
    ...over,
  };
  return {
    client,
    calls,
    emit: (event: string, session: Session) => listener?.(event, session),
    isUnsubscribed: () => unsubscribed,
  };
}

test("currentUser is null when nobody is signed in", async () => {
  const auth = createAuth(stubClient().client, { redirectTo: REDIRECT });
  assert.equal(await auth.currentUser(), null);
});

test("currentUser returns the signed-in reader", async () => {
  const { client } = stubClient({
    async getSession() {
      return { data: { session: { user: anna } }, error: null };
    },
  });
  const auth = createAuth(client, { redirectTo: REDIRECT });
  assert.deepEqual(await auth.currentUser(), anna);
});

test("accessToken gives the session's token, or null when signed out", async () => {
  const signedOut = createAuth(stubClient().client, { redirectTo: REDIRECT });
  assert.equal(await signedOut.accessToken(), null);
  const { client } = stubClient({
    async getSession() {
      return {
        data: { session: { user: anna, access_token: "jwt-anna" } },
        error: null,
      };
    },
  });
  const auth = createAuth(client, { redirectTo: REDIRECT });
  assert.equal(await auth.accessToken(), "jwt-anna");
});

test("a failed sign-in link throws a plain message and clears the URL", async () => {
  let cleared = false;
  const { client } = stubClient({
    async initialize() {
      return {
        error: { message: "Email link is invalid or has expired" },
      };
    },
  });
  const auth = createAuth(client, {
    redirectTo: REDIRECT,
    clearCallbackUrl: () => (cleared = true),
  });
  await assert.rejects(auth.currentUser(), (e: unknown) => {
    assert.ok(e instanceof AuthError);
    assert.match(e.message, /expired or was already used/);
    return true;
  });
  assert.equal(cleared, true);
});

test("signInWithGoogle asks for Google and comes back to the sign-in page", async () => {
  const stub = stubClient();
  await createAuth(stub.client, { redirectTo: REDIRECT }).signInWithGoogle();
  assert.deepEqual(stub.calls, [
    {
      name: "signInWithOAuth",
      args: { provider: "google", options: { redirectTo: REDIRECT } },
    },
  ]);
});

test("sendMagicLink sends a trimmed address with the sign-in page as the link", async () => {
  const stub = stubClient();
  await createAuth(stub.client, { redirectTo: REDIRECT }).sendMagicLink(
    "  anna@example.test ",
  );
  assert.deepEqual(stub.calls, [
    {
      name: "signInWithOtp",
      args: {
        email: "anna@example.test",
        options: { emailRedirectTo: REDIRECT, shouldCreateUser: true },
      },
    },
  ]);
});

test("sendMagicLink refuses an address without calling the client", async () => {
  const stub = stubClient();
  const auth = createAuth(stub.client, { redirectTo: REDIRECT });
  for (const bad of ["", "anna", "anna@", "an na@example.test"]) {
    await assert.rejects(auth.sendMagicLink(bad), /name@example\.com/);
  }
  assert.deepEqual(stub.calls, []);
});

test("sendMagicLink turns a rate limit into a wait message", async () => {
  const { client } = stubClient({
    async signInWithOtp() {
      return {
        error: {
          message: "email rate limit exceeded",
          status: 429,
          code: "over_email_send_rate_limit",
        },
      };
    },
  });
  const auth = createAuth(client, { redirectTo: REDIRECT });
  await assert.rejects(auth.sendMagicLink("anna@example.test"), {
    name: "AuthError",
    message: "Too many sign-in attempts. Wait a minute and try again.",
  });
});

test("an unknown client error never leaks its raw text", async () => {
  const { client } = stubClient({
    async signInWithOAuth() {
      return { error: { message: "upstream 502 at gotrue:9999" } };
    },
  });
  const auth = createAuth(client, { redirectTo: REDIRECT });
  await assert.rejects(auth.signInWithGoogle(), {
    message: "Something went wrong. Try again.",
  });
});

test("signOut signs out, and reports a failure", async () => {
  const stub = stubClient();
  await createAuth(stub.client, { redirectTo: REDIRECT }).signOut();
  assert.equal(stub.calls[0].name, "signOut");

  const failing = stubClient({
    async signOut() {
      return { error: { message: "network" } };
    },
  });
  await assert.rejects(
    createAuth(failing.client, { redirectTo: REDIRECT }).signOut(),
    AuthError,
  );
});

test("onAuthChange reports sign-in and sign-out until unsubscribed", () => {
  const stub = stubClient();
  const seen: unknown[] = [];
  const stop = createAuth(stub.client, { redirectTo: REDIRECT }).onAuthChange(
    (user) => seen.push(user),
  );
  stub.emit("SIGNED_IN", { user: { id: "user-ben" } });
  stub.emit("SIGNED_OUT", null);
  assert.deepEqual(seen, [{ id: "user-ben", email: null }, null]);
  stop();
  assert.equal(stub.isUnsubscribed(), true);
});

test("hostedAuth is null in a build without the hosted config", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert.equal(hostedAuth(), null);
});

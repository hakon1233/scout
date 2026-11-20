"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ScoutWordmark } from "@/components/shell/AppShell";
import { Banner, Button, buttonClasses } from "@/components/ui";
import { hostedAuth, type AuthUser } from "@/lib/auth";

// Hosted sign-in: Google, or an emailed link. Every sign-in comes back here
// (src/lib/auth.ts), so this page also shows the signed-in state and a failed
// link. A build without the hosted config says sign-in isn't available.

type View =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { kind: "signedOut" }
  | { kind: "sent"; email: string }
  | { kind: "signedIn"; user: AuthUser };

export default function SignInPage() {
  const [view, setView] = useState<View>({ kind: "checking" });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "email" | "signOut" | null>(null);

  useEffect(() => {
    const auth = hostedAuth();
    if (!auth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView({ kind: "unavailable" });
      return;
    }
    auth
      .currentUser()
      .then((user) =>
        setView(user ? { kind: "signedIn", user } : { kind: "signedOut" }),
      )
      .catch((e: Error) => {
        setLinkError(e.message);
        setView({ kind: "signedOut" });
      });
    return auth.onAuthChange((user) => {
      setBusy(null);
      setView(user ? { kind: "signedIn", user } : { kind: "signedOut" });
    });
  }, []);

  async function continueWithGoogle() {
    const auth = hostedAuth();
    if (!auth) return;
    setGoogleError(null);
    setBusy("google");
    try {
      await auth.signInWithGoogle(); // the page leaves for Google
    } catch (e) {
      setGoogleError((e as Error).message);
      setBusy(null);
    }
  }

  async function sendLink(event: FormEvent) {
    event.preventDefault();
    const auth = hostedAuth();
    if (!auth) return;
    setFieldError(null);
    setBusy("email");
    try {
      await auth.sendMagicLink(email);
      setView({ kind: "sent", email: email.trim() });
    } catch (e) {
      setFieldError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    const auth = hostedAuth();
    if (!auth) return;
    setBusy("signOut");
    try {
      await auth.signOut();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-page font-sans text-primary">
      <div className="mx-auto w-full max-w-sm px-4 pt-3 sm:px-6 sm:pt-4">
        <ScoutWordmark />
      </div>
      <div
        data-main
        className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 pb-24 pt-8 sm:px-6 sm:pt-16"
      >
        {view.kind === "unavailable" && (
          <>
            <h1 className="font-serif text-title-1">Sign in</h1>
            <p className="text-secondary">
              Sign-in isn&rsquo;t available on this copy of Scout.
            </p>
            <Link href="/app/" className={buttonClasses("secondary")}>
              Go to your brief
            </Link>
          </>
        )}

        {view.kind === "signedOut" && (
          <>
            <h1 className="font-serif text-title-1">Sign in to Scout</h1>
            {linkError && <Banner tone="danger">{linkError}</Banner>}
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                className="w-full"
                loading={busy === "google"}
                disabled={busy !== null && busy !== "google"}
                onClick={() => void continueWithGoogle()}
              >
                Continue with Google
              </Button>
              {googleError && (
                <p role="alert" className="text-body-sm text-danger">
                  {googleError}
                </p>
              )}
            </div>
            <div
              className="flex items-center gap-3 text-body-sm text-muted"
              aria-hidden="true"
            >
              <span className="h-px flex-1 bg-border-default" />
              or
              <span className="h-px flex-1 bg-border-default" />
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => void sendLink(e)}
              noValidate
            >
              <label htmlFor="email" className="text-body-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "email-error" : undefined}
                placeholder="name@example.com"
                className="-mt-1 min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus-ring"
              />
              {fieldError && (
                <p
                  id="email-error"
                  role="alert"
                  className="text-body-sm text-danger"
                >
                  {fieldError}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                loading={busy === "email"}
                disabled={busy !== null && busy !== "email"}
              >
                Send link
              </Button>
            </form>
            <p className="text-body-sm text-muted">
              We email you a link that signs you in. No password.
            </p>
          </>
        )}

        {view.kind === "sent" && (
          <>
            <h1 className="font-serif text-title-1">Check your email</h1>
            <p role="status" className="text-secondary">
              We sent a sign-in link to{" "}
              <span className="break-all font-medium text-primary">
                {view.email}
              </span>
              . Open it on any device to sign in there.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setView({ kind: "signedOut" })}
            >
              Use a different email
            </Button>
          </>
        )}

        {view.kind === "signedIn" && (
          <>
            <h1 className="font-serif text-title-1">You&rsquo;re signed in</h1>
            <p className="text-secondary">
              Signed in as{" "}
              <span className="break-all font-medium text-primary">
                {view.user.email ?? "your account"}
              </span>
              .
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/app/" className={buttonClasses("primary")}>
                Go to your brief
              </Link>
              <Button
                variant="ghost"
                loading={busy === "signOut"}
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

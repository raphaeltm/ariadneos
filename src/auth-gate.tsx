import { createAuthClient } from "better-auth/react";
import { type ReactNode, useState } from "react";

export const authClient = createAuthClient();

export default function AuthGate({ children }: { children: ReactNode }) {
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        callbackURL: "/app",
        errorCallbackURL: "/app?login=failed",
        provider: "slack",
      });
      if (result.error) {
        setError(
          result.error.message ?? "Unable to sign in. Please try again."
        );
      }
    } catch {
      setError("Unable to reach Slack login. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (isPending) {
    return (
      <main aria-busy="true" className="login-page">
        Checking your session…
      </main>
    );
  }
  if (session) {
    return <>{children}</>;
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <a className="brand" href="/">
          Ariadne<span className="brand-os">OS</span>
        </a>
        <h1>Your work has a story.</h1>
        <p>Sign in with Slack to explore the processes behind it.</p>
        <button
          className="slack-login"
          disabled={busy}
          onClick={signIn}
          type="button"
        >
          {busy ? "Connecting…" : "Sign in with Slack"}
        </button>
        <p className="login-detail">
          Uses your Slack profile to sign you in, and to identify which Slack
          workspace's work to observe.
        </p>
        {(error ||
          sessionError ||
          new URLSearchParams(window.location.search).has("login")) && (
          <p role="alert">
            {error ||
              (sessionError
                ? "Login is temporarily unavailable. Please try again shortly."
                : "Slack sign-in was cancelled or failed. Please try again.")}
          </p>
        )}
      </section>
    </main>
  );
}

export function AccountMenu() {
  const { data: session } = authClient.useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("Unable to sign out. Try again.");
      }
    } catch {
      setError("Unable to sign out. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-menu">
      <span>{session?.user.name}</span>
      <button disabled={busy} onClick={signOut} type="button">
        Sign out
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type OAuthProvider = "google" | "linkedin_oidc";

type OAuthButtonsProps = {
  mode: "login" | "signup";
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="oauth-icon">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.34 2.98-7.35Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.63-2.42l-3.24-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.9A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.49l3.35-2.59Z" />
      <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="oauth-icon">
      <path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.29ZM5.32 7.41a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.1 20.45H3.54V8.98H7.1v11.47Z" />
    </svg>
  );
}

export function OAuthButtons({ mode }: OAuthButtonsProps) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  async function continueWith(provider: OAuthProvider) {
    if (pending) return;
    setPending(provider);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch {
      const path = mode === "signup" ? "/signup" : "/login";
      window.location.assign(`${path}?error=${encodeURIComponent("Could not start social sign in. Please try again.")}`);
    }
  }

  return (
    <div className="oauth-block" aria-label="Social sign in options">
      <div className="oauth-grid">
        <button
          type="button"
          className="oauth-button"
          disabled={pending !== null}
          onClick={() => continueWith("google")}
        >
          <GoogleIcon />
          <span>{pending === "google" ? "Connecting…" : "Continue with Google"}</span>
        </button>

        <button
          type="button"
          className="oauth-button"
          disabled={pending !== null}
          onClick={() => continueWith("linkedin_oidc")}
        >
          <LinkedInIcon />
          <span>{pending === "linkedin_oidc" ? "Connecting…" : "Continue with LinkedIn"}</span>
        </button>
      </div>

      <div className="auth-divider" role="separator">
        <span>or continue with email</span>
      </div>
    </div>
  );
}

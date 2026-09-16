import Link from "next/link";
import { signUp } from "../actions";
import { OAuthButtons } from "@/components/oauth-buttons";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/landing.html" className="brand brand-centered">
          <span className="brand-mark">S</span>
          <span>Schela</span>
        </Link>
        <div className="auth-heading">
          <span className="eyebrow">GET STARTED</span>
          <h1>Create your workspace</h1>
          <p>Set up the company, add interviewers, and let Schela coordinate the rest.</p>
        </div>
        {params.error ? <div className="alert alert-error">{params.error}</div> : null}
        <OAuthButtons mode="signup" />
        <form action={signUp} className="form-stack">
          <label>
            <span>Full name</span>
            <input name="fullName" autoComplete="name" required placeholder="Alex Morgan" />
          </label>
          <label>
            <span>Work email</span>
            <input name="email" type="email" autoComplete="email" required placeholder="alex@company.com" />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="8+ characters" />
          </label>
          <button className="button button-primary button-wide" type="submit">Create account</button>
        </form>
        <p className="auth-foot">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}

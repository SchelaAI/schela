import Link from "next/link";
import { signIn } from "../actions";
import { OAuthButtons } from "@/components/oauth-buttons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
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
          <span className="eyebrow">WELCOME BACK</span>
          <h1>Sign in to Schela</h1>
          <p>Continue coordinating interviews without the scheduling back-and-forth.</p>
        </div>
        {params.error ? <div className="alert alert-error">{params.error}</div> : null}
        {params.message ? <div className="alert alert-success">{params.message}</div> : null}
        <OAuthButtons mode="login" />
        <form action={signIn} className="form-stack">
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required minLength={8} placeholder="••••••••" />
          </label>
          <button className="button button-primary button-wide" type="submit">Sign in</button>
        </form>
        <p className="auth-foot">New to Schela? <Link href="/signup">Create an account</Link></p>
      </section>
    </main>
  );
}

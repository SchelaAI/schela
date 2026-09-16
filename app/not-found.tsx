import Link from "next/link";

export default function NotFound() {
  return <main className="fatal-error"><div className="panel fatal-error-card"><span className="eyebrow">404</span><h1>That page isn’t here.</h1><p>The link may be outdated or the resource is outside your workspace.</p><Link className="button button-primary" href="/dashboard">Back to dashboard</Link></div></main>;
}

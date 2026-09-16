"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="fatal-error">
      <div className="panel fatal-error-card">
        <span className="eyebrow">SCHELA</span>
        <h1>Something didn’t load correctly.</h1>
        <p>The error has been contained. Retry the page; if it keeps happening, check the integration and deployment logs.</p>
        <button className="button button-primary" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { completeOnboarding } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const params = await searchParams;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarding_completed, org_id")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed && profile?.org_id) redirect("/dashboard");

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="brand"><span className="brand-mark">S</span><span>Schela</span></div>
        <div className="progress-row"><span className="progress-dot active" /><span className="progress-line active" /><span className="progress-dot active" /><span className="progress-line active" /><span className="progress-dot active" /></div>
        <div className="auth-heading left">
          <span className="eyebrow">WORKSPACE SETUP</span>
          <h1>Tell Schela who you hire for.</h1>
          <p>This creates your private company workspace. You can add the interview panel right after onboarding.</p>
        </div>
        {params.error ? <div className="alert alert-error">{params.error}</div> : null}
        <form action={completeOnboarding} className="form-grid">
          <label className="span-2">
            <span>Your name</span>
            <input name="fullName" required defaultValue={profile?.full_name ?? ""} placeholder="Alex Morgan" />
          </label>
          <label className="span-2">
            <span>Company</span>
            <input name="company" required placeholder="Acme" />
          </label>
          <label>
            <span>Your role</span>
            <select name="role" required defaultValue="">
              <option value="" disabled>Select role</option>
              <option>Individual Recruiter</option><option>TA Lead</option><option>Hiring Manager</option><option>Team Lead</option><option>Founder</option><option>Other</option>
            </select>
          </label>
          <label>
            <span>Hiring team size</span>
            <select name="teamSize" required defaultValue="">
              <option value="" disabled>Select size</option><option>Solo</option><option>2–5</option><option>6–20</option><option>20+</option>
            </select>
          </label>
          <fieldset className="span-2 channel-fieldset">
            <legend>Preferred candidate channel</legend>
            <label className="radio-card"><input type="radio" name="channelPreference" value="wa" defaultChecked /><span><b>WhatsApp first</b><small>Use email as the fallback.</small></span></label>
            <label className="radio-card"><input type="radio" name="channelPreference" value="both" /><span><b>Smart channel</b><small>Let Schela choose between WhatsApp and email.</small></span></label>
            <label className="radio-card"><input type="radio" name="channelPreference" value="em" /><span><b>Email first</b><small>Useful for email-centric teams.</small></span></label>
          </fieldset>
          <button className="button button-primary span-2" type="submit">Finish setup</button>
        </form>
      </section>
    </main>
  );
}

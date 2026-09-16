import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { createInterview } from "../actions";

export default async function NewInterviewPage({ searchParams }: { searchParams: Promise<{ candidate?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const [{ data: candidates }, { data: interviewers }] = await Promise.all([
    supabase.from("candidates").select("id,name,email").eq("org_id", orgId).order("name"),
    supabase.from("interviewers").select("id,name,role").eq("org_id", orgId).order("name"),
  ]);
  const ready = Boolean(candidates?.length && interviewers?.length);
  return <div className="page-wrap narrow-page">
    <header className="page-header"><div><span className="eyebrow">NEW INTERVIEW</span><h1>Start a coordination flow</h1><p>Schela creates the thread now. The candidate chooses the actual interview time later.</p></div></header>
    {params.error ? <div className="alert alert-error">{params.error}</div> : null}
    {!candidates?.length ? <div className="alert alert-info">Add a candidate before creating an interview. <Link href="/candidates">Go to candidates →</Link></div> : null}
    {!interviewers?.length ? <div className="alert alert-info">Add at least one interviewer in Company settings first. <Link href="/settings/company">Add interviewer →</Link></div> : null}
    <section className="panel form-panel wizard-card"><div className="wizard-steps"><span className="active">1 Candidate</span><span className="active">2 Interview</span><span className="active">3 Outreach</span></div>
      <form action={createInterview} className="form-grid">
        <label className="span-2"><span>Candidate</span><select name="candidateId" required defaultValue={params.candidate ?? ""}><option value="" disabled>Select candidate</option>{candidates?.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}</select></label>
        <label className="span-2"><span>Role / position</span><input name="roleTitle" required placeholder="Senior Software Engineer" /></label>
        <label><span>Interviewer</span><select name="interviewerId" required defaultValue=""><option value="" disabled>Select interviewer</option>{interviewers?.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></label>
        <label><span>Duration</span><select name="duration" defaultValue="45"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
        <label><span>Scheduling provider</span><select name="format" defaultValue="Calendly"><option>Calendly</option></select></label>
        <label><span>First outreach channel</span><select name="channel" defaultValue={profile.channel_preference === "em" ? "em" : "wa"}><option value="wa">WhatsApp</option><option value="em">Email</option></select></label>
        <div className="span-2 flow-preview"><div><span>01</span><b>Create interview thread</b><small>No time is fabricated or pre-booked.</small></div><div><span>02</span><b>Send candidate outreach</b><small>Transport wiring comes from the connected provider.</small></div><div><span>03</span><b>Candidate books</b><small>Calendly webhook sets the real scheduled time.</small></div></div>
        <button disabled={!ready} className="button button-primary span-2" type="submit">Create interview & open thread</button>
      </form>
    </section>
  </div>;
}

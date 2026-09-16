import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { formatRelativeTime, initials } from "@/lib/format";
import { addCandidate } from "./actions";

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase, profile } = await requireAppUser();
  const { data: candidates } = await supabase.from("candidates").select("id,name,email,country_code,phone,time_zone,notes,created_at").eq("org_id", profile.org_id!).order("created_at", { ascending: false });
  return <div className="page-wrap">
    <header className="page-header"><div><span className="eyebrow">CANDIDATES</span><h1>Candidate workspace</h1><p>Add candidates first. Contact only begins when you explicitly create an interview.</p></div><Link className="button button-primary" href="/interviews/new">Create interview</Link></header>
    {params.error ? <div className="alert alert-error">{params.error}</div> : null}
    <section className="panel form-panel"><div className="panel-head"><div><h2>Add candidate</h2><p>No message is sent from this form.</p></div></div>
      <form action={addCandidate} className="candidate-form"><label><span>Name</span><input name="name" required placeholder="Priya Kapoor" /></label><label><span>Email</span><input name="email" type="email" required placeholder="priya@example.com" /></label><label><span>Country code</span><input name="countryCode" required defaultValue="+1" /></label><label><span>WhatsApp / phone</span><input name="phone" required placeholder="5551234567" /></label><label><span>Timezone</span><input name="timeZone" placeholder="America/New_York" /></label><label className="span-2"><span>Notes</span><textarea name="notes" rows={3} placeholder="Optional context for the recruiter" /></label><button className="button button-primary" type="submit">Add candidate</button></form>
    </section>
    <section className="panel"><div className="panel-head"><div><h2>All candidates</h2><p>{candidates?.length ?? 0} in this workspace</p></div></div>
      {candidates?.length ? <div className="candidate-list">{candidates.map((candidate) => <article className="candidate-row" key={candidate.id}><div className="avatar avatar-violet">{initials(candidate.name)}</div><div className="candidate-main"><b>{candidate.name}</b><span>{candidate.email} · {candidate.country_code}{candidate.phone}</span></div><span className="candidate-zone">{candidate.time_zone || "Timezone not set"}</span><span className="candidate-age">{formatRelativeTime(candidate.created_at)}</span><Link className="button button-secondary button-small" href={`/interviews/new?candidate=${encodeURIComponent(candidate.id)}`}>Interview</Link></article>)}</div> : <div className="empty-compact">No candidates yet. Add the first one above.</div>}
    </section>
  </div>;
}

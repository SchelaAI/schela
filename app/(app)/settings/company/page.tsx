import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { addInterviewer, removeInterviewer, updateCompany } from "./actions";

export default async function CompanySettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; welcome?: string }> }) {
  const params = await searchParams;
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const [{ data: org }, { data: interviewers }] = await Promise.all([
    supabase.from("organizations").select("name,website").eq("id", orgId).single(),
    supabase.from("interviewers").select("id,name,role,email,availability,created_at").eq("org_id", orgId).order("created_at"),
  ]);

  return <div className="page-wrap narrow-page">
    <header className="page-header"><div><span className="eyebrow">SETTINGS / COMPANY</span><h1>Company & interview panel</h1><p>These are the real people Schela can schedule candidates with.</p></div></header>
    {params.error ? <div className="alert alert-error">{params.error}</div> : null}
    {params.welcome ? <div className="alert alert-success">Workspace created. Add the interviewers Schela is allowed to schedule candidates with.</div> : null}
    <div className="settings-links"><Link className="active" href="/settings/company">Company</Link><Link href="/settings/integrations">Integrations</Link></div>
    <section className="panel form-panel"><div className="panel-head"><div><h2>Company profile</h2><p>The hiring brand candidates should see.</p></div></div>
      <form action={updateCompany} className="form-grid"><label><span>Company name</span><input name="name" required defaultValue={org?.name ?? ""} /></label><label><span>Website</span><input name="website" type="url" defaultValue={org?.website ?? ""} placeholder="https://company.com" /></label><button className="button button-primary form-submit" type="submit">Save company</button></form>
    </section>
    <section className="panel form-panel"><div className="panel-head"><div><h2>Interviewers</h2><p>Add the hiring managers or panel members you want available when creating interviews.</p></div><span className="count-pill">{interviewers?.length ?? 0}</span></div>
      <form action={addInterviewer} className="inline-form"><input name="name" required placeholder="Name" /><input name="role" placeholder="Role, e.g. Engineering Lead" /><input name="email" type="email" placeholder="Email" /><button className="button button-primary" type="submit">Add interviewer</button></form>
      <div className="member-list">{interviewers?.length ? interviewers.map((member) => <div className="member-row" key={member.id}><div className="avatar">{member.name.slice(0, 2).toUpperCase()}</div><div className="member-copy"><b>{member.name}</b><span>{member.role || "Interviewer"}{member.email ? ` · ${member.email}` : ""}</span></div><span className="availability">{member.availability}</span><form action={removeInterviewer}><input type="hidden" name="id" value={member.id} /><button className="text-button danger" type="submit">Remove</button></form></div>) : <div className="empty-compact">No interviewers added yet.</div>}</div>
    </section>
  </div>;
}

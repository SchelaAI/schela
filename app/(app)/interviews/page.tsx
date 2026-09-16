import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const [{ data: interviews }, { data: candidates }] = await Promise.all([
    supabase.from("interviews").select("id,candidate_id,role_title,interviewer,scheduled_at,duration_minutes,format,channel,ai_state,created_at").eq("org_id", orgId).order("created_at", { ascending: false }),
    supabase.from("candidates").select("id,name").eq("org_id", orgId),
  ]);
  const names = new Map((candidates ?? []).map((item) => [item.id, item.name]));
  return <div className="page-wrap"><header className="page-header"><div><span className="eyebrow">INTERVIEWS</span><h1>Interview coordination</h1><p>Every row is a real workflow. Unscheduled means the candidate has not confirmed a slot yet.</p></div><Link className="button button-primary" href="/interviews/new">New interview</Link></header>
    {params.error ? <div className="alert alert-error">{params.error}</div> : null}
    <section className="panel">{interviews?.length ? <div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Role</th><th>Interviewer</th><th>Channel</th><th>Status</th><th>Time</th></tr></thead><tbody>{interviews.map((item) => <tr key={item.id}><td>{names.get(item.candidate_id) ?? item.candidate_id}</td><td>{item.role_title ?? "—"}</td><td>{item.interviewer}</td><td>{item.channel === "wa" ? "WhatsApp" : "Email"}</td><td><span className={`status status-${item.ai_state}`}>{item.ai_state.replaceAll("_", " ")}</span></td><td>{formatDateTime(item.scheduled_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon">◫</span><h3>No interview workflows yet</h3><p>Create one after adding a candidate and interviewer.</p><Link className="button button-primary" href="/interviews/new">Create interview</Link></div>}</section>
  </div>;
}

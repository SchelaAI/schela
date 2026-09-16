import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

export default async function DashboardPage() {
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const [{ data: allCandidates }, { data: allInterviews }, { data: recentInterviews }, { data: conversations }] = await Promise.all([
    supabase.from("candidates").select("id,name").eq("org_id", orgId),
    supabase.from("interviews").select("id,scheduled_at,ai_state").eq("org_id", orgId),
    supabase.from("interviews").select("id,candidate_id,scheduled_at,role_title,ai_state,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(8),
    supabase.from("conversations").select("id,unread,escalated,updated_at").eq("org_id", orgId),
  ]);

  const candidateMap = new Map((allCandidates ?? []).map((candidate) => [candidate.id, candidate.name]));
  const interviewRows = recentInterviews ?? [];
  const pending = (allInterviews ?? []).filter((item) => ["sending_invitation", "waiting_reply", "scheduling", "rescheduling"].includes(item.ai_state)).length;
  const scheduled = (allInterviews ?? []).filter((item) => Boolean(item.scheduled_at)).length;
  const unread = (conversations ?? []).filter((item) => item.unread).length;
  const escalated = (conversations ?? []).filter((item) => item.escalated).length;

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div><span className="eyebrow">OVERVIEW</span><h1>Good to see you, {profile.full_name.split(" ")[0] || "there"}.</h1><p>Real activity from your Schela workspace. No placeholder metrics.</p></div>
        <div className="header-actions"><Link className="button button-secondary" href="/candidates">Add candidate</Link><Link className="button button-primary" href="/interviews/new">New interview</Link></div>
      </header>

      <section className="metric-grid">
        <article className="metric-card"><span>Active coordination</span><strong>{pending}</strong><small>Interviews awaiting outreach, reply, or a slot</small></article>
        <article className="metric-card"><span>Scheduled</span><strong>{scheduled}</strong><small>Recent interview records with a confirmed time</small></article>
        <article className="metric-card"><span>Unread threads</span><strong>{unread}</strong><small>Candidate conversations needing review</small></article>
        <article className="metric-card"><span>Escalations</span><strong>{escalated}</strong><small>Threads Schela has handed to a human</small></article>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Recent interviews</h2><p>Coordination state across your latest interview workflows.</p></div><Link href="/interviews">View all</Link></div>
        {interviewRows.length ? (
          <div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Role</th><th>Status</th><th>Schedule</th></tr></thead><tbody>
            {interviewRows.map((item) => <tr key={item.id}><td>{candidateMap.get(item.candidate_id) ?? item.candidate_id}</td><td>{item.role_title ?? "—"}</td><td><span className={`status status-${item.ai_state}`}>{item.ai_state.replaceAll("_", " ")}</span></td><td>{formatDateTime(item.scheduled_at)}</td></tr>)}
          </tbody></table></div>
        ) : <Empty title="No interviews yet" body="Add a candidate and create the first interview workflow." action="Create interview" href="/interviews/new" />}
      </section>
    </div>
  );
}

function Empty({ title, body, action, href }: { title: string; body: string; action: string; href: string }) {
  return <div className="empty-state"><span className="empty-icon">✦</span><h3>{title}</h3><p>{body}</p><Link className="button button-primary" href={href}>{action}</Link></div>;
}

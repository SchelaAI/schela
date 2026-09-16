import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { formatRelativeTime, initials } from "@/lib/format";

export default async function InboxPage() {
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const [{ data: conversations }, { data: candidates }] = await Promise.all([
    supabase.from("conversations").select("id,candidate_id,primary_channel,channel,unread,escalated,updated_at,interview_id").eq("org_id", orgId).order("updated_at", { ascending: false }),
    supabase.from("candidates").select("id,name,email").eq("org_id", orgId),
  ]);
  const candidateMap = new Map((candidates ?? []).map((candidate) => [candidate.id, candidate]));
  return <div className="page-wrap"><header className="page-header"><div><span className="eyebrow">SCHELA INBOX</span><h1>One thread, every channel.</h1><p>WhatsApp and email messages belong to the same interview conversation.</p></div></header>
    <section className="panel inbox-list">{conversations?.length ? conversations.map((conversation) => { const candidate = candidateMap.get(conversation.candidate_id); return <Link href={`/inbox/${conversation.id}`} className="thread-row" key={conversation.id}><div className="avatar avatar-violet">{initials(candidate?.name ?? conversation.candidate_id)}</div><div className="thread-main"><div><b>{candidate?.name ?? conversation.candidate_id}</b>{conversation.unread ? <span className="unread-dot" /> : null}</div><span>{candidate?.email ?? ""}</span></div><span className="channel-pill">{(conversation.primary_channel ?? conversation.channel) === "wa" ? "WhatsApp first" : "Email first"}</span>{conversation.escalated ? <span className="status status-escalated">Escalated</span> : null}<time>{formatRelativeTime(conversation.updated_at)}</time></Link>; }) : <div className="empty-state"><span className="empty-icon">◌</span><h3>No conversations yet</h3><p>Create an interview and its unified candidate thread will appear here.</p><Link className="button button-primary" href="/interviews/new">New interview</Link></div>}</section>
  </div>;
}

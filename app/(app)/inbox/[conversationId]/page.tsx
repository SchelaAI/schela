import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { formatDateTime, initials } from "@/lib/format";
import { sendManualMessage } from "./actions";
import { ConversationRealtime } from "@/components/conversation-realtime";

function deliveryLabel(status: string | null | undefined, delivered: boolean, error: string | null) {
  if (error || status === "failed") return "Failed";
  if (status === "read") return "Read";
  if (status === "delivered" || delivered) return "Delivered";
  if (status === "sent") return "Sent";
  if (status === "accepted") return "Accepted";
  if (status === "received") return "Received";
  return "Pending";
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{
    created?: string;
    pending?: string;
    outreach?: string;
    sent?: string;
    error?: string;
    deliveryError?: string;
  }>;
}) {
  const { conversationId } = await params;
  const query = await searchParams;
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;

  const { data: conversation } = await supabase
    .from("conversations")
    .select(
      "id,candidate_id,interview_id,primary_channel,channel,escalated,confidence,escalation_reason,updated_at",
    )
    .eq("id", conversationId)
    .eq("org_id", orgId)
    .single();

  if (!conversation) notFound();

  const [{ data: candidate }, { data: messages }] = await Promise.all([
    supabase
      .from("candidates")
      .select("name,email,country_code,phone,time_zone")
      .eq("id", conversation.candidate_id)
      .eq("org_id", orgId)
      .single(),
    supabase
      .from("messages")
      .select(
        "id,from_role,text,channel,sender_kind,sender_name,delivered,delivery_status,delivery_error,email_subject,created_at",
      )
      .eq("conversation_id", conversationId)
      .eq("org_id", orgId)
      .order("created_at"),
  ]);

  let interview: {
    id: number;
    role_title: string | null;
    interviewer: string;
    scheduled_at: string | null;
    ai_state: string;
    format: string;
    last_candidate_reply_at: string | null;
  } | null = null;

  if (conversation.interview_id) {
    const result = await supabase
      .from("interviews")
      .select("id,role_title,interviewer,scheduled_at,ai_state,format,last_candidate_reply_at")
      .eq("id", conversation.interview_id)
      .eq("org_id", orgId)
      .single();
    interview = result.data;
  }

  const lastReplyAt = interview?.last_candidate_reply_at
    ? new Date(interview.last_candidate_reply_at).getTime()
    : 0;
  const whatsappWindowOpen =
    Boolean(lastReplyAt) && Date.now() - lastReplyAt <= 24 * 60 * 60 * 1000;
  const latestInbound = [...(messages ?? [])].reverse().find((message) => message.from_role === "candidate");
  const manualChannel = latestInbound?.channel === "em" ? "em" : "wa";
  const manualComposerOpen = manualChannel === "em" || whatsappWindowOpen;

  return (
    <div className="thread-page">
      <ConversationRealtime conversationId={conversationId} interviewId={interview?.id ?? null} />
      <header className="thread-header">
        <Link href="/inbox" className="back-link">
          ← Inbox
        </Link>
        <div className="avatar avatar-violet">{initials(candidate?.name ?? "Candidate")}</div>
        <div className="thread-title">
          <h1>{candidate?.name ?? "Candidate"}</h1>
          <span>
            {interview?.role_title ?? "Interview"} · {interview?.interviewer ?? "Interviewer not set"}
          </span>
        </div>
        <div className="thread-meta">
          <span className={`status status-${interview?.ai_state ?? "sending_invitation"}`}>
            {(interview?.ai_state ?? "sending_invitation").replaceAll("_", " ")}
          </span>
          <span>{formatDateTime(interview?.scheduled_at ?? null)}</span>
        </div>
      </header>

      {query.outreach === "sent" ? (
        <div className="alert alert-success thread-alert">
          WhatsApp invitation accepted by Meta. Delivery/read state will update from provider webhooks.
        </div>
      ) : null}
      {query.outreach === "email-sent" ? (
        <div className="alert alert-success thread-alert">
          Interview invitation sent by email. Replies will return to this same Schela conversation.
        </div>
      ) : null}
      {query.sent ? (
        <div className="alert alert-success thread-alert">
          {query.sent === "email" ? "Email sent." : "WhatsApp message sent."}
        </div>
      ) : null}
      {query.deliveryError ? (
        <div className="alert alert-error thread-alert">Delivery failed: {query.deliveryError}</div>
      ) : null}
      {query.error ? <div className="alert alert-error thread-alert">{query.error}</div> : null}

      <div className="thread-layout">
        <section className="messages-panel">
          {messages?.length ? (
            <div className="messages-list">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`message-row ${message.from_role === "candidate" ? "incoming" : "outgoing"}`}
                >
                  <div className="message-bubble">
                    <div className="message-label">
                      <span>
                        {message.sender_name ||
                          (message.sender_kind === "human"
                            ? profile.full_name
                            : message.from_role === "candidate"
                              ? candidate?.name
                              : "Schela")}
                      </span>
                      <span>
                        {message.channel === "wa"
                          ? "WhatsApp"
                          : message.channel === "em"
                            ? "Email"
                            : "System"}
                      </span>
                    </div>
                    <p>{message.text}</p>
                    <div className="message-foot">
                      <time>{formatDateTime(message.created_at)}</time>
                      {message.from_role !== "candidate" ? (
                        <span className={message.delivery_error ? "delivery-failed" : undefined}>
                          {deliveryLabel(
                            message.delivery_status,
                            message.delivered,
                            message.delivery_error,
                          )}
                        </span>
                      ) : null}
                    </div>
                    {message.delivery_error ? (
                      <small className="message-error">{message.delivery_error}</small>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state thread-empty">
              <span className="empty-icon">✦</span>
              <h3>Conversation ready</h3>
              <p>No real candidate message has been sent or received yet.</p>
            </div>
          )}

          {manualComposerOpen ? (
            <form action={sendManualMessage} className="composer-live">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="channel" value={manualChannel} />
              <input
                name="text"
                required
                maxLength={3000}
                autoComplete="off"
                placeholder={manualChannel === "em" ? "Reply by email…" : "Reply on WhatsApp…"}
              />
              <button className="button button-primary" type="submit">
                Send
              </button>
            </form>
          ) : (
            <div className="composer-disabled">
              <input
                disabled
                placeholder={
                  interview?.last_candidate_reply_at
                    ? "WhatsApp free-form reply window is closed"
                    : "Composer opens after the candidate replies"
                }
              />
              <button className="button button-primary" disabled>
                Send
              </button>
            </div>
          )}
        </section>

        <aside className="thread-side">
          <div className="side-card">
            <span className="eyebrow">CANDIDATE</span>
            <h3>{candidate?.name}</h3>
            <p>{candidate?.email}</p>
            <p>
              {candidate?.country_code}
              {candidate?.phone}
            </p>
            <p>{candidate?.time_zone || "Timezone not set"}</p>
          </div>
          <div className="side-card">
            <span className="eyebrow">INTERVIEW</span>
            <dl>
              <div>
                <dt>Role</dt>
                <dd>{interview?.role_title ?? "—"}</dd>
              </div>
              <div>
                <dt>Interviewer</dt>
                <dd>{interview?.interviewer ?? "—"}</dd>
              </div>
              <div>
                <dt>Scheduling</dt>
                <dd>{interview?.format ?? "—"}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{formatDateTime(interview?.scheduled_at ?? null)}</dd>
              </div>
            </dl>
          </div>
          <div className="side-card accent-card">
            <b>Cross-channel model</b>
            <p>
              This interview keeps one conversation ID even when transport changes from WhatsApp to email.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendlyConnection, listCalendlyEventTypes } from "@/lib/calendly/client";
import { recordOperationalEvent } from "@/lib/observability/events";
import { disconnectCalendly, saveCalendlySettings } from "./actions";

function providerReady(keys: string[]) {
  return keys.every((key) => Boolean(process.env[key]?.trim()));
}

export default async function IntegrationsSettingsPage({ searchParams }: {
  searchParams: Promise<{ error?: string; connected?: string; saved?: string; disconnected?: string }>;
}) {
  const params = await searchParams;
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const admin = createAdminClient();
  const connection = await getCalendlyConnection(orgId);
  const { data: interviewers } = await admin
    .from("interviewers")
    .select("id,name,role,calendly_event_type_uri,calendly_event_type_name")
    .eq("org_id", orgId)
    .order("name");

  let eventTypes: Awaited<ReturnType<typeof listCalendlyEventTypes>> = [];
  let loadError = false;
  if (connection) {
    try {
      eventTypes = await listCalendlyEventTypes(orgId);
    } catch (error) {
      loadError = true;
      await recordOperationalEvent({ severity: "warning", source: "calendly", eventType: "settings_health_failed", orgId, message: error instanceof Error ? error.message : "Calendly health check failed" });
    }
  }

  const whatsappReady = providerReady(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"]);
  const emailReady = providerReady(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_FROM_ADDRESS", "EMAIL_REPLY_TO"]);
  const aiReady = providerReady(["GROQ_API_KEY"]);

  return <div className="page-wrap narrow-page">
    <header className="page-header"><div><span className="eyebrow">SETTINGS / INTEGRATIONS</span><h1>Scheduling integrations</h1><p>Provider readiness and the calendar Schela is allowed to use for real interview bookings.</p></div></header>
    <div className="settings-links"><Link href="/settings/company">Company</Link><Link className="active" href="/settings/integrations">Integrations</Link></div>
    {params.error ? <div className="alert alert-error">{params.error}</div> : null}
    {params.connected ? <div className="alert alert-success">Calendly connected. Choose the event type Schela should use.</div> : null}
    {params.saved ? <div className="alert alert-success">Calendly scheduling settings saved.</div> : null}
    {params.disconnected ? <div className="alert alert-info">Calendly disconnected.</div> : null}
    {loadError ? <div className="alert alert-error">Calendly is connected, but Schela could not reach its API right now. Try again before creating new scheduling links.</div> : null}

    <section className="metric-grid integration-health-grid">
      <article className="metric-card"><span>WhatsApp</span><strong>{whatsappReady ? "Ready" : "Setup"}</strong><small>{whatsappReady ? "Server credentials + webhook verification configured" : "One or more WhatsApp production envs are missing"}</small></article>
      <article className="metric-card"><span>Resend</span><strong>{emailReady ? "Ready" : "Setup"}</strong><small>{emailReady ? "Outbound + inbound webhook environment configured" : "One or more Resend/email envs are missing"}</small></article>
      <article className="metric-card"><span>Schela AI</span><strong>{aiReady ? "Ready" : "Setup"}</strong><small>{aiReady ? "Groq API key configured" : "GROQ_API_KEY is missing"}</small></article>
      <article className="metric-card"><span>Calendly</span><strong>{connection && !loadError ? "Ready" : connection ? "Check" : "Setup"}</strong><small>{connection ? (loadError ? "OAuth exists, API health check failed" : "OAuth + webhook subscription available") : "Connect Calendly below"}</small></article>
    </section>

    <section className="panel form-panel">
      <div className="panel-head"><div><h2>Calendly</h2><p>OAuth connection, event types, bookings, cancellations, and reschedules.</p></div><span className={`status ${connection ? "status-calendar_updated" : "status-waiting_reply"}`}>{connection ? "Connected" : "Not connected"}</span></div>
      {!connection ? <div className="integration-connect"><p>Connect your Calendly account so Schela can create one-time booking links and receive real booking events.</p><Link className="button button-primary" href="/api/integrations/calendly/connect">Connect Calendly</Link></div> : <>
        <div className="integration-account"><div><small>ACCOUNT</small><b>{connection.account_name || connection.account_email || "Calendly account"}</b><span>{connection.account_email || connection.webhook_scope || "Connected"}</span></div><div><small>WEBHOOK</small><b>{connection.webhook_scope === "organization" ? "Organization scope" : "User scope"}</b><span>Booking + cancellation events</span></div></div>
        <form action={saveCalendlySettings} className="form-grid">
          <label className="span-2"><span>Workspace default event type</span><select name="defaultEventType" defaultValue={connection.default_event_type_uri ?? ""}><option value="">Select an event type</option>{eventTypes.map((eventType) => <option key={eventType.uri} value={eventType.uri}>{eventType.name}{eventType.profile?.name ? ` · ${eventType.profile.name}` : ""}</option>)}</select><small>Used when an interviewer does not have their own mapping.</small></label>
          <div className="span-2 mapping-list"><h3>Interviewer event types</h3><p>Optional. Map a person to the exact Calendly event type Schela should send when that interviewer is selected.</p>{interviewers?.length ? interviewers.map((person) => <label key={person.id}><span>{person.name}{person.role ? ` · ${person.role}` : ""}</span><select name={`interviewer_${person.id}`} defaultValue={person.calendly_event_type_uri ?? ""}><option value="">Use workspace default</option>{eventTypes.map((eventType) => <option key={eventType.uri} value={eventType.uri}>{eventType.name}{eventType.profile?.name ? ` · ${eventType.profile.name}` : ""}</option>)}</select></label>) : <div className="empty-compact">Add interviewers in Company settings first.</div>}</div>
          <button className="button button-primary span-2" type="submit">Save Calendly settings</button>
        </form>
        <form action={disconnectCalendly}><button className="text-button danger" type="submit">Disconnect Calendly</button></form>
      </>}
    </section>
  </div>;
}

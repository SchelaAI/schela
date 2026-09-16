import { requireAppUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireAppUser();
  const { data: org } = await supabase.from("organizations").select("name").eq("id", profile.org_id!).single();

  return (
    <div className="app-shell">
      <Sidebar company={org?.name ?? profile.company ?? "Company"} userName={profile.full_name || profile.email} />
      <main className="app-main">{children}</main>
    </div>
  );
}

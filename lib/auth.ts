import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SchelaProfile = {
  id: string;
  org_id: string | null;
  full_name: string;
  email: string;
  onboarding_completed: boolean;
  company: string | null;
  onboarding_role: string | null;
  team_size: string | null;
  channel_preference: string | null;
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  return { supabase, user };
}

export async function requireAppUser() {
  const { supabase, user } = await requireUser();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, org_id, full_name, email, onboarding_completed, company, onboarding_role, team_size, channel_preference",
    )
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/onboarding?error=Profile%20not%20ready");
  }

  const typedProfile = profile as SchelaProfile;
  if (!typedProfile.onboarding_completed || !typedProfile.org_id) {
    redirect("/onboarding");
  }

  return { supabase, user, profile: typedProfile };
}

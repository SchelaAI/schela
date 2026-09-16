import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStoreHeaders } from "@/lib/http/security";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: noStoreHeaders() });
  }
}

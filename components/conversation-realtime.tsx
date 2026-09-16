"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function ConversationRealtime({
  conversationId,
  interviewId,
}: {
  conversationId: string;
  interviewId?: number | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 120);
    };

    const channel = supabase
      .channel(`schela-thread:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        refresh,
      );

    if (interviewId) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "interviews",
          filter: `id=eq.${interviewId}`,
        },
        refresh,
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, interviewId, router]);

  return null;
}

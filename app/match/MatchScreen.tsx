"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import MatchIdle from "./components/MatchIdle";
import MatchSearching from "./components/MatchSearching";
import MatchConnected from "./components/MatchConnected";
import MatchDisconnected from "./components/MatchDisconnected";
import { createSupabaseClient } from "@/lib/supabase";
import {
  cancelMatchSearch,
  enqueueAndMatch,
  ensurePartyUpIdentity,
  getCurrentMatchQueueState,
  getGlobalMatchPool,
  getMatchSession,
  type MatchSession,
} from "@/lib/matchmaking";

export type MatchState = "idle" | "searching" | "connected" | "disconnected";

export default function MatchScreen() {
  const [state, setState] = useState<MatchState>("idle");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<MatchSession | null>(null);
  const supabase = useMemo(() => createSupabaseClient(), []);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const clearSubscription = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, [supabase]);

  const fail = useCallback(
    (message: string) => {
      clearSubscription();
      setError(message);
      setSession(null);
      setState("idle");
    },
    [clearSubscription],
  );

  const transitionToMatched = useCallback(
    async (sessionId: string) => {
      try {
        const matchedSession = await getMatchSession(supabase, sessionId);
        clearSubscription();
        setSession(matchedSession);
        setError(null);
        setState("connected");
      } catch (reason) {
        fail(reason instanceof Error ? reason.message : "The matched session could not be loaded.");
      }
    },
    [clearSubscription, fail, supabase],
  );

  const subscribeToQueue = useCallback(
    (identityId: string) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        clearSubscription();

        const channel = supabase
          .channel(`match-queue:${identityId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "match_queue",
              filter: `identity_id=eq.${identityId}`,
            },
            (payload) => {
              const row = payload.new as { status?: string; match_session_id?: string | null };

              if (row.status === "matched" && row.match_session_id) {
                void transitionToMatched(row.match_session_id);
              }
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED" && !settled) {
              settled = true;
              resolve();
            }

            if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
              settled = true;
              const message = "Realtime matchmaking updates could not be started. Please try again.";
              reject(new Error(message));
              fail(message);
            }
          });

        channelRef.current = channel;
      }),
    [clearSubscription, fail, supabase, transitionToMatched],
  );

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      const { data, error: authError } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (authError) {
        setError(authError.message);
      }

      setUser(data.user ?? null);
      setAuthLoading(false);
    }

    loadUser();

    const { data } = supabase.auth.onAuthStateChange((_event, sessionData) => {
      const nextUser = sessionData?.user ?? null;
      setUser(nextUser);
      setAuthLoading(false);

      if (!nextUser) {
        clearSubscription();
        setSession(null);
        setBusy(false);
        setState("idle");
        setError("Sign in to use PartyUp Match.");
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      clearSubscription();
    };
  }, [clearSubscription, supabase]);

  async function startMatching() {
    setBusy(true);
    setError(null);
    setSession(null);

    try {
      const { data } = await supabase.auth.getUser();
      const currentUser = data.user;

      if (!currentUser) {
        setUser(null);
        setState("idle");
        setError("Sign in to use PartyUp Match.");
        return;
      }

      setUser(currentUser);

      const [partyUpIdentity, pool] = await Promise.all([
        ensurePartyUpIdentity(supabase),
        getGlobalMatchPool(supabase),
      ]);

      const result = await enqueueAndMatch(supabase, pool.id);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking succeeded but did not return a session.");
        }

        await transitionToMatched(result.session_id);
        return;
      }

      setState("searching");
      await subscribeToQueue(partyUpIdentity.id);

      const queueState = await getCurrentMatchQueueState(supabase, partyUpIdentity.id);
      if (queueState?.status === "matched" && queueState.match_session_id) {
        await transitionToMatched(queueState.match_session_id);
      }
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Matchmaking could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSearch() {
    setBusy(true);
    setError(null);

    try {
      await cancelMatchSearch(supabase);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The match search could not be cancelled.");
    } finally {
      clearSubscription();
      setSession(null);
      setState("idle");
      setBusy(false);
    }
  }

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/match`,
      },
    });
  }

  return (
    <div className="min-h-[70vh]">
      {state === "idle" && (
        <MatchIdle
          authLoading={authLoading}
          busy={busy}
          error={error}
          isAuthenticated={Boolean(user)}
          onSignIn={signIn}
          onStart={startMatching}
        />
      )}
      {state === "searching" && <MatchSearching busy={busy} onCancel={cancelSearch} />}
      {state === "connected" && <MatchConnected sessionId={session?.id ?? null} />}
      {state === "disconnected" && <MatchDisconnected onRematch={startMatching} />}
    </div>
  );
}

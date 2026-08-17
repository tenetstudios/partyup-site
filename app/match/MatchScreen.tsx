"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import MatchIdle from "./components/MatchIdle";
import MatchSearching from "./components/MatchSearching";
import MatchDisconnected from "./components/MatchDisconnected";
import MatchLiveKit from "./MatchLiveKit";
import { createSupabaseClient } from "@/lib/supabase";
import {
  cancelMatchSearch,
  enqueueAndMatch,
  ensurePartyUpIdentity,
  getCurrentMatchQueueState,
  getGlobalMatchPool,
  getMatchSession,
  isMatchSessionExpired,
  nextMatch,
  type MatchSession,
} from "@/lib/matchmaking";

export type MatchState = "idle" | "searching" | "connected" | "disconnected";

export default function MatchScreen() {
  const [state, setState] = useState<MatchState>("idle");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nextBusy, setNextBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectedMessage, setDisconnectedMessage] = useState<string | null>(null);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [searchIdentityId, setSearchIdentityId] = useState<string | null>(null);
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
      setSearchIdentityId(null);
      setNextBusy(false);
      setState("idle");
    },
    [clearSubscription],
  );

  const transitionToMatched = useCallback(
    async (sessionId: string) => {
      try {
        const matchedSession = await getMatchSession(supabase, sessionId);

        if (isMatchSessionExpired(matchedSession)) {
          try {
            await cancelMatchSearch(supabase);
          } catch {
            // The stale matched queue row may not be cancellable by the current RPC.
          }

          throw new Error(
            "The matchmaking RPC returned an expired Match session. Clear the stale match_queue row for this user, then start matching again.",
          );
        }

        clearSubscription();
        setSession(matchedSession);
        setSearchIdentityId(null);
        setDisconnectedMessage(null);
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

  const checkCurrentQueueForMatch = useCallback(
    async (identityId: string) => {
      const queueState = await getCurrentMatchQueueState(supabase, identityId);

      if (queueState?.status === "matched" && queueState.match_session_id) {
        await transitionToMatched(queueState.match_session_id);
      }
    },
    [supabase, transitionToMatched],
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
        setSearchIdentityId(null);
        setNextBusy(false);
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

  useEffect(() => {
    if (state !== "searching" || !searchIdentityId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void checkCurrentQueueForMatch(searchIdentityId).catch((reason) => {
        fail(reason instanceof Error ? reason.message : "Matchmaking updates could not be checked.");
      });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkCurrentQueueForMatch, fail, searchIdentityId, state]);

  useEffect(() => {
    if (state !== "connected" || !session?.id) {
      return;
    }

    const channel = supabase
      .channel(`match-session:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const row = payload.new as { status?: string; ended_reason?: string | null };

          if (row.status === "ended" && !nextBusy) {
            setSession(null);
            setSearchIdentityId(null);
            setNextBusy(false);
            setDisconnectedMessage(row.ended_reason === "next" ? "They moved on." : "Connection ended.");
            setState("disconnected");
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [nextBusy, session?.id, state, supabase]);

  async function startMatching() {
    setBusy(true);
    setError(null);
    setDisconnectedMessage(null);
    setSession(null);
    setSearchIdentityId(null);
    setNextBusy(false);
    clearSubscription();

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

      try {
        await cancelMatchSearch(supabase);
      } catch {
        // Starting a new search should not be blocked if there was no active search to cancel.
      }

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
      setSearchIdentityId(partyUpIdentity.id);
      await subscribeToQueue(partyUpIdentity.id);
      await checkCurrentQueueForMatch(partyUpIdentity.id);
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
      setSearchIdentityId(null);
      setNextBusy(false);
      setState("idle");
      setBusy(false);
    }
  }

  async function handleNextMatch(sessionId: string) {
    if (nextBusy) {
      return;
    }

    setNextBusy(true);
    setError(null);
    setDisconnectedMessage(null);

    try {
      const result = await nextMatch(supabase, sessionId);
      setSession(null);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking returned a match without a session.");
        }

        await transitionToMatched(result.session_id);
        return;
      }

      const identity = await ensurePartyUpIdentity(supabase);
      setState("searching");
      setSearchIdentityId(identity.id);
      await subscribeToQueue(identity.id);
      await checkCurrentQueueForMatch(identity.id);
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Could not move to the next Match.");
    } finally {
      setNextBusy(false);
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

  function returnToMatch() {
    clearSubscription();
    setSession(null);
    setSearchIdentityId(null);
    setNextBusy(false);
    setBusy(false);
    setState("idle");
  }

  const handleMatchExpired = useCallback(() => {
    void cancelMatchSearch(supabase).finally(() => {
      clearSubscription();
      setSession(null);
      setSearchIdentityId(null);
      setNextBusy(false);
      setBusy(false);
      setError("That match session expired. Start matching again to create a fresh connection.");
      setState("idle");
    });
  }, [clearSubscription, supabase]);

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
      {state === "connected" && session?.id && (
        <MatchLiveKit
          nextBusy={nextBusy}
          onMatchExpired={handleMatchExpired}
          onNextMatch={handleNextMatch}
          sessionId={session.id}
          onReturnToMatch={returnToMatch}
        />
      )}
      {state === "disconnected" && (
        <MatchDisconnected
          message={disconnectedMessage ?? undefined}
          onRematch={startMatching}
        />
      )}
    </div>
  );
}

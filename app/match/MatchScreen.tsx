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
  claimGuestIdentity,
  createGuestSession,
  enqueueAndMatch,
  ensurePartyUpIdentity,
  guestCancelMatchSearch,
  guestEnqueueAndMatch,
  guestGetCurrentMatchQueueState,
  guestNextMatch,
  getCurrentMatchQueueState,
  getGlobalMatchPool,
  getMatchSession,
  getMatchPool,
  isMatchSessionExpired,
  nextMatch,
  readStoredGuestSession,
  type MatchPool,
  type MatchSession,
} from "@/lib/matchmaking";

export type MatchState = "idle" | "searching" | "connected" | "disconnected";
type MatchIdentityMode = "account" | "guest";

export default function MatchScreen({ initialPoolId = null }: { initialPoolId?: string | null }) {
  const [state, setState] = useState<MatchState>("idle");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [poolLoading, setPoolLoading] = useState(Boolean(initialPoolId));
  const [activePool, setActivePool] = useState<MatchPool | null>(null);
  const [identityMode, setIdentityMode] = useState<MatchIdentityMode>("account");
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestIdentityId, setGuestIdentityId] = useState<string | null>(null);
  const [guestClaimMessage, setGuestClaimMessage] = useState<string | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectedMessage, setDisconnectedMessage] = useState<string | null>(null);
  const [session, setSession] = useState<MatchSession | null>(null);
  const [searchIdentityId, setSearchIdentityId] = useState<string | null>(null);
  const supabase = useMemo(() => createSupabaseClient(), []);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isEventMatch = Boolean(initialPoolId);
  const poolContextLabel = isEventMatch ? "Matching with people here" : null;
  const isGuest = identityMode === "guest";

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

  const cancelCurrentSearch = useCallback(async () => {
    if (isGuest && guestToken) {
      await guestCancelMatchSearch(supabase, guestToken);
      return;
    }

    await cancelMatchSearch(supabase);
  }, [guestToken, isGuest, supabase]);

  const transitionToMatched = useCallback(
    async (sessionId: string) => {
      try {
        const matchedSession = await getMatchSession(supabase, sessionId);

        if (isMatchSessionExpired(matchedSession)) {
          await cancelCurrentSearch().catch(() => {
            // The stale matched queue row may not be cancellable by the current RPC.
          });

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
    [cancelCurrentSearch, clearSubscription, fail, supabase],
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
      const queueState =
        isGuest && guestToken
          ? await guestGetCurrentMatchQueueState(supabase, guestToken)
          : await getCurrentMatchQueueState(supabase, identityId);

      if (queueState?.status === "matched" && queueState.match_session_id) {
        await transitionToMatched(queueState.match_session_id);
      }
    },
    [guestToken, isGuest, supabase, transitionToMatched],
  );

  const transitionToDisconnected = useCallback((message: string) => {
    setSession(null);
    setSearchIdentityId(null);
    setNextBusy(false);
    setDisconnectedMessage(message);
    setState("disconnected");
  }, []);

  const checkCurrentSessionEnded = useCallback(
    async (sessionId: string) => {
      const currentSession = await getMatchSession(supabase, sessionId);

      if (currentSession.status === "ended" && !nextBusy) {
        transitionToDisconnected(
          currentSession.ended_reason === "next" ? "They moved on." : "Connection ended.",
        );
      }
    },
    [nextBusy, supabase, transitionToDisconnected],
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

      const storedGuest = readStoredGuestSession();
      if (storedGuest) {
        setGuestToken(storedGuest.guestToken);
        setGuestIdentityId(storedGuest.identityId);
      }

      setUser(data.user ?? null);
      setAuthLoading(false);

      if (data.user && storedGuest?.guestToken) {
        try {
          const claim = await claimGuestIdentity(supabase, storedGuest.guestToken);

          if (!mounted) {
            return;
          }

          if (claim.claimed) {
            setGuestToken(null);
            setGuestIdentityId(null);
            setIdentityMode("account");
            setGuestClaimMessage("Your guest Match history is saved to this Google account.");
            return;
          }

          if (claim.conflict) {
            setGuestClaimMessage(claim.message ?? "Guest history attachment needs review.");
          }
        } catch {
          // Claiming should not block normal authenticated Match.
        }
      }
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
        setIdentityMode(readStoredGuestSession() ? "guest" : "account");
        setState("idle");
        setError(null);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      clearSubscription();
    };
  }, [clearSubscription, supabase]);

  useEffect(() => {
    let mounted = true;

    async function resolveInitialPool() {
      if (!initialPoolId) {
        setPoolLoading(false);
        setActivePool(null);
        return;
      }

      setPoolLoading(true);
      setError(null);

      try {
        const pool = await getMatchPool(supabase, initialPoolId);

        if (!mounted) {
          return;
        }

        setActivePool(pool);
      } catch (reason) {
        if (!mounted) {
          return;
        }

        setActivePool(null);
        setError(reason instanceof Error ? reason.message : "That Match pool could not be loaded.");
      } finally {
        if (mounted) {
          setPoolLoading(false);
        }
      }
    }

    void resolveInitialPool();

    return () => {
      mounted = false;
    };
  }, [initialPoolId, supabase]);

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
            transitionToDisconnected(row.ended_reason === "next" ? "They moved on." : "Connection ended.");
          }
        },
      )
      .subscribe();

    const intervalId = window.setInterval(() => {
      void checkCurrentSessionEnded(session.id).catch(() => {
        // Realtime is primary; polling is only a fallback for missed session updates.
      });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [checkCurrentSessionEnded, nextBusy, session?.id, state, supabase, transitionToDisconnected]);

  async function startMatching() {
    if (poolLoading) {
      return;
    }

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

      setUser(currentUser ?? null);

      try {
        await cancelCurrentSearch();
      } catch {
        // Starting a new search should not be blocked if there was no active search to cancel.
      }

      const pool = initialPoolId
        ? await getMatchPool(supabase, initialPoolId)
        : await getGlobalMatchPool(supabase);

      let identityId: string;
      let result;

      if (currentUser) {
        setIdentityMode("account");
        const partyUpIdentity = await ensurePartyUpIdentity(supabase);
        identityId = partyUpIdentity.id;
        result = await enqueueAndMatch(supabase, pool.id);
      } else {
        const guestSession = await createGuestSession(supabase);
        setIdentityMode("guest");
        setGuestToken(guestSession.guestToken);
        setGuestIdentityId(guestSession.identityId);
        identityId = guestSession.identityId;
        result = await guestEnqueueAndMatch(supabase, pool.id, guestSession.guestToken);
      }

      setActivePool(pool);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking succeeded but did not return a session.");
        }

        await transitionToMatched(result.session_id);
        return;
      }

      setState("searching");
      setSearchIdentityId(identityId);
      if (currentUser) {
        await subscribeToQueue(identityId);
      }
      await checkCurrentQueueForMatch(identityId);
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
      await cancelCurrentSearch();
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
      const result =
        isGuest && guestToken
          ? await guestNextMatch(supabase, sessionId, guestToken)
          : await nextMatch(supabase, sessionId);
      setSession(null);

      if (result.matched) {
        if (!result.session_id) {
          throw new Error("Matchmaking returned a match without a session.");
        }

        await transitionToMatched(result.session_id);
        return;
      }

      const identityId =
        isGuest && guestIdentityId ? guestIdentityId : (await ensurePartyUpIdentity(supabase)).id;
      setState("searching");
      setSearchIdentityId(identityId);
      if (!isGuest) {
        await subscribeToQueue(identityId);
      }
      await checkCurrentQueueForMatch(identityId);
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Could not move to the next Match.");
    } finally {
      setNextBusy(false);
    }
  }

  async function signIn() {
    const matchPath = initialPoolId
      ? `/match?pool=${encodeURIComponent(initialPoolId)}`
      : "/match";

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${matchPath}`,
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
    void cancelCurrentSearch().finally(() => {
      clearSubscription();
      setSession(null);
      setSearchIdentityId(null);
      setNextBusy(false);
      setBusy(false);
      setError("That match session expired. Start matching again to create a fresh connection.");
      setState("idle");
    });
  }, [cancelCurrentSearch, clearSubscription]);

  return (
    <div className="min-h-[70vh]">
      {state === "idle" && (
        <MatchIdle
          authLoading={authLoading}
          busy={busy || poolLoading}
          error={error}
          contextLabel={poolContextLabel}
          guestClaimMessage={guestClaimMessage}
          hasGuestSession={Boolean(guestToken)}
          isAuthenticated={Boolean(user)}
          onSignIn={signIn}
          onStart={startMatching}
        />
      )}
      {state === "searching" && (
        <MatchSearching
          busy={busy}
          contextLabel={activePool?.pool_type === "event" ? "Matching with people here" : null}
          onCancel={cancelSearch}
        />
      )}
      {state === "connected" && session?.id && (
        <MatchLiveKit
          nextBusy={nextBusy}
          guestToken={isGuest ? guestToken : null}
          isGuest={isGuest}
          onGuestSignIn={signIn}
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

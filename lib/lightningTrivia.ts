import type { SupabaseClient } from "@supabase/supabase-js";
import { requestPushDispatch } from "./pushDispatch";

export type TriviaQuestion = {
  id: string;
  question_text: string;
  answers: string[];
  correct_answer: number;
  category: string | null;
  difficulty: string | null;
  status: "active" | "archived";
};

export type TriviaStanding = {
  faction_key: string;
  participant_count: number;
  counted_count: number;
  average_score: number;
  counted_correct_answers: number;
  average_correct_response_ms: number | null;
  eligible: boolean;
  placement: number | null;
};

export type TriviaRoundSummary = {
  id: string;
  room_id: string;
  status: "draft" | "scheduled" | "active" | "scoring" | "ended" | "cancelled";
  starts_at: string;
  question_count: number;
  seconds_per_question: number;
  feedback_ms: number;
  territory_key: string | null;
  participant_count: number;
  standings: TriviaStanding[] | null;
  reward_status: "pending" | "applied" | "not_wild" | "wild_ended" | "cancelled";
};

export type TriviaPlayerState = {
  round: TriviaRoundSummary & { minimum_faction_participants: number };
  joined: boolean;
  faction_key: string | null;
  questions: Array<{
    question_order: number;
    question_text: string;
    answers: string[];
    category: string | null;
  }>;
  answers: Array<{
    question_order: number;
    selected_answer: number;
    is_correct: boolean;
    score_awarded: number;
    response_ms: number;
  }>;
  player_result: null | {
    total_score: number;
    correct_count: number;
    average_correct_response_ms: number | null;
    counted_for_faction: boolean;
  };
};

export const triviaFeedbackMs = 650;

export function getTriviaTimeline(
  startsAt: string,
  secondsPerQuestion: number,
  feedbackMs: number,
  now = Date.now(),
) {
  const start = Date.parse(startsAt);
  const elapsed = now - start;
  const slotMs = secondsPerQuestion * 1000 + feedbackMs;
  if (elapsed < 0) return { phase: "countdown" as const, countdownMs: -elapsed, questionIndex: -1, remainingMs: 0 };
  const questionIndex = Math.floor(elapsed / slotMs);
  if (questionIndex >= 10) return { phase: "complete" as const, countdownMs: 0, questionIndex: 10, remainingMs: 0 };
  const withinSlot = elapsed - questionIndex * slotMs;
  if (withinSlot < secondsPerQuestion * 1000) {
    return { phase: "question" as const, countdownMs: 0, questionIndex, remainingMs: secondsPerQuestion * 1000 - withinSlot };
  }
  return { phase: "feedback" as const, countdownMs: 0, questionIndex, remainingMs: slotMs - withinSlot };
}

export async function getRoomTrivia(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_room_lightning_trivia", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as TriviaRoundSummary | null;
}

export async function getTriviaPlayerState(supabase: SupabaseClient, roundId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("get_lightning_trivia_player_state", {
    p_round_id: roundId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as TriviaPlayerState;
}

export async function joinTriviaRound(supabase: SupabaseClient, roundId: string, guestToken?: string | null) {
  const { data, error } = await supabase.rpc("join_lightning_trivia_round", {
    p_round_id: roundId,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function submitTriviaAnswer(
  supabase: SupabaseClient,
  roundId: string,
  questionOrder: number,
  selectedAnswer: number,
  guestToken?: string | null,
) {
  const { data, error } = await supabase.rpc("submit_lightning_trivia_answer", {
    p_round_id: roundId,
    p_question_order: questionOrder,
    p_selected_answer: selectedAnswer,
    p_guest_token: guestToken ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { correct: boolean; score_awarded: number; response_ms: number; locked: boolean };
}

export async function saveTriviaQuestion(
  supabase: SupabaseClient,
  input: { roomId: string; id?: string | null; question: string; answers: string[]; correctAnswer: number; category?: string; difficulty?: string },
) {
  const { data, error } = await supabase.rpc("upsert_trivia_question", {
    p_room_id: input.roomId,
    p_question_id: input.id ?? null,
    p_question_text: input.question,
    p_answers: input.answers,
    p_correct_answer: input.correctAnswer,
    p_category: input.category?.trim() || null,
    p_difficulty: input.difficulty?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as TriviaQuestion;
}

export async function createTriviaRound(
  supabase: SupabaseClient,
  input: {
    roomId: string; questionIds: string[]; countdownSeconds: number; secondsPerQuestion: number;
    wildGameId?: string | null; territoryKey?: string | null; minimumParticipants: number;
    rewards: [number, number, number];
  },
) {
  const { data, error } = await supabase.rpc("create_lightning_trivia_round", {
    p_room_id: input.roomId,
    p_question_ids: input.questionIds,
    p_starts_at: null,
    p_seconds_per_question: input.secondsPerQuestion,
    p_countdown_seconds: input.countdownSeconds,
    p_wild_game_id: input.wildGameId ?? null,
    p_territory_key: input.territoryKey ?? null,
    p_minimum_faction_participants: input.minimumParticipants,
    p_first_place_reward: input.rewards[0],
    p_second_place_reward: input.rewards[1],
    p_third_place_reward: input.rewards[2],
  });
  if (error) throw new Error(error.message);
  requestPushDispatch(supabase, input.roomId);
  return data as TriviaRoundSummary;
}

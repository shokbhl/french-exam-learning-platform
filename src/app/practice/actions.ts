"use server";

import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * The practice runner's server side.
 *
 * Every grading decision is made by the database. `submit_attempt_response`
 * holds the key and writes the response, the mistake record, and the review
 * card in one transaction; `attempt_review` releases the explanations only
 * once the attempt is submitted. Nothing here compares an answer, because a
 * comparison in this file would mean shipping the key to reach it.
 */

const uuid = z.string().uuid();
const SESSION_EXPIRED = "Votre session a expiré.";
const NOT_CONFIGURED = "Mode démonstration : configurez Supabase pour enregistrer vos réponses.";

export type StartResult = { ok: true; attemptId: string } | { ok: false; message: string };
export type AnswerResult = { ok: true } | { ok: false; message: string };

export type ReviewEvidence = {
  source_file_id: string | null;
  source_version: number | null;
  page_number: number | null;
  evidence_text: string;
};

export type ReviewOption = {
  stable_key: string;
  label: string;
  is_correct: boolean;
  explanation: string | null;
};

export type ReviewItem = {
  question_version_id: string;
  prompt: string;
  your_answer: unknown;
  score: number | null;
  explanation: string | null;
  options: ReviewOption[];
  evidence: ReviewEvidence[];
};

export type FinishResult =
  | { ok: true; score: number; total: number; correct: number; items: ReviewItem[] }
  | { ok: false; message: string };

/** Opens an attempt for a practice set. The row is owned by the learner. */
export async function startAttempt(practiceSetId: string): Promise<StartResult> {
  if (!isSupabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!uuid.safeParse(practiceSetId).success) return { ok: false, message: "Exercice introuvable." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: SESSION_EXPIRED };

  const limit = rateLimit(`attempt:${user.id}`, 20, 60);
  if (!limit.allowed) {
    return { ok: false, message: `Trop de tentatives. Réessayez dans ${limit.retryAfterSeconds} secondes.` };
  }

  const { data, error } = await supabase
    .from("attempts")
    .insert({ user_id: user.id, practice_set_id: practiceSetId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("attempt start failed", error?.message);
    return { ok: false, message: "La tentative n’a pas pu être ouverte." };
  }
  return { ok: true, attemptId: data.id };
}

/**
 * Records one answer.
 *
 * The return value deliberately carries no verdict: the database knows whether
 * the answer was right, but telling the browser now would let a learner probe
 * the key one option at a time. Feedback arrives with the review.
 */
export async function submitAnswer(
  attemptId: string,
  questionVersionId: string,
  choiceKey: string,
  seconds: number,
): Promise<AnswerResult> {
  if (!isSupabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!uuid.safeParse(attemptId).success || !uuid.safeParse(questionVersionId).success) {
    return { ok: false, message: "Réponse invalide." };
  }
  if (typeof choiceKey !== "string" || choiceKey.length === 0 || choiceKey.length > 120) {
    return { ok: false, message: "Réponse invalide." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_attempt_response", {
    target_attempt_id: attemptId,
    target_version_id: questionVersionId,
    learner_answer: choiceKey,
    seconds_spent: Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null,
  });

  if (error) {
    console.error("answer submit failed", error.message);
    return { ok: false, message: "La réponse n’a pas pu être enregistrée." };
  }
  return { ok: true };
}

/** Closes the attempt and returns the graded review, explanations included. */
export async function finishAttempt(attemptId: string): Promise<FinishResult> {
  if (!isSupabaseConfigured()) return { ok: false, message: NOT_CONFIGURED };
  if (!uuid.safeParse(attemptId).success) return { ok: false, message: "Tentative introuvable." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: SESSION_EXPIRED };

  // Scores come from the rows the database wrote, never from a client tally.
  const { data: responses, error: responseError } = await supabase
    .from("attempt_responses")
    .select("score")
    .eq("attempt_id", attemptId);

  if (responseError) {
    console.error("attempt tally failed", responseError.message);
    return { ok: false, message: "La tentative n’a pas pu être clôturée." };
  }

  const total = responses?.length ?? 0;
  const correct = (responses ?? []).filter((row) => Number(row.score) > 0).length;
  const score = total > 0 ? correct / total : 0;

  const { error: closeError } = await supabase
    .from("attempts")
    .update({ submitted_at: new Date().toISOString(), score })
    .eq("id", attemptId)
    .eq("user_id", user.id);

  if (closeError) {
    console.error("attempt close failed", closeError.message);
    return { ok: false, message: "La tentative n’a pas pu être clôturée." };
  }

  const { data: review, error: reviewError } = await supabase.rpc("attempt_review", {
    target_attempt_id: attemptId,
  });

  if (reviewError) {
    console.error("attempt review failed", reviewError.message);
    return { ok: false, message: "La correction n’a pas pu être chargée." };
  }

  return { ok: true, score, total, correct, items: (review ?? []) as unknown as ReviewItem[] };
}

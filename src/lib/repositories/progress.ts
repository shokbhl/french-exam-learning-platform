import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Learner progress as stored in the database.
 *
 * Every field is a real count. There is no seeded or placeholder variant of
 * this type: a learner who has done nothing has zeroes, and a failed read
 * produces an error state rather than plausible-looking numbers.
 */
export type ProgressSnapshot = {
  xp: number;
  currentStreak: number;
  longestStreak: number;
  completedLessonIds: string[];
  /** Display name from the profile, or null when the learner has not set one. */
  displayName: string | null;
  /** Null until onboarding is completed. */
  goals: LearnerGoals | null;
  /**
   * Calendar dates (YYYY-MM-DD) in the last seven days on which the learner
   * earned XP. Derived from the append-only ledger, so it reflects real
   * activity and cannot be inflated by the client.
   */
  activeDates: string[];
};

export type LearnerGoals = {
  examGoal: string;
  currentCefr: string;
  targetCefr: string;
  targetNclc: number | null;
  minutesPerDay: number;
  studyDays: string[];
};

/**
 * The four situations the dashboard has to tell apart.
 *
 * `unconfigured` and `error` exist so the interface can say which one it is.
 * Rendering demonstration figures as though they were the learner's own record
 * is the specific failure this type is shaped to prevent.
 */
export type ProgressState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "ready"; snapshot: ProgressSnapshot }
  | { status: "error"; message: string };

export const emptySnapshot: ProgressSnapshot = {
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  completedLessonIds: [],
  displayName: null,
  goals: null,
  activeDates: [],
};

const READ_FAILED = "Vos statistiques n’ont pas pu être chargées.";

/**
 * Reads the signed-in learner's progress.
 *
 * Row level security restricts every query to the caller, so no user filter is
 * applied here; the database is the boundary rather than this function.
 */
export async function loadProgress(): Promise<ProgressState> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "signed-out" };

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [progress, completions, profile, goals, activity] = await Promise.all([
      supabase
        .from("learner_progress")
        .select("xp, current_streak, longest_streak")
        .maybeSingle(),
      supabase.from("lesson_completions").select("lesson_id"),
      supabase.from("profiles").select("display_name").maybeSingle(),
      supabase
        .from("student_goals")
        .select(
          "exam_goal, current_cefr, target_cefr, target_nclc, minutes_per_day, study_days",
        )
        .maybeSingle(),
      supabase.from("xp_events").select("created_at").gte("created_at", weekAgo),
    ]);

    const failure = [progress, completions, profile, goals, activity].find((r) => r.error);
    if (failure?.error) {
      // The database message is logged for an operator, never forwarded to the
      // browser, so a schema detail cannot leak through an error string.
      console.error("progress read failed", failure.error.message);
      return { status: "error", message: READ_FAILED };
    }

    const activeDates = Array.from(
      new Set((activity.data ?? []).map((row) => row.created_at.slice(0, 10))),
    ).sort();

    return {
      status: "ready",
      snapshot: {
        // A learner with no activity has no learner_progress row yet, which is
        // a genuine zero rather than a missing value.
        xp: progress.data?.xp ?? 0,
        currentStreak: progress.data?.current_streak ?? 0,
        longestStreak: progress.data?.longest_streak ?? 0,
        completedLessonIds: (completions.data ?? []).map((row) => row.lesson_id),
        displayName: profile.data?.display_name ?? null,
        goals: goals.data
          ? {
              examGoal: goals.data.exam_goal,
              currentCefr: goals.data.current_cefr,
              targetCefr: goals.data.target_cefr,
              targetNclc: goals.data.target_nclc,
              minutesPerDay: goals.data.minutes_per_day,
              studyDays: goals.data.study_days ?? [],
            }
          : null,
        activeDates,
      },
    };
  } catch (error) {
    console.error("progress read threw", error);
    return { status: "error", message: READ_FAILED };
  }
}

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * A practice set as the runner needs it.
 *
 * Nothing here can reveal the key. `correct_answer` on question_versions and
 * `is_correct` on question_choices are revoked from `authenticated` by the
 * answer-key migration, so they are not merely omitted from the select below:
 * asking for them would make the request fail. Grading happens in the database
 * through submit_attempt_response, and the explanations arrive only once the
 * attempt is submitted, through attempt_review.
 */
export type PracticeChoice = {
  stableKey: string;
  label: string;
  position: number;
};

export type PracticeQuestion = {
  questionVersionId: string;
  kind: string;
  prompt: string;
  difficulty: number | null;
  skill: string;
  /** Free-form per question kind: passage, transcript, context, audio hints. */
  content: Record<string, unknown>;
  choices: PracticeChoice[];
};

export type PracticeSet = {
  id: string;
  title: string;
  mode: string;
  questions: PracticeQuestion[];
};

export type PracticeState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "empty" }
  | { status: "ready"; sets: PracticeSet[] }
  | { status: "error"; message: string };

const READ_FAILED = "Les exercices n’ont pas pu être chargés.";

/**
 * Which page an exercise belongs to.
 *
 * The split follows the exam itself: comprehension is practised by answering,
 * production by writing or speaking. A set is offered on a page when at least
 * one of its questions belongs to that page's skills, and only those questions
 * are shown, so a mixed set is divided rather than duplicated.
 */
export const COMPREHENSION_SKILLS = ["LISTENING", "READING"] as const;
export const PRODUCTION_SKILLS = ["WRITING", "SPEAKING"] as const;

type SetRow = {
  id: string;
  title: string;
  mode: string;
  practice_set_questions:
    | {
        position: number;
        question_versions: {
          id: string;
          kind: string;
          prompt: string;
          difficulty: number | null;
          content: Record<string, unknown> | null;
          questions: { skill: string } | null;
          question_choices: { stable_key: string; label: string; position: number }[] | null;
        } | null;
      }[]
    | null;
};

/**
 * Lists the published practice sets available to the caller.
 *
 * As in the library repository, no status filter is written here: row level
 * security already limits the rows to published sets for a member and to
 * everything for staff, and duplicating that rule would mean two places to
 * keep in step.
 */
export async function loadPracticeSets(
  skills: readonly string[] = [...COMPREHENSION_SKILLS, ...PRODUCTION_SKILLS, "GRAMMAR", "VOCABULARY"],
): Promise<PracticeState> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "signed-out" };

    const { data, error } = await supabase
      .from("practice_sets")
      .select(
        "id, title, mode, practice_set_questions(position, question_versions(id, kind, prompt, difficulty, content, questions(skill), question_choices(stable_key, label, position)))",
      )
      .order("title");

    if (error) {
      console.error("practice read failed", error.message);
      return { status: "error", message: READ_FAILED };
    }

    const sets: PracticeSet[] = ((data ?? []) as unknown as SetRow[])
      .map((row) => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        questions: (row.practice_set_questions ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .flatMap((entry) => {
            const version = entry.question_versions;
            // A question whose parent row is still a draft is filtered out by
            // policy, leaving the join empty rather than erroring.
            if (!version) return [];
            const skill = version.questions?.skill ?? "READING";
            if (!skills.includes(skill)) return [];
            return [
              {
                questionVersionId: version.id,
                kind: version.kind,
                prompt: version.prompt,
                difficulty: version.difficulty,
                skill,
                content: (version.content ?? {}) as Record<string, unknown>,
                choices: (version.question_choices ?? [])
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((choice) => ({
                    stableKey: choice.stable_key,
                    label: choice.label,
                    position: choice.position,
                  })),
              },
            ];
          }),
      }))
      // A set whose questions are all unpublished would render as an empty
      // exercise, which is worse than not offering it.
      .filter((set) => set.questions.length > 0);

    if (sets.length === 0) return { status: "empty" };
    return { status: "ready", sets };
  } catch (error) {
    console.error("practice read threw", error);
    return { status: "error", message: READ_FAILED };
  }
}

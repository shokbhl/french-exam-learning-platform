export type LearnerState = {
  streak: number;
  xp: number;
  completedLessons: string[];
  quizBest: number;
};

// A new learner has done nothing yet. These were previously seeded with a
// 12-day streak and 2840 XP, which presented invented achievement as the
// learner's own record before they had answered a single question.
export const initialProgress: LearnerState = { streak: 0, xp: 0, completedLessons: [], quizBest: 0 };
export const storageKey = "parcours-francais-progress-v1";

export function loadProgress(): LearnerState {
  if (typeof window === "undefined") return initialProgress;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return saved ? { ...initialProgress, ...saved } : initialProgress;
  } catch {
    return initialProgress;
  }
}

export function saveProgress(state: LearnerState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

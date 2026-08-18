export type LearnerState = {
  streak: number;
  xp: number;
  completedLessons: string[];
  quizBest: number;
};

export const initialProgress: LearnerState = { streak: 12, xp: 2840, completedLessons: [], quizBest: 0 };
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

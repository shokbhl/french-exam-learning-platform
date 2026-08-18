import { z } from "zod";
export const onboardingSchema = z.object({
  examGoal: z.enum(["TEF_CANADA", "TCF_CANADA", "BOTH"]),
  currentLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  targetLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  targetNclc: z.number().int().min(1).max(12),
  examDate: z.string().optional(),
  studyDays: z.array(z.string()).min(1, "Choisissez au moins un jour."),
  minutesPerDay: z.number().int().min(10).max(480),
  strongestSkill: z.enum(["LISTENING", "READING", "WRITING", "SPEAKING"]),
  weakestSkill: z.enum(["LISTENING", "READING", "WRITING", "SPEAKING"]),
  explanationLanguage: z.enum(["fr", "en", "fa"]),
}).refine((value) => value.strongestSkill !== value.weakestSkill, { message: "Les compétences forte et faible doivent être différentes.", path: ["weakestSkill"] });
export type OnboardingInput = z.infer<typeof onboardingSchema>;

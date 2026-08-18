import { describe, expect, it } from "vitest";
import { examFormats, lessons, quiz, skills } from "./content";

describe("learning content integrity", () => {
  it("covers the four assessed skills for each Canadian exam", () => {
    expect(examFormats["TEF Canada"]).toHaveLength(4);
    expect(examFormats["TCF Canada"]).toHaveLength(4);
    expect(new Set(examFormats["TEF Canada"].map((item) => item.skill)).size).toBe(4);
  });
  it("keeps every quiz answer key in bounds", () => {
    for (const item of quiz) expect(item.correct).toBeLessThan(item.answers.length);
  });
  it("provides valid learner progress values", () => {
    expect(lessons.every((lesson) => lesson.progress >= 0 && lesson.progress <= 100)).toBe(true);
    expect(skills.every((skill) => skill.score >= 0 && skill.score <= 100)).toBe(true);
  });
});

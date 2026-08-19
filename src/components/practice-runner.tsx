"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, Check, FileText, Headphones, RotateCcw, Trophy, X } from "lucide-react";
import {
  finishAttempt,
  startAttempt,
  submitAnswer,
  type ReviewItem,
} from "@/app/practice/actions";
import type { PracticeQuestion, PracticeSet } from "@/lib/repositories/practice";

/**
 * The database-backed practice runner.
 *
 * The order of events follows the answer-key design rather than the demo lab:
 * a learner answers every question first and sees the correction afterwards,
 * because the explanations do not exist client-side until `attempt_review`
 * releases them. There is no "check this one answer" step to build.
 */

type Phase =
  | { name: "choosing" }
  | { name: "answering"; set: PracticeSet; attemptId: string; index: number }
  | { name: "reviewing"; set: PracticeSet; score: number; correct: number; total: number; items: ReviewItem[] };

function passageOf(question: PracticeQuestion) {
  const value = question.content?.["passage"] ?? question.content?.["context"];
  return typeof value === "string" ? value : null;
}

function transcriptOf(question: PracticeQuestion) {
  const value = question.content?.["transcript"];
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === "string");
  return typeof value === "string" ? [value] : [];
}

export function PracticeRunner({ sets }: { sets: PracticeSet[] }) {
  const [phase, setPhase] = useState<Phase>({ name: "choosing" });
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Set when a question is shown, in an event handler rather than during
  // render: the clock is impure and must not be read while rendering.
  const questionStartedAt = useRef(0);

  const begin = (set: PracticeSet) => {
    setError("");
    startTransition(async () => {
      const result = await startAttempt(set.id);
      if (!result.ok) return setError(result.message);
      questionStartedAt.current = Date.now();
      setSelected(null);
      setPhase({ name: "answering", set, attemptId: result.attemptId, index: 0 });
    });
  };

  const answer = () => {
    if (phase.name !== "answering" || !selected) return;
    const question = phase.set.questions[phase.index];
    const seconds = questionStartedAt.current > 0 ? (Date.now() - questionStartedAt.current) / 1000 : 0;
    setError("");

    startTransition(async () => {
      const recorded = await submitAnswer(phase.attemptId, question.questionVersionId, selected, seconds);
      if (!recorded.ok) return setError(recorded.message);

      const next = phase.index + 1;
      if (next < phase.set.questions.length) {
        questionStartedAt.current = Date.now();
        setSelected(null);
        setPhase({ ...phase, index: next });
        return;
      }

      const finished = await finishAttempt(phase.attemptId);
      if (!finished.ok) return setError(finished.message);
      setPhase({
        name: "reviewing",
        set: phase.set,
        score: finished.score,
        correct: finished.correct,
        total: finished.total,
        items: finished.items,
      });
    });
  };

  if (phase.name === "choosing") {
    return (
      <Shell>
        <div className="set-picker">
          <p className="eyebrow">EXERCICES PUBLIÉS</p>
          <h1>Choisissez un exercice</h1>
          {error && <p className="form-error">{error}</p>}
          {sets.map((set) => (
            <button key={set.id} className="set-card" onClick={() => begin(set)} disabled={pending}>
              <span>{set.mode === "listening" ? <Headphones size={18} /> : <BookOpen size={18} />}</span>
              <div>
                <strong>{set.title}</strong>
                <small>
                  {set.questions.length} question{set.questions.length > 1 ? "s" : ""}
                </small>
              </div>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  if (phase.name === "answering") {
    const question = phase.set.questions[phase.index];
    const passage = passageOf(question);
    const transcript = transcriptOf(question);

    return (
      <Shell title={phase.set.title}>
        <div className="quiz-progress">
          <span style={{ width: `${((phase.index + 1) / phase.set.questions.length) * 100}%` }} />
        </div>
        <section className="activity">
          <div className="activity-top">
            <p className="eyebrow">{question.skill}</p>
          </div>
          {transcript.length > 0 && (
            <div className="transcript">
              {transcript.map((line, i) => (
                <p key={line}>
                  <span>{i + 1}</span>
                  {line}
                </p>
              ))}
            </div>
          )}
          {passage && (
            <article className="reading-passage">
              <p>{passage}</p>
            </article>
          )}
          <div className="question">
            <small>
              QUESTION {phase.index + 1} SUR {phase.set.questions.length}
            </small>
            <h2>{question.prompt}</h2>
            <div className="answers">
              {question.choices.map((choice, i) => (
                <button
                  key={choice.stableKey}
                  className={selected === choice.stableKey ? "selected" : ""}
                  onClick={() => setSelected(choice.stableKey)}
                  disabled={pending}
                >
                  <span>{String.fromCharCode(65 + i)}</span>
                  {choice.label}
                </button>
              ))}
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="question-actions">
              <button className="primary" disabled={!selected || pending} onClick={answer}>
                {phase.index + 1 === phase.set.questions.length ? "Terminer" : "Valider"}
              </button>
            </div>
          </div>
        </section>
        <p className="exam-notice">
          La correction s’affiche à la fin : les explications restent côté serveur pendant l’exercice.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title={phase.set.title}>
      <section className="activity">
        <div className="result">
          <span>
            <Trophy />
          </span>
          <h2>{Math.round(phase.score * 100)}%</h2>
          <small>
            {phase.correct} bonne{phase.correct > 1 ? "s" : ""} réponse{phase.correct > 1 ? "s" : ""} sur{" "}
            {phase.total}
          </small>
        </div>
        {phase.items.map((item) => {
          const good = Number(item.score) > 0;
          return (
            <div key={item.question_version_id} className={good ? "feedback good" : "feedback bad"}>
              <strong>{item.prompt}</strong>
              <ul className="review-options">
                {item.options.map((option) => (
                  <li key={option.stable_key} className={option.is_correct ? "opt-correct" : ""}>
                    {option.is_correct ? <Check size={13} /> : <X size={13} />}
                    <span>{option.label}</span>
                    {option.explanation && <em>{option.explanation}</em>}
                  </li>
                ))}
              </ul>
              {item.explanation && <p>{item.explanation}</p>}
              {item.evidence.map((source) => (
                <small key={`${source.source_file_id}-${source.page_number}`} className="evidence">
                  <FileText size={12} />
                  Source · version {source.source_version ?? "?"} · page {source.page_number ?? "?"} :{" "}
                  {source.evidence_text}
                </small>
              ))}
            </div>
          );
        })}
        <div className="question-actions">
          <button className="outline" onClick={() => setPhase({ name: "choosing" })}>
            <RotateCcw size={15} />
            Autre exercice
          </button>
        </div>
      </section>
    </Shell>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="lab-page">
      <header className="lab-header">
        <Link href="/">
          <ArrowLeft size={15} />
          Tableau de bord
        </Link>
        <span>{title ?? "Entraînement"}</span>
      </header>
      <div className="runner-layout">{children}</div>
    </main>
  );
}

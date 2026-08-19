/**
 * The Anthropic provider behind the platform's AI seam.
 *
 * Two jobs, both grounded in material the editorial team uploaded:
 *
 *   * reading a scanned document that has no text layer, and
 *   * drafting exercise questions from extracted text.
 *
 * Everything it returns is a draft. `AIResult.status` is the literal `"draft"`
 * for that reason, and the drafting call is required to cite the chunk, page
 * and quoted sentence behind every question — a question whose evidence cannot
 * be checked is not usable in an exam-preparation product, where a confidently
 * wrong answer key is the worst possible output.
 */

import Anthropic from "@anthropic-ai/sdk";
// Extensions are explicit so the operational scripts can import this module
// directly under Node's ESM resolver, which does not guess them.
import type { AIProvider, AIRequest, AIResult } from "./types.ts";
import { ProviderNotConfiguredError } from "./types.ts";

const MODEL = "claude-opus-5";

/**
 * Streaming is used for every call: drafting a full exercise runs long, and a
 * non-streaming request with a large `max_tokens` risks an HTTP timeout.
 */
const MAX_TOKENS = 64000;

export type SourceChunk = {
  chunkId: string;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
  text: string;
};

export type DraftedChoice = {
  key: string;
  label: string;
  correct?: boolean;
  explanation?: string;
};

export type DraftedQuestion = {
  stableKey: string;
  skill: string;
  kind: string;
  difficulty: number;
  prompt: string;
  content: Record<string, unknown>;
  explanation: string;
  choices: DraftedChoice[];
  evidence: { page: number; text: string }[];
};

const DRAFTING_SYSTEM = `You write practice questions for adults preparing for the TEF Canada and TCF Canada French examinations.

Rules that matter more than fluency:

* Write original questions. Never reproduce a source's own exercises, question wording, or answer options — the sources are licensed material and copying them is both a rights problem and a bad exercise. Draw on the source for facts, vocabulary, register and situation, then write something new.
* Every question must be answerable from the supplied passages alone. If the passages do not support a question for a requested skill, return fewer questions rather than inventing content.
* Each question cites the page it came from and quotes the sentence that justifies the answer.
* Exactly one option is correct. Distractors must be plausible to a learner who half-understood the passage, never absurd or grammatically impossible.
* Every incorrect option carries a short explanation of the specific misreading it represents.
* All learner-facing text is in French. CEFR level and difficulty should match the source's register.

Skill conventions:
* LISTENING — supply a short scripted dialogue or monologue in content.transcript (array of lines); the question tests intent, tone or implied information.
* READING — supply the excerpt or a faithful paraphrase in content.passage.
* WRITING — supply the situation in content.context; the question tests register, structure or formulation.
* SPEAKING — supply the situation in content.context; the question tests strategy or formulation for the oral exam.`;

const QUESTION_TOOL: Anthropic.Tool = {
  name: "submit_questions",
  description: "Submit the drafted practice questions.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stableKey: {
              type: "string",
              description: "Lowercase slug identifying this question, e.g. 'avis-mairie-horaires-1'.",
            },
            skill: {
              type: "string",
              enum: ["LISTENING", "READING", "WRITING", "SPEAKING", "GRAMMAR", "VOCABULARY"],
            },
            kind: { type: "string", description: "Always 'mcq' for now." },
            difficulty: { type: "integer", minimum: 1, maximum: 5 },
            prompt: { type: "string", description: "The question, in French." },
            content: {
              type: "object",
              description: "passage (READING), transcript (LISTENING, array of lines), or context (WRITING/SPEAKING).",
              properties: {
                passage: { type: "string" },
                context: { type: "string" },
                transcript: { type: "array", items: { type: "string" } },
              },
            },
            explanation: { type: "string", description: "Why the correct answer is correct, in French." },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Short stable key: a, b, c, d." },
                  label: { type: "string" },
                  correct: { type: "boolean" },
                  explanation: { type: "string", description: "For incorrect options: the misreading it represents." },
                },
                required: ["key", "label"],
              },
              minItems: 3,
              maxItems: 5,
            },
            evidence: {
              type: "array",
              description: "The passage location supporting the correct answer.",
              items: {
                type: "object",
                properties: {
                  page: { type: "integer" },
                  text: { type: "string", description: "The sentence quoted from the source." },
                },
                required: ["page", "text"],
              },
              minItems: 1,
            },
          },
          required: ["stableKey", "skill", "kind", "difficulty", "prompt", "content", "explanation", "choices", "evidence"],
        },
      },
    },
    required: ["questions"],
  },
};

const PAGES_TOOL: Anthropic.Tool = {
  name: "submit_pages",
  description: "Submit the text read from each page of the document.",
  input_schema: {
    type: "object",
    properties: {
      pages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1 },
            text: { type: "string" },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "How legible the page was: 1 clean, below 0.5 barely readable.",
            },
          },
          required: ["page", "text", "confidence"],
        },
      },
    },
    required: ["pages"],
  },
};

export function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client() {
  if (!hasAnthropicKey()) throw new ProviderNotConfiguredError("La rédaction assistée");
  return new Anthropic();
}

/**
 * Runs one tool-constrained request and returns the tool input.
 *
 * Server-side refusal fallbacks are requested by default so a declined request
 * is retried on another model inside the same call instead of failing. The beta
 * is not available on every account or platform, so a rejection of the beta
 * itself falls back to the standard endpoint rather than taking the feature
 * down with it.
 */
async function callTool(
  messages: Anthropic.MessageParam[],
  tool: Anthropic.Tool,
  system: string,
): Promise<Record<string, unknown>> {
  const anthropic = client();
  const request = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools: [tool],
    tool_choice: { type: "tool" as const, name: tool.name },
    thinking: { type: "adaptive" as const },
    output_config: { effort: "high" as const },
  };

  let message: Anthropic.Message;
  try {
    const stream = anthropic.beta.messages.stream({
      ...request,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Parameters<typeof anthropic.beta.messages.stream>[0]);
    message = (await stream.finalMessage()) as unknown as Anthropic.Message;
  } catch (error) {
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    // The account or platform does not offer the fallback beta; the request
    // itself is fine without it.
    const stream = anthropic.messages.stream(request);
    message = await stream.finalMessage();
  }

  if (message.stop_reason === "refusal") {
    throw new Error("Le modèle a refusé cette demande. Vérifiez le contenu de la source.");
  }

  const call = message.content.find((block) => block.type === "tool_use");
  if (!call || call.type !== "tool_use") {
    throw new Error("Le modèle n’a pas renvoyé de résultat structuré.");
  }
  // Tool inputs are already parsed objects, but escaping varies by model, so
  // never string-match on them.
  return call.input as Record<string, unknown>;
}

/** Reads a scanned PDF or an image, page by page. */
export async function readDocumentWithModel(
  bytes: Uint8Array,
  mediaType: string,
): Promise<{ page: number; text: string; confidence: number }[]> {
  const data = Buffer.from(bytes).toString("base64");
  const source: Anthropic.ContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data,
          },
        };

  const result = await callTool(
    [
      {
        role: "user",
        content: [
          source,
          {
            type: "text",
            text: "Transcribe this document page by page. Preserve the original French text exactly, including accents. Do not summarise, translate or correct it. Report a confidence for each page reflecting how legible it was.",
          },
        ],
      },
    ],
    PAGES_TOOL,
    "You transcribe scanned documents faithfully. You never invent text that is not visible on the page; an illegible passage is reported as such with a low confidence.",
  );

  const pages = Array.isArray(result.pages) ? result.pages : [];
  return pages as { page: number; text: string; confidence: number }[];
}

/** Drafts questions for the requested skills from the supplied chunks. */
export async function draftQuestionsFromChunks(options: {
  materialTitle: string;
  chunks: SourceChunk[];
  skills: string[];
  perSkill: number;
  cefrLevel?: string | null;
}): Promise<DraftedQuestion[]> {
  const { materialTitle, chunks, skills, perSkill, cefrLevel } = options;

  const passages = chunks
    .map(
      (chunk) =>
        `--- chunk ${chunk.chunkId} · pages ${chunk.pageFrom}-${chunk.pageTo}${chunk.heading ? ` · ${chunk.heading}` : ""}\n${chunk.text}`,
    )
    .join("\n\n");

  const result = await callTool(
    [
      {
        role: "user",
        content: `Source material: "${materialTitle}"${cefrLevel ? ` (estimated level ${cefrLevel})` : ""}.

Draft ${perSkill} question(s) for each of these skills: ${skills.join(", ")}.

Give every question a stableKey beginning with a short slug of the material title, so keys stay unique across imports. Cite the page each question is drawn from, using the page range shown on the chunk it came from.

Passages:

${passages}`,
      },
    ],
    QUESTION_TOOL,
    DRAFTING_SYSTEM,
  );

  const questions = Array.isArray(result.questions) ? result.questions : [];
  return questions as DraftedQuestion[];
}

/**
 * The provider the rest of the application resolves through `getAIProvider()`.
 *
 * Only the drafting task is implemented here; the feedback tasks still have no
 * provider, and saying so is better than returning something plausible.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  isConfigured() {
    return hasAnthropicKey();
  }

  async generate(request: AIRequest): Promise<AIResult> {
    if (!this.isConfigured()) throw new ProviderNotConfiguredError("L’assistance IA");
    if (request.task !== "draft_questions") {
      throw new ProviderNotConfiguredError(`La tâche « ${request.task} »`);
    }

    const questions = await draftQuestionsFromChunks({
      materialTitle: request.input,
      chunks: [],
      skills: ["READING"],
      perSkill: 1,
    });

    return {
      status: "draft",
      content: questions,
      citations: request.sources ?? [],
      provider: this.name,
      model: MODEL,
      promptVersion: request.promptVersion,
    };
  }
}

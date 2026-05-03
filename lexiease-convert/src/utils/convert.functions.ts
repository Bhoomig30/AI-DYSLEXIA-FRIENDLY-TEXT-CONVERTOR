import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  text: z.string().min(1).max(10000),
  level: z.enum(["simple", "standard", "detailed"]),
});

const BASE_RULES = `You are a dyslexia-friendly text specialist following the British Dyslexia Association (BDA) Style Guide 2023. Your job is to rewrite text so it is easier for people with dyslexia to read and understand.

ABSOLUTE RULES — never break these:
· Do not summarise. Preserve ALL original information and facts.
· Do not add any information that was not in the original text.
· Do not use italic text anywhere in your output.
· Do not use fully justified alignment instructions.
· Do not use double negatives.
· Do not use idioms, metaphors, or figurative language.
· Do not use abbreviations without spelling them out first.
· Use active voice. Rewrite all passive voice sentences.
· Use bullet points for any list of 3 or more items.
· Add one blank line between every paragraph.
· Return ONLY the rewritten text. No preamble. No commentary. No 'Here is the rewritten version:'. Just the text itself.`;

const LEVEL_ADDITIONS = {
  simple: `

LEVEL: SIMPLE
· Maximum 8 words per sentence. No exceptions.
· Use only the 1000 most common English words (Oxford 3000 level).
· One sentence per paragraph. Every paragraph is one single sentence.
· If a concept needs explaining, use an example in brackets after it.
· No compound sentences. Split every 'and', 'but', 'so' into two sentences.
· Use 'you' and 'we' to make it personal and direct.`,
  standard: `

LEVEL: STANDARD
· Maximum 15 words per sentence.
· Maximum 3 sentences per paragraph.
· Replace complex words with simpler everyday alternatives.
  Examples: 'utilise' → 'use', 'commence' → 'start', 'sufficient' → 'enough', 'purchase' → 'buy'.
· Split compound sentences. Each sentence = one idea only.
· Use 'you' and 'we' where appropriate.`,
  detailed: `

LEVEL: DETAILED
· Maximum 20 words per sentence.
· Maximum 4 sentences per paragraph.
· You may keep technical or domain-specific terminology.
· When keeping a complex term, explain it in brackets on first use.
  Example: 'The myelin sheath (the protective layer around nerve fibres)'.
· Preserve the original document's structure and heading hierarchy.
· Rewrite for clarity, not simplicity.`,
};

function buildSystemPrompt(level: "simple" | "standard" | "detailed") {
  return BASE_RULES + LEVEL_ADDITIONS[level];
}

export const convertText = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return { ok: false as const, error: "AI service is not configured." };
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: buildSystemPrompt(data.level) },
            { role: "user", content: data.text },
          ],
        }),
      });

      if (res.status === 429) {
        return { ok: false as const, error: "Too many requests. Please wait a moment and try again." };
      }
      if (res.status === 402) {
        return { ok: false as const, error: "AI credits exhausted. Please add credits in Workspace → Usage." };
      }
      if (!res.ok) {
        const body = await res.text();
        console.error("AI gateway error:", res.status, body);
        return { ok: false as const, error: `AI service is temporarily unavailable (${res.status}).` };
      }

      const json = await res.json();
      const output: string = json.choices?.[0]?.message?.content ?? "";
      if (!output.trim()) {
        return { ok: false as const, error: "AI returned an empty response. Please try again." };
      }
      return { ok: true as const, output };
    } catch (e) {
      console.error("convertText failed:", e);
      return { ok: false as const, error: "Could not reach the AI service. Please retry." };
    }
  });

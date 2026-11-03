// Builds prompts from a workspace's brief, knowledge, prior work and KPIs,
// and streams generations from Claude (or a demo provider without a key).
import Anthropic from "@anthropic-ai/sdk";
import { BRIEF_FIELDS } from "./catalog.js";

export const SYSTEM = [
  "You are Marketing Wizard, a senior marketing strategist and conversion copywriter for SaaS companies and agencies.",
  "Ground everything in the brand brief, the company knowledge and the earlier strategy work you are given, and stay consistent with them.",
  "Be specific and concrete: the customer's own language, numbers and vivid outcomes, not abstract adjectives like 'powerful', 'seamless' or 'game-changing'.",
  "Never invent customers, statistics, testimonials or awards. Where proof is missing write a placeholder such as [ADD CUSTOMER METRIC]. Mark any competitor fact you are unsure of with (verify).",
  "Match the brand voice and each channel's norms.",
].join(" ");

export function fillTask(pb, inputs) {
  let task = pb.task;
  for (const i of pb.inputs) {
    const v = String(inputs?.[i.name] ?? "").trim() || i.default;
    task = task.replaceAll(`{${i.name}}`, v.slice(0, 500));
  }
  return task;
}

export function kpiTable(store, wsId, lastN = 8) {
  const kpis = store.listKpis(wsId);
  if (!kpis.length) return "No KPIs defined yet.";
  const byKpi = {};
  for (const v of store.listKpiValues(wsId)) (byKpi[v.kpi_id] ||= []).push(v);
  const lines = ["stage | kpi | unit | target | better | owner | values (period=value, oldest first)"];
  for (const k of kpis) {
    const series = (byKpi[k.id] || []).slice(-lastN).map((v) => `${v.period}=${v.value}${v.note ? ` (${v.note})` : ""}`).join(", ") || "no data";
    lines.push(`${k.stage} | ${k.name} | ${k.unit} | ${k.target ?? ""} | ${k.higher_is_better ? "higher" : "lower"} | ${k.owner} | ${series}`);
  }
  return lines.join("\n");
}

export function buildPrompt(store, ws, pb, inputs) {
  const parts = [];
  const brief = BRIEF_FIELDS.filter(([key]) => ws.brief[key]).map(([key, label]) => `- ${label}: ${ws.brief[key]}`);
  parts.push(`<brand_brief>\n${brief.join("\n")}\n</brand_brief>`);
  const notes = store.listNotes(ws.id);
  if (notes.length) {
    parts.push(`<company_knowledge>\n${notes.map((n) => `[${n.category}] ${n.title}\n${n.content}`).join("\n\n")}\n</company_knowledge>`);
  }
  for (const dep of pb.uses_context_from) {
    const prior = store.latestAsset(ws.id, dep);
    if (prior) parts.push(`<prior_work playbook="${dep}" title="${prior.title}">\n${prior.text}\n</prior_work>`);
  }
  if (pb.uses_kpis) parts.push(`<kpi_data>\n${kpiTable(store, ws.id)}\n</kpi_data>`);
  parts.push(`<task title="${pb.title}">\n${fillTask(pb, inputs)}\n</task>`);
  parts.push("Write the answer in Markdown with clear ## headings, bullet lists and tables where useful. Start directly with the content, no preamble.");
  return parts.join("\n\n");
}

export class LLMError extends Error {}

// Claude provider: streams text deltas to onText, returns the full text.
export function claudeProvider({ model, effort }) {
  const client = new Anthropic();
  return {
    name: "claude",
    model,
    async generate({ system, prompt, onText = () => {}, signal, onUsage }) {
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: 64000,
          thinking: { type: "adaptive" },
          output_config: { effort },
          // On a safety-classifier decline, retry server-side on the recommended fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          messages: [{ role: "user", content: prompt }],
        }, { signal });
        stream.on("text", onText);
        const msg = await stream.finalMessage();
        onUsage?.(msg.usage, msg.model); // AI Workforce: tokens and cost per agent
        if (msg.stop_reason === "refusal") throw new LLMError("Claude declined this request. Try rewording the inputs.");
        if (msg.stop_reason === "max_tokens") throw new LLMError("The output was cut off at the length limit. Try a narrower request.");
        return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      } catch (e) {
        if (e instanceof LLMError || signal?.aborted) throw e;
        if (e instanceof Anthropic.AuthenticationError) throw new LLMError("The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in hPanel.");
        if (e instanceof Anthropic.RateLimitError) throw new LLMError("Rate limited by the Anthropic API. Wait a minute and try again.");
        if (e instanceof Anthropic.BadRequestError) throw new LLMError("The Anthropic API rejected the request: " + e.message);
        if (e instanceof Anthropic.APIConnectionError) throw new LLMError("Could not reach the Anthropic API. Try again in a moment.");
        throw new LLMError("Something went wrong reaching Claude. Try again in a moment.");
      }
    },
  };
}

// Demo provider: no key, no network. Shows the flow with clearly marked placeholder text.
export function demoProvider() {
  return {
    name: "demo",
    model: "demo",
    async generate({ prompt, onText }) {
      const title = /<task title="([^"]+)"/.exec(prompt)?.[1] || "Output";
      const text = `## ${title}\n\n> Demo output. Set ANTHROPIC_API_KEY on the server to generate real content.\n\n` +
        `- This playbook would use your brief, company knowledge${prompt.includes("<prior_work") ? ", earlier strategy work" : ""}${prompt.includes("<kpi_data>") ? " and logged KPIs" : ""}.\n`;
      for (const chunk of text.match(/.{1,40}/gs)) onText(chunk);
      return text;
    },
  };
}

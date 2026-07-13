import type { SuggestedEntryNode } from '@diary/shared';
import {
  AI_MAX_SUBMIT_REMINDERS,
  AI_MAX_SUGGESTION_NODES,
  AI_MAX_TOOL_ITERATIONS,
  CEREBRAS_API_BASE,
  CEREBRAS_CHAT_MODEL,
  GROQ_API_BASE,
  GROQ_CHAT_MODEL,
  MAX_CONTENT_LENGTH,
  MAX_SUB_ENTRY_DEPTH,
  OPENROUTER_API_BASE,
  OPENROUTER_CHAT_MODEL,
} from '@diary/shared';
import { Types } from 'mongoose';
import { z } from 'zod';
import { config } from '../config';
import { badRequest, HttpError } from '../errors';
import { chatCompletion, type ChatMessage } from '../lib/aiChatClient';
import { Person } from '../models/person';
import { Tag } from '../models/tag';
import { normalize, searchPeopleCsv, type SearchablePerson } from './personSearch';
import { getSettings } from './settingsService';

interface TagRef {
  id: string;
  name: string;
}

// --- Tool schema (inlined to exactly MAX_SUB_ENTRY_DEPTH levels — no $ref/$defs, unreliable on Groq) ---

function buildEntryNodeSchema(remainingDepth: number): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'First-person diary bullet, may contain @Name and #Tag tokens' },
      importance: { type: 'integer', minimum: 1, maximum: 5, description: '1 = highest, 5 = lowest' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Existing tag ids only' },
      people: { type: 'array', items: { type: 'string' }, description: 'Existing person ids only, from query_people' },
      children:
        remainingDepth > 0
          ? { type: 'array', items: buildEntryNodeSchema(remainingDepth - 1), description: 'Nested sub-details' }
          : { type: 'array', items: {}, maxItems: 0, description: 'Max nesting depth reached' },
    },
    required: ['content', 'importance', 'tags', 'people', 'children'],
  };
}

const ENTRY_NODE_JSON_SCHEMA = buildEntryNodeSchema(MAX_SUB_ENTRY_DEPTH);

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_people',
      description:
        'Search the user\'s saved people by name (fuzzy, typo-tolerant). Always call this before writing "@Name" for a person who might already be saved, so you can use their id and exact canonical name.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Name or partial name to search for' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_entries',
      description:
        'REQUIRED final step. Submit the extracted diary entries. Call this exactly once when done, with an empty list if nothing extractable was found.',
      parameters: {
        type: 'object',
        properties: { entries: { type: 'array', items: ENTRY_NODE_JSON_SCHEMA } },
        required: ['entries'],
      },
    },
  },
] as const;

// --- Lenient zod parsing of the model's submit_entries arguments ---

function nodeSchemaAtDepth(remainingDepth: number): z.ZodType<SuggestedEntryNode> {
  const childrenSchema =
    remainingDepth > 0
      ? z
          .array(z.lazy(() => nodeSchemaAtDepth(remainingDepth - 1)))
          .catch([] as SuggestedEntryNode[])
      : z
          .array(z.unknown())
          .catch([])
          .transform((): SuggestedEntryNode[] => []);
  return z.object({
    content: z.string().catch(''),
    importance: z.number().catch(3),
    tags: z.array(z.string()).catch([]),
    people: z.array(z.string()).catch([]),
    children: childrenSchema,
  });
}

const submitEntriesArgsSchema = z.object({
  entries: z.array(nodeSchemaAtDepth(MAX_SUB_ENTRY_DEPTH)).catch([]),
});

// --- Sanitization: never trust the model's ids, depth, or lengths ---

function clampImportance(value: number): number {
  const n = Math.round(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

/** Longest-match #TagName tokens inside content, same rule as web/src/lib/tokens.ts segmentContent. */
function matchInlineTagIds(content: string, tags: TagRef[]): string[] {
  const sorted = [...tags].sort((a, b) => b.name.length - a.name.length);
  const ids = new Set<string>();
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '#') continue;
    const rest = content.slice(i + 1);
    const match = sorted.find((t) => normalize(rest.slice(0, t.name.length)) === normalize(t.name));
    if (match) ids.add(match.id);
  }
  return [...ids];
}

interface SanitizeCtx {
  ownedTagIds: Set<string>;
  ownedPersonIds: Set<string>;
  tags: TagRef[];
  remainingNodes: number;
}

function sanitizeNodes(nodes: SuggestedEntryNode[], depth: number, ctx: SanitizeCtx): SuggestedEntryNode[] {
  if (depth > MAX_SUB_ENTRY_DEPTH) return [];
  const result: SuggestedEntryNode[] = [];
  for (const node of nodes) {
    if (ctx.remainingNodes <= 0) break;
    const content = node.content.trim().slice(0, MAX_CONTENT_LENGTH);
    if (!content) continue; // drop empty-content nodes, subtree included

    const paramTagIds = node.tags.filter((id) => ctx.ownedTagIds.has(id));
    const inlineTagIds = matchInlineTagIds(content, ctx.tags);
    const tags = [...new Set([...paramTagIds, ...inlineTagIds])];
    const people = [...new Set(node.people.filter((id) => ctx.ownedPersonIds.has(id)))];

    ctx.remainingNodes -= 1;
    const children =
      depth < MAX_SUB_ENTRY_DEPTH ? sanitizeNodes(node.children, depth + 1, ctx) : [];
    result.push({ content, importance: clampImportance(node.importance), tags, people, children });
  }
  return result;
}

// --- System prompt ---

function buildSystemPrompt(tags: TagRef[], dateKey: string, language: string, forceEnglishAIEvents: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  const tagLines = tags.length ? tags.map((t) => `${t.id}: ${t.name}`).join('\n') : '(no tags exist yet)';
  return `You extract diary bullet points from a voice transcript recorded by the user.

Take your time and prioritize correctness over speed. Reason carefully about the transcript before using tools or submitting the final result.

### 1. Core Extraction Rules
- The entries you submit are always filed under the date ${dateKey} (today is ${today}). Use any relative dates mentioned ("yesterday", "last week") ONLY to understand context, never to change where the entry is filed.
- ${forceEnglishAIEvents ? `Write every "content" field in English, even if the transcript is in another language (app language hint: "${language}").` : `Write every "content" field in the same language as the transcript (app language hint: "${language}").`}
- Split the transcript into concise, first-person diary bullet points.
- Group related details logically using the "children" array. Do not list every detail as a flat, top-level entry. If the transcript describes a main event (e.g., "Went to London") and subsequent details about it (e.g., "Visited the museum", "Had dinner with @John"), those details MUST be nested as children under the parent event. You may nest these sub-entries up to exactly ${MAX_SUB_ENTRY_DEPTH} levels deep to create a clean, hierarchical summary.
- Never invent facts that are not in the transcript. If the transcript is ambiguous, prefer a conservative interpretation.

### 2. Importance Scale (1 = highest ... 5 = lowest)
1. Transformative: Major milestones that permanently shift your life trajectory (e.g., Admission to a Master's program, starting a serious relationship, landing a career-defining job, moving abroad, launching a new business, or completing a multi-year project).
2. Significant: Highly memorable achievements or major experiences that define a given year (e.g., Graduation, taking a long international trip, or hitting a massive project goal).
3. Notable: Meaningful moments and solid milestones that make a week special (e.g., A short weekend getaway, great progress on a project you care about, or solid feature additions like bundling an app).
4. Minor: Small deviations from the norm or practical skill-building (e.g., Learning to drive, going out to a nice dinner, attending a local event, or nice project improvements).
5. Routinary: Standard, everyday happenings, necessary daily tasks, and basic maintenance (e.g., Going grocery shopping, doing household chores, standard bug fixes, or updating dependencies).

### 3. Tagging Convention
Existing tags (id: name) — you may ONLY reference these ids/names, never invent a new one:
${tagLines}

A tag can be linked in TWO ways (both are combined into one set, so use whichever fits best):
- In the "tags" array: Put its ID here when the name doesn't fit naturally into the sentence (e.g., { content: "Did A with @B", tags: ["<id of tagC>"] }).
- Inline text: Write "#TagName" in the content using the EXACT name from the list above when it reads naturally (e.g., { content: "#Trip with @A to B", tags: [] }).

### 4. People & Name Verification
Be aggressive about tool calls. If the transcript contains anything that could be a person's name (capitalized tokens, unusual proper-name words), treat it as a candidate. 
- Step 1: Call \`query_people\` with the name. Do not rely on your internal memory; use the tool to verify. 
- Step 2: Account for transcription errors. Audio transcripts often mangle names (e.g., transcribing "Ibón" as "Yvonne" or "Ivonne"). If a name looks plausible but isn't an exact match, try querying similar-sounding variants.
- Step 3: If a confident match is found, put their ID in the entry's "people" array AND write "@ExactName" in the content using the EXACT name the tool returned.
- Step 4: If no confident match is found after checking variants, write their name as plain text without the "@".

You MUST finish by calling \`submit_entries\` exactly once, even if the list is empty.`;
}

// --- Main loop ---

interface LeanPersonForSearch {
  _id: Types.ObjectId;
  name: string;
  aliases?: string[];
  tags?: { name: string }[];
  notes?: string;
}

interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

/** Cerebras and OpenRouter are used for text/tool-calling; Groq is always required for
    client-side transcription but also works as the text fallback so the assistant still
    functions with just a Groq key. */
function pickProvider(settings: {
  groqApiKey: string;
  openRouterApiKey: string;
  cerebrasApiKey: string;
}): Provider {
  const cerebrasKey = settings.cerebrasApiKey.trim();
  if (cerebrasKey) {
    return {
      baseUrl: CEREBRAS_API_BASE,
      apiKey: cerebrasKey,
      model: CEREBRAS_CHAT_MODEL,
    };
  }
  const openRouterKey = settings.openRouterApiKey.trim();
  if (openRouterKey) {
    return {
      baseUrl: OPENROUTER_API_BASE,
      apiKey: openRouterKey,
      model: OPENROUTER_CHAT_MODEL,
      // Optional but recommended by OpenRouter for inclusion in their public rankings.
      headers: { 'HTTP-Referer': config.betterAuthUrl, 'X-Title': 'Diary' },
    };
  }
  const groqKey = settings.groqApiKey.trim();
  if (groqKey) return { baseUrl: GROQ_API_BASE, apiKey: groqKey, model: GROQ_CHAT_MODEL };
  throw badRequest('ai.no_key');
}

export async function generateSuggestions(
  userId: string,
  transcript: string,
  dateKey: string,
  language: string,
): Promise<SuggestedEntryNode[]> {
  const settings = await getSettings(userId);
  const provider = pickProvider(settings);
  const aiLanguage = settings.forceEnglishAIEvents ? 'en' : language;

  const [tagDocs, personDocs] = await Promise.all([
    Tag.find({ userId }, 'name').lean(),
    Person.find({ userId }, 'name aliases notes').populate({ path: 'tags', select: 'name' }).lean(),
  ]);

  const tags: TagRef[] = (tagDocs as unknown as { _id: Types.ObjectId; name: string }[]).map((t) => ({
    id: t._id.toString(),
    name: t.name,
  }));
  const ownedTagIds = new Set(tags.map((t) => t.id));

  const searchablePeople: SearchablePerson[] = (personDocs as unknown as LeanPersonForSearch[]).map((p) => ({
    id: p._id.toString(),
    name: p.name,
    aliases: p.aliases ?? [],
    tagNames: (p.tags ?? []).map((t) => t.name),
    notes: p.notes ?? '',
  }));
  const ownedPersonIds = new Set(searchablePeople.map((p) => p.id));

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(tags, dateKey, aiLanguage, settings.forceEnglishAIEvents) },
    { role: 'user', content: transcript },
  ];

  let reminders = 0;
  for (let i = 0; i < AI_MAX_TOOL_ITERATIONS; i++) {
    const res = await chatCompletion(
      provider.baseUrl,
      provider.apiKey,
      {
        model: provider.model,
        messages,
        tools: TOOLS as unknown as unknown[],
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 4096,
      },
      provider.headers,
    );
    const message = res.choices[0]?.message;
    if (!message) throw new HttpError(502, 'ai.upstream_error');
    messages.push(message);

    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        if (call.function.name === 'query_people') {
          const query = parseQueryArg(call.function.arguments);
          const result = query ? searchPeopleCsv(query, searchablePeople) : 'error: missing "query" argument';
          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        } else if (call.function.name === 'submit_entries') {
          const args = parseJsonSafely(call.function.arguments);
          if (args === undefined) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'error: invalid JSON arguments' });
            continue;
          }
          const parsed = submitEntriesArgsSchema.parse(args);
          return sanitizeNodes(parsed.entries, 1, {
            ownedTagIds,
            ownedPersonIds,
            tags,
            remainingNodes: AI_MAX_SUGGESTION_NODES,
          });
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `error: unknown tool "${call.function.name}"`,
          });
        }
      }
    } else if (reminders < AI_MAX_SUBMIT_REMINDERS) {
      reminders += 1;
      messages.push({
        role: 'user',
        content: 'You must call submit_entries to finish — with an empty list if nothing is extractable.',
      });
    } else {
      break;
    }
  }
  throw new HttpError(502, 'ai.no_submission');
}

function parseQueryArg(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { query?: unknown };
    return typeof parsed.query === 'string' ? parsed.query : '';
  } catch {
    return '';
  }
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

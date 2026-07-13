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

The entries you submit are always filed under the date ${dateKey} (today is ${today}) — use any relative dates mentioned in the transcript ("yesterday", "last week") only to understand context, never to change where the entry is filed.
${forceEnglishAIEvents
  ? `Write every "content" field in English, even if the transcript is in another language (app language hint: "${language}").`
  : `Write every "content" field in the same language as the transcript (app language hint: "${language}").`}

Split the transcript into concise, first-person diary bullet points. Use "children" for sub-details that belong under a parent point, nested up to ${MAX_SUB_ENTRY_DEPTH} levels deep. Never invent facts that are not in the transcript.

Importance scale (1 = highest ... 5 = lowest): 1 = life-changing event, 2 = significant, 3 = anecdotal, 4 = routine event, 5 = casual thought. Default to 3 or 4 unless the transcript clearly signals otherwise.

Existing tags (id: name) — you may ONLY reference these ids/names, never invent a new one:
${tagLines}

People convention: before writing about a specific named person, call query_people with their name. If a confident match is found, put their id in the entry's "people" array and write "@ExactName" in the content using the EXACT name query_people returned. If no confident match is found, write their name as plain text without "@".

If the transcript is ambiguous, prefer a conservative interpretation and verify uncertain names, nicknames, or spelling variants with query_people before deciding.

Be aggressive about tool calls: if the transcript contains anything that could be a person name, treat it as a candidate and call query_people before deciding. This includes capitalized tokens, unusual proper-name-looking words, and any name-like phrase that could plausibly refer to someone in the user's profile.

Do not rely on the model's memory of known people; use the tool to verify the match before deciding whether to tag the person or leave the name as plain text. Remember that the transcription may be slightly inaccurate, especially for names, so if a name looks plausible but not exact, assume the transcript may have mangled it and try similar-sounding variants too. For example: if the transcript contains "Ivonne" or "Yvonne" instead of "Ibón", which is the most likely correct spelling in my context.

Remember that the transcription itself may be wrong. If a name looks plausible but not exact, assume the transcript may have mangled it and try similar-sounding variants too, because the spoken name may have been transcribed imperfectly.

Tags convention: a tag can be linked EITHER by putting its id in the "tags" array (when its name doesn't fit naturally into the sentence) OR by writing "#TagName" inline in the content using the EXACT name from the list above (when it reads naturally). Both are combined into one set, so use whichever fits the sentence — never invent a name that isn't in the list. Examples:
- { content: "Did A with @B", tags: ["<id of groupC>"] } — groupC is linked via the tags array because "#groupC" wouldn't read naturally in the sentence.
- { content: "#Trip with @A to B", tags: [] } — Trip is written inline because it reads naturally as part of the sentence.

You MUST finish by calling submit_entries exactly once, even if the list is empty.`;
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

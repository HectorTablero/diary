import type { PersonDto } from '@diary/shared';
import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useEntityLinks } from '@/lib/entityLinks';
import { segmentContent } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { NotebookImage } from './NotebookImage';
import { useDocumentLabels } from './useNotebook';

/**
 * The notebook's read view: Markdown, rendered, with `@mentions` resolved to people and `[[id]]`
 * resolved to other documents.
 *
 * ## Why a renderer rather than a library
 *
 * The whole surface is headings, quotes, lists (including task items), rules, emphasis, code, links,
 * images and cross-document references — a wider set than when this comment was first written, but
 * still none of it needing a parser generator. A Markdown library is 30–100 kB, would have to be kept
 * out of `VENDOR_CHUNKS` (registry rule 5), and would still need a second pass afterwards to turn
 * `@Ana` into a link and `[[id]]` into one to another document, since no Markdown dialect knows what
 * either of those is.
 *
 * ## Why no HTML
 *
 * Nothing here produces `dangerouslySetInnerHTML`. Every construct becomes a React element, so a
 * document containing `<script>` renders those characters and nothing else happens — which is the
 * same parse-don't-trust posture the plugin layer takes toward every row it reads. It also means
 * raw HTML in a document is shown rather than honoured, which for a private notebook is the right
 * way round: what you typed is what you see.
 *
 * ## Mentions
 *
 * `segmentContent` is the app's own resolver, the one the diary uses — matched by name,
 * longest-first, against the real people list. So `@Ana` means the same thing in a thought as in an
 * entry, and a person renamed while this plugin was switched off still resolves, because the rename
 * rewrote the text itself (renamePersonMentionsInDocuments in db/mutations.ts).
 *
 * `[[id]]` is a different kind of reference and is resolved differently, on purpose: a document's
 * title can change constantly (see model.ts — an untitled document is *labelled* by its own first
 * line), so linking by id and resolving the label live, via `useDocumentLabels`, is what keeps a
 * cross-reference from silently going stale the way a stored, typed name would. See that hook for
 * why resolving it never costs a read proportional to the notebook's size.
 */

interface Block {
  kind: 'heading' | 'paragraph' | 'quote' | 'bullets' | 'numbers' | 'rule' | 'code';
  level?: number;
  lines: string[];
  /** Absolute index into `text.split('\n')` for each entry of `lines`. Only meaningful for
      `bullets`/`numbers`, where a task item's checkbox needs to know which raw line to flip. */
  lineNumbers?: number[];
}

/** Group lines into blocks. Deliberately line-based: a blank line ends whatever was open. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index++;
      continue;
    }

    if (/^```/.test(line)) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) body.push(lines[index++]);
      index++; // the closing fence, or the end of the document if it was never closed
      blocks.push({ kind: 'code', lines: body });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ kind: 'rule', lines: [] });
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, lines: [heading[2]] });
      index++;
      continue;
    }

    /* The three run-on blocks: consecutive lines of the same kind become one element, so a list is
       a list rather than five one-item lists. */
    const runOn = (pattern: RegExp, kind: Block['kind']): boolean => {
      if (!pattern.test(line)) return false;
      const body: string[] = [];
      const lineNumbers: number[] = [];
      while (index < lines.length && pattern.test(lines[index])) {
        body.push(lines[index].replace(pattern, ''));
        lineNumbers.push(index);
        index++;
      }
      blocks.push({ kind, lines: body, lineNumbers });
      return true;
    };

    if (runOn(/^\s*>\s?/, 'quote')) continue;
    if (runOn(/^\s*[-*+]\s+/, 'bullets')) continue;
    if (runOn(/^\s*\d+[.)]\s+/, 'numbers')) continue;

    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(?:#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]) &&
      !/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[index])
    ) {
      body.push(lines[index++]);
    }
    blocks.push({ kind: 'paragraph', lines: body });
  }

  return blocks;
}

/** A task item's checkbox state and remaining text, or `null` for an ordinary list line. */
const TASK_PATTERN = /^\[([ xX])\]\s?(.*)$/;

/**
 * Flip `[ ]` to `[x]` (or back) on one raw line of `text`, leaving everything else untouched.
 *
 * Takes the *whole* document and a line index rather than the item's own text, because the parser
 * already knows exactly which line a rendered item came from (`Block.lineNumbers`) — re-finding it
 * by content would break the moment two task items read the same.
 */
export function toggleTaskAtLine(text: string, lineIndex: number): string {
  const lines = text.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return text;
  const replaced = line.replace(/\[[ xX]\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'));
  if (replaced === line) return text;
  lines[lineIndex] = replaced;
  return lines.join('\n');
}

/** Every `[[id]]` referenced anywhere in `text`, deduplicated — what `useDocumentLabels` needs. */
function referencedDocumentIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) ids.add(match[1]);
  return [...ids];
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 mb-2 text-xl font-semibold first:mt-0',
  2: 'mt-6 mb-2 text-lg font-semibold first:mt-0',
  3: 'mt-5 mb-2 text-base font-semibold first:mt-0',
  4: 'mt-4 mb-1 text-sm font-semibold first:mt-0',
  5: 'mt-4 mb-1 text-sm font-medium first:mt-0',
  6: 'mt-4 mb-1 text-xs font-medium tracking-wide uppercase first:mt-0',
};

export function MarkdownView({
  text,
  people,
  /** Flips a task checkbox in the source and hands back the whole next document. Read-only when
      absent — every checkbox still renders, just disabled, the same "shown, not honoured" posture
      raw HTML gets (see the note above). */
  onToggleTask,
}: {
  text: string;
  people: PersonDto[];
  onToggleTask?: (next: string) => void;
}) {
  const blocks = parseBlocks(text);
  const documentIds = useMemo(() => referencedDocumentIds(text), [text]);
  const documentLabels = useDocumentLabels(documentIds);

  const list = (block: Block, ordered: boolean) => {
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag className={cn('my-3 space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}>
        {block.lines.map((line, i) => {
          const task = TASK_PATTERN.exec(line);
          if (!task) {
            return (
              <li key={i}>
                <Inline text={line} people={people} documentLabels={documentLabels} />
              </li>
            );
          }
          const checked = task[1] !== ' ';
          const lineNumber = block.lineNumbers?.[i];
          return (
            <li key={i} className="-ml-5 flex list-none items-start gap-2">
              <TaskCheckbox
                checked={checked}
                disabled={!onToggleTask || lineNumber === undefined}
                label={task[2]}
                onToggle={() =>
                  lineNumber !== undefined && onToggleTask?.(toggleTaskAtLine(text, lineNumber))
                }
              />
              <span className={cn('flex-1', checked && 'text-muted-foreground line-through')}>
                <Inline text={task[2]} people={people} documentLabels={documentLabels} />
              </span>
            </li>
          );
        })}
      </Tag>
    );
  };

  return (
    <div className="text-[15px] leading-7">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, (block.level ?? 1) + 1)}` as 'h2';
            return (
              <Tag key={key} className={HEADING_CLASS[block.level ?? 1]}>
                <Inline text={block.lines[0]} people={people} documentLabels={documentLabels} />
              </Tag>
            );
          }
          case 'rule':
            return <hr key={key} className="my-6 border-border" />;
          case 'code':
            return (
              <pre
                key={key}
                className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-6"
              >
                <code>{block.lines.join('\n')}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-3 border-l-2 border-border pl-4 text-muted-foreground italic"
              >
                <Inline
                  text={block.lines.join('\n')}
                  people={people}
                  documentLabels={documentLabels}
                />
              </blockquote>
            );
          case 'bullets':
            return <Fragment key={key}>{list(block, false)}</Fragment>;
          case 'numbers':
            return <Fragment key={key}>{list(block, true)}</Fragment>;
          default:
            return (
              <p key={key} className="my-3 whitespace-pre-wrap first:mt-0">
                <Inline
                  text={block.lines.join('\n')}
                  people={people}
                  documentLabels={documentLabels}
                />
              </p>
            );
        }
      })}
    </div>
  );
}

function TaskCheckbox({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  /** The task's own text, read out as this checkbox's name. Markdown syntax inside it (`**bold**`
      and the like) is read literally rather than stripped — a small blemish next to building a
      second, plain-text-only rendering path just for this one string. */
  label: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      aria-label={label || t('plugins.notebook.taskCheckbox')}
      className="mt-1.5 size-3.5 shrink-0 accent-foreground disabled:cursor-not-allowed"
    />
  );
}

/* Inline syntax, innermost-binding first. Code spans come first and are not descended into, which
   is what lets a document explain `**bold**` without the explanation turning bold.

   The three link-shaped forms are checked before the code/emphasis marks resolve their own inner
   text — `[[id]]` before the single-bracket link, so a document reference is never partially
   swallowed by the plainer pattern, and image before link, so `!` is never left dangling in front of
   a rendered link. None of the three is parsed recursively for nested emphasis inside its own
   label/alt text, matching the rest of this hand-rolled, one-pass parser. */
const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))/;

const IMAGE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/;

function Inline({
  text,
  people,
  documentLabels,
}: {
  text: string;
  people: PersonDto[];
  documentLabels: ReadonlyMap<string, string>;
}) {
  const match = INLINE_PATTERN.exec(text);
  if (!match) return <Mentions text={text} people={people} />;

  const before = text.slice(0, match.index);
  const token = match[0];
  const after = text.slice(match.index + token.length);

  let content: ReactNode;
  if (token.startsWith('[[')) {
    const id = token.slice(2, -2);
    content = <DocumentLink id={id} label={documentLabels.get(id)} />;
  } else if (token.startsWith('![')) {
    const image = IMAGE_PATTERN.exec(token)!;
    content = <NotebookImage alt={image[1]} src={image[2]} />;
  } else if (token.startsWith('[')) {
    const link = LINK_PATTERN.exec(token)!;
    content = (
      <a
        href={link[2]}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded-sm text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/40 dark:hover:decoration-sky-300"
      >
        {link[1]}
      </a>
    );
  } else if (token.startsWith('`')) {
    content = (
      <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>
    );
  } else if (token.startsWith('**')) {
    content = (
      <strong className="font-semibold">
        <Mentions text={token.slice(2, -2)} people={people} />
      </strong>
    );
  } else {
    content = (
      <em>
        <Mentions text={token.slice(1, -1)} people={people} />
      </em>
    );
  }

  return (
    <>
      {before && <Mentions text={before} people={people} />}
      {content}
      {after && <Inline text={after} people={people} documentLabels={documentLabels} />}
    </>
  );
}

/** A `[[id]]` reference, as a link to that document — or, unresolved (still loading, or the document
    is gone), the literal text the user typed, exactly as an unresolvable `@mention` renders below.
    Never gated by the `entityLinks` preference: this is a navigation link the user wrote on purpose,
    the same as a `[text](url)`, not a People/Tags mention chip that preference is about. */
function DocumentLink({ id, label }: { id: string; label: string | undefined }) {
  if (!label) return <>{`[[${id}]]`}</>;
  return (
    <Link
      to={`/plugins/notebook?doc=${id}`}
      className="rounded-sm text-sky-700 hover:underline dark:text-sky-300"
    >
      {label}
    </Link>
  );
}

/** Plain text, with every `@Name` that resolves to a real person turned into a link to them. */
function Mentions({ text, people }: { text: string; people: PersonDto[] }): ReactNode {
  const { personTo } = useEntityLinks();
  // No tags in the notebook, so `#` is left alone for Markdown headings to use.
  const segments = segmentContent(text, people, []);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind !== 'person') return <Fragment key={index}>{segment.text}</Fragment>;
        const to = personTo(segment.id);
        /* An unresolvable mention, or links switched off in preferences, renders as the plain text
           it already is — never as a dead link. Same rule the diary's own chips follow. */
        if (!to) {
          return (
            <span key={index} className="text-sky-700 dark:text-sky-300">
              {segment.text}
            </span>
          );
        }
        return (
          <Link
            key={index}
            to={to}
            className="rounded-sm text-sky-700 hover:underline dark:text-sky-300"
          >
            {segment.text}
          </Link>
        );
      })}
    </>
  );
}

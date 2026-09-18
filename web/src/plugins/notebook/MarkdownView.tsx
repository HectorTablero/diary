import type { PersonDto } from '@diary/shared';
import { Fragment, useMemo, type Key, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Checkbox } from '@/components/ui/checkbox';
import { useEntityLinks } from '@/lib/entityLinks';
import { segmentContent } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { MermaidDiagram } from './MermaidDiagram';
import { NotebookImage } from './NotebookImage';
import {
  DIAGRAM_FENCE,
  INLINE_PATTERN,
  MATH_FENCE,
  mathBlockAt,
  readMathToken,
  referencedDocumentIds,
} from './syntax';
import { TexMath } from './TexMath';
import { useDocumentLabels } from './useNotebook';

/**
 * The notebook's read view: Markdown, rendered, with `@mentions` resolved to people and `[[id]]`
 * resolved to other documents.
 *
 * ## Why a renderer rather than a library
 *
 * The whole surface is headings, quotes, lists (nested, and including task items), rules, emphasis,
 * code, math, links, images and cross-document references — a wider set than when this comment was
 * first written, but still none of it needing a parser generator. A Markdown library is 30–100 kB,
 * would have to be kept out of `VENDOR_CHUNKS` (registry rule 5), and would still need a second pass
 * afterwards to turn `@Ana` into a link and `[[id]]` into one to another document, since no Markdown
 * dialect knows what either of those is.
 *
 * Math and diagrams are the two constructs that *do* take a library, because typesetting LaTeX and
 * laying out a graph are not things to hand-roll — but only for the drawing. Finding a formula or a
 * ` ```mermaid ` block is this file's and syntax.ts's job like everything else; KaTeX and Mermaid are
 * handed what is inside, and are themselves only fetched once there is some to hand them. See
 * TexMath.tsx and MermaidDiagram.tsx.
 *
 * ## Why no HTML
 *
 * Nothing here produces `dangerouslySetInnerHTML`. Every construct becomes a React element, so a
 * document containing `<script>` renders those characters and nothing else happens — which is the
 * same parse-don't-trust posture the plugin layer takes toward every row it reads. It also means
 * raw HTML in a document is shown rather than honoured, which for a private notebook is the right
 * way round: what you typed is what you see.
 *
 * The two exceptions are KaTeX's and Mermaid's output, inserted by TexMath.tsx and MermaidDiagram.tsx
 * — see the notes there on why each has to be markup, and on why that markup is safe to insert when
 * the source it came from is not.
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

interface ListItem {
  /** The item's own words: indentation and marker removed, a task's `[ ]` still on. */
  text: string;
  /** Absolute index into `text.split('\n')` of the line this item is — what a task item's checkbox
      needs in order to know which raw line to flip. */
  lineNumber: number;
  /** The lists indented under this item. Usually one; more when the marker kind changes partway
      down (`- a` and then `1. b` at the same depth are two lists, as everywhere else in Markdown). */
  children: List[];
}

interface List {
  kind: 'list';
  ordered: boolean;
  /** The first item's number, which an `<ol>` has to be told — `3.` starts at three. */
  start: number;
  items: ListItem[];
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph' | 'quote' | 'code'; text: string }
  /** `source` is the block exactly as typed, delimiters and all — shown until KaTeX has rendered it,
      and instead of it when it can't. */
  | { kind: 'math'; tex: string; source: string }
  /** A ` ```mermaid ` fence; `source` is what is between the fences, handed to Mermaid as-is. */
  | { kind: 'diagram'; source: string }
  | { kind: 'rule' }
  | List;

const RULE_LINE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const QUOTE_LINE = /^\s*>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Columns of indentation, with a tab reaching the next multiple of four — so a list indented with
    tabs on one line and spaces on the next still nests the way it looks. */
function indentWidth(whitespace: string): number {
  let width = 0;
  for (const char of whitespace) width = char === '\t' ? width + 4 - (width % 4) : width + 1;
  return width;
}

/**
 * The run of list lines starting at `start`, as a tree.
 *
 * Nesting is decided by indentation alone: an item indented further than the one above it goes
 * *inside* that one, and an item indented less closes every list deeper than itself. How much further
 * doesn't matter — two spaces, four, a tab — because people indent however their keyboard or the
 * app they pasted from did, and "more than the line above" is the one reading all of them share.
 *
 * Returns a list per marker kind at the top level: `- a` then `1. b` are two lists one after the
 * other, as they were before items could nest.
 */
function parseList(lines: readonly string[], start: number): { lists: List[]; end: number } {
  const lists: List[] = [];
  /* The lists still open, outermost first: the indent their items sit at, and the array they live
     in — which is where a new sibling list goes when the marker kind changes at that depth. */
  const open: { indent: number; list: List; siblings: List[] }[] = [];
  let index = start;

  for (; index < lines.length; index++) {
    const match = LIST_ITEM.exec(lines[index]);
    if (!match) break;
    const indent = indentWidth(match[1]);
    const ordered = /^\d/.test(match[2]);
    const item: ListItem = { text: match[3], lineNumber: index, children: [] };
    const fresh = (): List => ({
      kind: 'list',
      ordered,
      start: ordered ? Number.parseInt(match[2], 10) : 1,
      items: [item],
    });

    // The outermost list is never closed by this: an item left of it is still one of its items.
    while (open.length > 1 && open.at(-1)!.indent > indent) open.pop();
    const top = open.at(-1);

    if (!top) {
      const list = fresh();
      lists.push(list);
      open.push({ indent, list, siblings: lists });
    } else if (indent > top.indent) {
      /* Inside the item above. If that item already holds a list of this kind — this line is less
         indented than its earlier children, but still more than the item itself — it joins that one
         rather than starting a second list directly beneath it. */
      const parent = top.list.items.at(-1)!;
      const previous = parent.children.at(-1);
      if (previous?.ordered === ordered) {
        previous.items.push(item);
        open.push({ indent, list: previous, siblings: parent.children });
      } else {
        const list = fresh();
        parent.children.push(list);
        open.push({ indent, list, siblings: parent.children });
      }
    } else if (top.list.ordered === ordered) {
      top.list.items.push(item);
    } else {
      const list = fresh();
      top.siblings.push(list);
      top.list = list;
    }
  }

  return { lists, end: index };
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
      const opened = index;
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) body.push(lines[index++]);
      index++; // the closing fence, or the end of the document if it was never closed
      if (MATH_FENCE.test(line)) {
        blocks.push({
          kind: 'math',
          tex: body.join('\n'),
          source: lines.slice(opened, index).join('\n'),
        });
      } else if (DIAGRAM_FENCE.test(line)) {
        blocks.push({ kind: 'diagram', source: body.join('\n') });
      } else {
        blocks.push({ kind: 'code', text: body.join('\n') });
      }
      continue;
    }

    const formula = mathBlockAt(lines, index);
    if (formula) {
      const source = lines.slice(index, formula.end + 1).join('\n');
      blocks.push({ kind: 'math', tex: formula.tex, source });
      index = formula.end + 1;
      continue;
    }

    if (RULE_LINE.test(line)) {
      blocks.push({ kind: 'rule' });
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      index++;
      continue;
    }

    // Consecutive quoted lines are one quote, rather than five one-line quotes.
    if (QUOTE_LINE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE_LINE.test(lines[index])) {
        body.push(lines[index++].replace(QUOTE_LINE, ''));
      }
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { lists, end } = parseList(lines, index);
      blocks.push(...lists);
      index = end;
      continue;
    }

    /* A paragraph runs until a blank line or the start of anything else — a display formula
       included, so `The sum is` on one line and `$$` on the next reads the way it does in Obsidian. */
    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(?:#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]) &&
      !RULE_LINE.test(lines[index]) &&
      !(body.length && mathBlockAt(lines, index))
    ) {
      body.push(lines[index++]);
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
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

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 mb-2 text-xl font-semibold first:mt-0',
  2: 'mt-6 mb-2 text-lg font-semibold first:mt-0',
  3: 'mt-5 mb-2 text-base font-semibold first:mt-0',
  4: 'mt-4 mb-1 text-sm font-semibold first:mt-0',
  5: 'mt-4 mb-1 text-sm font-medium first:mt-0',
  6: 'mt-4 mb-1 text-xs font-medium tracking-wide uppercase first:mt-0',
};

/* A marker per depth, cycling, so a nested list reads as nested even before the indent is noticed —
   the browser would do this for bullets on its own, but `list-disc` pins the outermost one and so
   every level has to be named. Written out whole so Tailwind sees each class. */
const BULLET_MARKERS = ['list-disc', 'list-[circle]', 'list-[square]'];
const NUMBER_MARKERS = ['list-decimal', 'list-[lower-alpha]', 'list-[lower-roman]'];

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
  // Only the map here: the preview renders an unresolved reference and a still-loading one the
  // same way — as the text the user typed — so it has no use for `loading`. See DocumentLabels.
  const { labels: documentLabels } = useDocumentLabels(documentIds);

  const list = (block: List, depth: number, key: Key): ReactNode => {
    const markers = block.ordered ? NUMBER_MARKERS : BULLET_MARKERS;
    const className = cn(
      depth === 0 ? 'my-3' : 'mt-1',
      'space-y-1 pl-5',
      markers[depth % markers.length],
    );
    const items = block.items.map((item, i) => {
      const nested = item.children.map((child, j) => list(child, depth + 1, j));
      const task = TASK_PATTERN.exec(item.text);
      if (!task) {
        return (
          <li key={i}>
            <Inline text={item.text} people={people} documentLabels={documentLabels} />
            {nested}
          </li>
        );
      }
      const checked = task[1] !== ' ';
      return (
        <li key={i} className="-ml-5 list-none">
          <div className="flex items-start gap-2">
            <TaskCheckbox
              checked={checked}
              disabled={!onToggleTask}
              label={task[2]}
              onToggle={() => onToggleTask?.(toggleTaskAtLine(text, item.lineNumber))}
            />
            <span className={cn('flex-1', checked && 'text-muted-foreground line-through')}>
              <Inline text={task[2]} people={people} documentLabels={documentLabels} />
            </span>
          </div>
          {/* Under the task's words rather than under its checkbox, which is where a plain item's
              children sit too: `ml-6` is the checkbox and the gap beside it. Never struck through
              with it — ticking a task doesn't finish the ones inside it. */}
          {nested.length > 0 && <div className="ml-6">{nested}</div>}
        </li>
      );
    });
    return block.ordered ? (
      <ol key={key} start={block.start} className={className}>
        {items}
      </ol>
    ) : (
      <ul key={key} className={className}>
        {items}
      </ul>
    );
  };

  return (
    <div className="text-[15px] leading-7">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, block.level + 1)}` as 'h2';
            return (
              <Tag key={key} className={HEADING_CLASS[block.level]}>
                <Inline text={block.text} people={people} documentLabels={documentLabels} />
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
                <code>{block.text}</code>
              </pre>
            );
          case 'diagram':
            return <MermaidDiagram key={key} source={block.source} />;
          case 'math':
            return <TexMath key={key} tex={block.tex} display source={block.source} />;
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-3 border-l-2 border-border pl-4 text-muted-foreground italic"
              >
                <Inline text={block.text} people={people} documentLabels={documentLabels} />
              </blockquote>
            );
          case 'list':
            return list(block, 0, key);
          default:
            return (
              <p key={key} className="my-3 whitespace-pre-wrap first:mt-0">
                <Inline text={block.text} people={people} documentLabels={documentLabels} />
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
  /* The app's own checkbox, not the browser's. A bare `<input type="checkbox">` is drawn by the
     platform — a blue Windows tick, a different blue on a Mac, something else again on Android — and
     next to this app's own switches and radio groups it reads as a form control that wandered in
     from another page. The shared component is the same square, border and check the rest of the
     app uses, and it follows the theme. */
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      onCheckedChange={onToggle}
      aria-label={label || t('plugins.notebook.taskCheckbox')}
      className="mt-1.5"
    />
  );
}

/* The inline grammar — which token wins where — lives in syntax.ts, because the editor's highlight
   layer has to agree with this renderer character for character. See the note at the top of that
   file for what the two surfaces would otherwise disagree about. */

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
  const math = readMathToken(token);
  if (math) {
    content = <TexMath tex={math.tex} display={math.display} source={token} />;
  } else if (token.startsWith('[[')) {
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

import type { PersonDto } from '@diary/shared';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useEntityLinks } from '@/lib/entityLinks';
import { segmentContent } from '@/lib/tokens';

/**
 * The notebook's read view: Markdown, rendered, with `@mentions` resolved to people.
 *
 * ## Why a renderer rather than a library
 *
 * The whole surface is headings, quotes, lists, rules, emphasis and code — six constructs, none of
 * which needs a parser generator. A Markdown library is 30–100 kB, would have to be kept out of
 * `VENDOR_CHUNKS` (registry rule 5), and would still need a second pass afterwards to turn `@Ana`
 * into a link, since no Markdown dialect knows what a person is.
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
 */

interface Block {
  kind: 'heading' | 'paragraph' | 'quote' | 'bullets' | 'numbers' | 'rule' | 'code';
  level?: number;
  lines: string[];
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
      while (index < lines.length && pattern.test(lines[index])) {
        body.push(lines[index].replace(pattern, ''));
        index++;
      }
      blocks.push({ kind, lines: body });
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

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 mb-2 text-xl font-semibold first:mt-0',
  2: 'mt-6 mb-2 text-lg font-semibold first:mt-0',
  3: 'mt-5 mb-2 text-base font-semibold first:mt-0',
  4: 'mt-4 mb-1 text-sm font-semibold first:mt-0',
  5: 'mt-4 mb-1 text-sm font-medium first:mt-0',
  6: 'mt-4 mb-1 text-xs font-medium tracking-wide uppercase first:mt-0',
};

export function MarkdownView({ text, people }: { text: string; people: PersonDto[] }) {
  const blocks = parseBlocks(text);

  return (
    <div className="text-[15px] leading-7">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, (block.level ?? 1) + 1)}` as 'h2';
            return (
              <Tag key={key} className={HEADING_CLASS[block.level ?? 1]}>
                <Inline text={block.lines[0]} people={people} />
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
                <Inline text={block.lines.join('\n')} people={people} />
              </blockquote>
            );
          case 'bullets':
            return (
              <ul key={key} className="my-3 list-disc space-y-1 pl-5">
                {block.lines.map((line, i) => (
                  <li key={i}>
                    <Inline text={line} people={people} />
                  </li>
                ))}
              </ul>
            );
          case 'numbers':
            return (
              <ol key={key} className="my-3 list-decimal space-y-1 pl-5">
                {block.lines.map((line, i) => (
                  <li key={i}>
                    <Inline text={line} people={people} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={key} className="my-3 whitespace-pre-wrap first:mt-0">
                <Inline text={block.lines.join('\n')} people={people} />
              </p>
            );
        }
      })}
    </div>
  );
}

/* Inline syntax, innermost-binding first. Code spans come first and are not descended into, which
   is what lets a document explain `**bold**` without the explanation turning bold. */
const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/;

function Inline({ text, people }: { text: string; people: PersonDto[] }) {
  const match = INLINE_PATTERN.exec(text);
  if (!match) return <Mentions text={text} people={people} />;

  const before = text.slice(0, match.index);
  const token = match[0];
  const after = text.slice(match.index + token.length);

  const inner = token.startsWith('**')
    ? token.slice(2, -2)
    : token.startsWith('`')
      ? token.slice(1, -1)
      : token.slice(1, -1);

  return (
    <>
      {before && <Mentions text={before} people={people} />}
      {token.startsWith('`') ? (
        <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{inner}</code>
      ) : token.startsWith('**') ? (
        <strong className="font-semibold">
          <Mentions text={inner} people={people} />
        </strong>
      ) : (
        <em>
          <Mentions text={inner} people={people} />
        </em>
      )}
      {after && <Inline text={after} people={people} />}
    </>
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

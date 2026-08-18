import { MAX_PLUGIN_DOCUMENT_TITLE_LENGTH } from '@diary/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The document's name — which *is* the page heading, and is edited in place.
 *
 * There is deliberately only one of it. An earlier pass had the heading at the top of the page and a
 * title field inside the editor below it, which is the same string written twice: one of them had to
 * be the real one, and nothing on screen said which.
 *
 * So the heading carries the affordance itself. A dotted underline is the only decoration — the same
 * hint a file manager or a spreadsheet gives for a rename — and clicking swaps in an input sized and
 * weighted identically, so nothing moves when it does. Everything is inherited (`font-[inherit]`,
 * `text-[length:inherit]`) rather than restated, because this renders inside PageHeader's `h1` and a
 * second copy of those values here is a second place for them to drift.
 *
 * What is *displayed* is the label — so an untitled document shows the first line of its own prose,
 * the way it does everywhere else. What is *edited* is the stored title, which for that document is
 * empty. Otherwise clicking the heading and typing one character would silently promote a line of
 * the body into a title nobody wrote.
 */
export function TitleField({
  title,
  label,
  startEditing,
  onCommit,
}: {
  title: string;
  label: string;
  /** Mount already in edit mode, focused — for a document just created, so a name can be typed
      immediately rather than requiring a click on the heading first. Read once, on mount: this
      component is always remounted per document (see the `key={current.id}` at the call site), so
      there is no later render where the prop could change and need to be reacted to. */
  startEditing?: boolean;
  onCommit: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(startEditing ? title : null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(title)}
        title={t('plugins.notebook.titleEditHint')}
        /* Square, deliberately. A rounded corner on an element whose only border is the bottom one
           curls the ends of the underline up and away from the text, which reads as a rendering
           fault rather than as a style. */
        className="block w-full truncate border-b border-dotted border-muted-foreground/60 text-start font-[inherit] text-[length:inherit] hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        {label}
      </button>
    );
  }

  const commit = () => {
    onCommit(draft.trim());
    setDraft(null);
  };

  return (
    <input
      value={draft}
      autoFocus
      maxLength={MAX_PLUGIN_DOCUMENT_TITLE_LENGTH}
      placeholder={t('plugins.notebook.titlePlaceholder')}
      aria-label={t('plugins.notebook.titleLabel')}
      onChange={(event) => setDraft(event.target.value)}
      /* Committed on blur or Enter rather than per keystroke: one write per character would be one
         sync kick per character for a field nobody types in for long. Escape abandons the edit,
         which is the whole reason the draft is kept separate from the stored value. */
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(null);
        }
      }}
      className="block w-full border-b border-foreground bg-transparent font-[inherit] text-[length:inherit] outline-none placeholder:font-normal placeholder:text-muted-foreground"
    />
  );
}

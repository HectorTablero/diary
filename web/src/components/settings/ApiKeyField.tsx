import { KeyRound, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A provider API key field for a key the app can no longer read back.
 *
 * Keys are write-only: the server stores them and reports only whether one exists (see
 * SettingsDto). A password input pre-filled with the stored value is therefore not just
 * unavailable, it would be a lie — the old field showed dots that stood for a real secret sitting
 * in the page's memory and in IndexedDB. So the resting state says plainly that a key is set and
 * offers the only two things that can still be done to it: replace it, or remove it.
 *
 * Both states are deliberately the same shape — a field the width of the input, then its actions —
 * so the row never reflows and the difference is read from fill rather than from a colour. A
 * stored key is a filled, uneditable slot bearing a key glyph; no key is an empty one waiting to
 * be typed in. Colour stays out of it: in this app hue already means importance, and the ramp
 * (ImportanceDot) runs through green, so a green tick here would be borrowing a word that is taken.
 *
 * Unlike the rest of the page this does not autosave on blur. Half a pasted key committed by a
 * stray focus change would overwrite a working one with something that cannot authenticate, and
 * the user could not look at the field to see what went wrong.
 */
export function ApiKeyField({
  id,
  label,
  hint,
  placeholder,
  hasKey,
  disabled = false,
  onSave,
}: {
  id: string;
  label: string;
  /** Where to get a key — rendered under the field. */
  hint: ReactNode;
  placeholder: string;
  hasKey: boolean;
  disabled?: boolean;
  /** An empty string clears the stored key. */
  onSave: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const commit = () => {
    onSave(value.trim());
    setValue('');
    setEditing(false);
  };

  const cancel = () => {
    setValue('');
    setEditing(false);
  };

  const stored = hasKey && !editing;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Only a real label while there is something to label: with the key stored there is no
          input for `htmlFor` to point at, and a label for nothing is a label lying about what it
          does. Still rendered through Label so both states share its metrics exactly — it sets
          `leading-none`, and a plain span picking up the normal line height made the whole block
          six pixels taller the moment the key was replaced. */}
      {stored ? (
        <Label asChild>
          <span>{label}</span>
        </Label>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}

      {stored ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border border-input bg-muted px-2.5 text-sm text-muted-foreground">
            <KeyRound className="size-3.5 shrink-0" />
            {t('settings.ai.keySet')}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {t('settings.ai.replaceKey')}
          </Button>
          {/* The one place colour is earned here — and only on hover, where it warns about what
              the press will do rather than decorating the resting state. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
            disabled={disabled}
            onClick={() => onSave('')}
          >
            <Trash2 className="size-3.5" />
            {t('common.remove')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            autoFocus={editing}
            disabled={disabled}
            value={value}
            aria-describedby={`${id}-hint`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) commit();
              if (e.key === 'Escape' && editing) cancel();
            }}
            placeholder={placeholder}
            className="max-w-sm"
          />
          <Button size="sm" className="h-8" disabled={disabled || !value.trim()} onClick={commit}>
            {t('common.save')}
          </Button>
          {editing && (
            <Button variant="ghost" size="sm" className="h-8" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      )}

      {/* Carries where to get a key and what it is used for — which is exactly what someone
          landing on an empty password field needs read out to them, not just its label. */}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

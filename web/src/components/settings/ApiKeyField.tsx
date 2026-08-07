import { Check, Pencil, Trash2 } from 'lucide-react';
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

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>

      {hasKey && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="size-4" />
            {t('settings.ai.keySet')}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3" />
            {t('settings.ai.replaceKey')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            disabled={disabled}
            onClick={() => onSave('')}
          >
            <Trash2 className="size-3" />
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

      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

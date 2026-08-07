import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { notifySuccess } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * One titled block of settings, with an optional second tier behind an "Advanced" disclosure.
 *
 * That tier used to be a section of its own at the bottom of the page, which meant a setting was
 * filed by how obscure it is rather than by what it belongs to — "how deep sub-entries nest" sat
 * two screens away from the rest of the entry defaults. Keeping the split *inside* each block
 * gives both: nothing rare is in the way, and everything about entries is in the entries block.
 *
 * Collapsed on every visit, and per-section rather than one page-wide switch, so opening one
 * doesn't quietly unfold the rest of the page.
 */
export function Section({
  title,
  description,
  children,
  advanced,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  advanced?: ReactNode;
}) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
      {advanced && (
        <>
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((open) => !open)}
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')}
            />
            {t('settings.advanced.title')}
          </button>
          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-4 border-t pt-4">{advanced}</div>
          )}
        </>
      )}
    </section>
  );
}

/** Label, optional explanation, and a switch on the right — the shape every on/off setting on this
    page had been repeating. `children` hangs an extra control under the row when one is on. */
export function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id}>{label}</Label>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <Switch id={id} disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {children}
    </div>
  );
}

/* Theme, language and the week start never reach the server — they describe this device, not the
   diary. Saying so on every change is what stops "why didn't my phone pick this up?" from being
   a mystery, and it is a confirmation the user asked for, so quiet mode does not drop it. */
export const notifyDeviceSaved = (message: string) => notifySuccess(message, { important: true });

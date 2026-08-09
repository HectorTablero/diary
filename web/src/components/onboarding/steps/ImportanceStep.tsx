import { IMPORTANCE_LEVELS } from '@diary/shared';
import { Star, StarX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImportanceMarkerClass } from '@/components/entry/ImportanceDot';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { setPreference, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

/**
 * All five levels with what each one means, and the switch that gives them shapes.
 *
 * These are one screen rather than two on purpose: the toggle changes the exact markers this screen
 * exists to explain, so the step's own content is the preview. It is a better one than the five
 * bare dots under the Settings switch, because here each silhouette sits beside the name it stands
 * for — which is the thing you need to have learned for the shapes to be readable later.
 *
 * The markers are `aria-hidden`, unlike `ImportanceDot`, which carries `role="img"` and a label.
 * The difference is the context: on an entry row the dot is alone and the level appears nowhere
 * else, so it must be announced; here the name and the description are right there in the same row,
 * and announcing it again would read every level twice. That redundancy is also what makes this
 * screen legible with the toggle *off* — the colour is never the only encoding.
 */
export function ImportanceStep() {
  const { t } = useTranslation();
  const { importanceShapes } = usePreferences();
  const markerClass = useImportanceMarkerClass();

  const AccesibilityIcon = importanceShapes ? Star : StarX;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {IMPORTANCE_LEVELS.map((level) => (
          <li key={level} className="flex items-start gap-3">
            <span aria-hidden className={cn('mt-1 size-3 shrink-0', markerClass(level))} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t(`importance.levels.${level}`)}</p>
              <p className="text-xs text-muted-foreground">
                {t(`importance.descriptions.${level}`)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* Written out rather than passed to ToggleRow, which has no room for a leading icon. The
          icon is worth the divergence: this is the one control in the tour that is not about the
          diary but about reading it, and the glyph says so before the label is read. */}
      <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs">
        <AccesibilityIcon aria-hidden className="size-6.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Label htmlFor="onboarding-importance-shapes">
            {t('settings.general.importanceShapes')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('settings.general.importanceShapesDescription')}
          </p>
        </div>
        <Switch
          id="onboarding-importance-shapes"
          checked={importanceShapes}
          /* No notifyDeviceSaved() here, unlike the identical switch in Settings. A toast sliding
             over a full-screen modal is noise, and the five markers above reshaping in place is a
             better confirmation than any sentence: it is the thing the setting does. */
          onCheckedChange={(checked) => setPreference('importanceShapes', checked)}
        />
      </div>
    </div>
  );
}

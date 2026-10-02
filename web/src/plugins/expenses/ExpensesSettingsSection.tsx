import { ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Section } from '@/components/settings/Section';
import { Button } from '@/components/ui/button';
import { notifyError, notifySuccess } from '@/lib/notify';
import { captureError } from '@/lib/telemetry';
import { currencyName } from './currency';
import { CurrencyPicker } from './ExpenseForm';
import { resolveDefaultCurrency, saveExpenseSettings, useExpenseSettings } from './useExpenses';

/**
 * The expense tracker's settings card: the default currency, and nothing else.
 *
 * Unlike the other plugins' cards this one is synced rather than device-local — see
 * `useExpenseSettings` — and it says so, since every other plugin card in this list says the
 * opposite. Shown on every platform for the same reason: there is no alarm here to arm.
 *
 * "Whatever I used last" is the default and sits first, the way the entry importance setting
 * offers the same choice. Which currency the page *shows* totals in is picked on the page itself,
 * next to the figures it changes.
 */
export function ExpensesSettingsSection() {
  const { t, i18n } = useTranslation();
  const settings = useExpenseSettings();
  const lastUsed = settings.currency === null;
  const resolved = resolveDefaultCurrency(settings);

  const save = (currency: string | null) => {
    if (currency === settings.currency) return;
    saveExpenseSettings({ currency }).then(
      () => notifySuccess(t('common.saved')),
      (error: unknown) => {
        captureError(error, { scope: 'plugin.expenses.settings' });
        notifyError(t('plugins.expenses.saveFailed'));
      },
    );
  };

  return (
    <Section
      title={t('plugins.expenses.settingsTitle')}
      description={t('plugins.expenses.settingsDescription')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium" id="expenses-default-currency">
            {t('plugins.expenses.defaultCurrency')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('plugins.expenses.defaultCurrencyDescription')}
          </p>
        </div>
        <CurrencyPicker
          value={settings.currency}
          onChange={save}
          extraOption={{
            label: t('plugins.expenses.currencyLastUsed'),
            onSelect: () => save(null),
          }}
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              aria-labelledby="expenses-default-currency"
              aria-describedby="expenses-default-currency-value"
            >
              <span id="expenses-default-currency-value">
                {lastUsed ? (
                  <>
                    {t('plugins.expenses.currencyLastUsed')}
                    {/* Which one that currently is, so the choice isn't a mystery. */}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{resolved}</span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-xs">{resolved}</span>
                    <span className="ml-2 text-muted-foreground">
                      {currencyName(resolved, i18n.language)}
                    </span>
                  </>
                )}
              </span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </Button>
          }
        />
      </div>
    </Section>
  );
}

import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Spinner } from '@/components/common/Spinner';
import { DeleteAccountDialog } from '@/components/settings/DeleteAccountDialog';
import { MarkdownExportDialog } from '@/components/settings/MarkdownExportDialog';
import { Button } from '@/components/ui/button';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { buildBackupEnvelope } from '@/lib/backup/export';
import { backupEnvelopeSchema } from '@/lib/backup/schema';
import { saveTextFile } from '@/lib/fileSave';
import { notifyError, notifySuccess } from '@/lib/notify';
import { setPreference, usePreferences } from '@/lib/preferences';
import { isTelemetryConfigured } from '@/lib/telemetry';
import { notifyDeviceSaved, Section, ToggleRow } from './Section';

/** Getting the diary out of the app, back into it, and the one switch over what leaves it.
    Self-contained: the export/import machinery is used nowhere else on the page. */
export function DataSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prefs = usePreferences();
  const { data: session } = useSession();
  /* Deleting the account is the one action on this page that *only* works online — everything else
     here reads or writes the local store. `paused` is not included: wi-fi-only holds back the
     background sync on purpose, and it should not silently veto something the user just asked for. */
  const { blocker } = useSyncStatus();
  const serverUnreachable = blocker === 'offline' || blocker === 'unreachable';
  const [exportingBackup, setExportingBackup] = useState(false);
  const [markdownDialogOpen, setMarkdownDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = async () => {
    setExportingBackup(true);
    try {
      const envelope = await buildBackupEnvelope();
      await saveTextFile(
        `diary-backup-${envelope.exportedAt.slice(0, 10)}.json`,
        JSON.stringify(envelope, null, 2),
        'application/json',
      );
      notifySuccess(t('settings.data.exportDone'), { important: true });
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setExportingBackup(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // clears the input so re-selecting the same file still fires onChange
    if (!file) return;
    try {
      const parsed = backupEnvelopeSchema.parse(JSON.parse(await file.text()));
      void navigate('/settings/import-backup', { state: { envelope: parsed } });
    } catch {
      notifyError(t('settings.data.invalidFile'));
    }
  };

  return (
    <>
      <Section title={t('settings.data.title')} description={t('settings.data.description')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                disabled={exportingBackup}
                onClick={() => void handleExportBackup()}
              >
                {exportingBackup ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {t('settings.data.export')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={() => importFileRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {t('settings.data.import')}
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void handleImportFile(e)}
              />
            </div>
            {/* Was a "include sensitive data" checkbox. There is nothing left for it to
                include: provider keys never reach this device, and device preferences are not
                part of a backup — so the honest control is a sentence, not a choice. */}
            <p className="text-xs text-muted-foreground">{t('settings.data.exportOmits')}</p>
          </div>

          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 h-8"
              onClick={() => setMarkdownDialogOpen(true)}
            >
              <FileText className="size-3.5" />
              {t('settings.data.exportMarkdown')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('settings.data.exportMarkdownDescription')}
            </p>
          </div>

          {/* Only where the build actually reports somewhere. Telemetry used to be a decision
              made once, by whoever produced the bundle, with no way for the person running it
              to change their mind — this is that switch. */}
          {isTelemetryConfigured() && (
            <div className="border-t pt-4">
              <ToggleRow
                id="telemetry"
                label={t('settings.data.telemetry')}
                description={t('settings.data.telemetryDescription')}
                checked={prefs.telemetry}
                onCheckedChange={(checked) => {
                  setPreference('telemetry', checked);
                  notifyDeviceSaved(t('settings.general.savedOnDevice'));
                }}
              />
            </div>
          )}

          {/* Only with an account: there is no server-side copy to erase in local-only mode, and
              offering to delete one would be offering something this button cannot do. Sitting last
              and behind a divider is the point — nothing else here destroys anything. */}
          {session?.user && (
            <div className="flex flex-col gap-1 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-fit gap-1.5 h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={serverUnreachable}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-3.5" />
                {t('settings.data.deleteAccount.action')}
              </Button>
              {/* Says which of the two it is. A disabled destructive button with no reason beside
                  it reads as "this feature is broken", and the user is owed the difference between
                  that and "the server can't be reached right now". */}
              <p className="text-xs text-muted-foreground">
                {serverUnreachable
                  ? t('settings.data.deleteAccount.needsConnection')
                  : t('settings.data.deleteAccount.actionDescription')}
              </p>
            </div>
          )}
        </div>
      </Section>

      <MarkdownExportDialog open={markdownDialogOpen} onOpenChange={setMarkdownDialogOpen} />
      <DeleteAccountDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
    </>
  );
}

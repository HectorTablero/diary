import { db } from '@/db/db';
import { getSettings } from '@/db/repo';
import { BACKUP_VERSION, type BackupEnvelope } from './schema';

/**
 * Snapshot of everything local.
 *
 * There is no longer an "include sensitive data" choice to make, because there is no longer
 * anything sensitive here to include: provider API keys are write-only and never reach this
 * device (see SettingsDto), so a backup file simply cannot contain one. The settings that do get
 * written are the account's — device preferences like the theme, the reminder times and the app
 * lock live in localStorage and are deliberately not part of a backup either, since they describe
 * the device rather than the diary.
 */
export async function buildBackupEnvelope(): Promise<BackupEnvelope> {
  const [entries, people, tags, threads, settings] = await Promise.all([
    db.entries.toArray(),
    db.people.toArray(),
    db.tags.toArray(),
    db.threads.toArray(),
    getSettings(),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    people,
    tags,
    threads,
    settings,
  };
}

import { db } from '@/db/db';
import { getSettings } from '@/db/repo';
import { BACKUP_VERSION, type BackupEnvelope } from './schema';

/** Snapshot of everything local. `includeSensitive` controls whether the three AI provider API
    keys are present at all in the output — they're omitted entirely (not blanked) so an exported
    file never even hints at whether a key was set. */
export async function buildBackupEnvelope(includeSensitive: boolean): Promise<BackupEnvelope> {
  const [entries, people, tags, threads, settings] = await Promise.all([
    db.entries.toArray(),
    db.people.toArray(),
    db.tags.toArray(),
    db.threads.toArray(),
    getSettings(),
  ]);

  const { groqApiKey: _groqApiKey, openRouterApiKey: _openRouterApiKey, cerebrasApiKey: _cerebrasApiKey, ...settingsWithoutKeys } = settings;

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    people,
    tags,
    threads,
    settings: includeSensitive ? settings : settingsWithoutKeys,
  };
}

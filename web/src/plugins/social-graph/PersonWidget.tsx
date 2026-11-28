import { Waypoints } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ME_ID } from './model';
import { StrengthBars } from './StrengthPicker';
import { useSocialGraph } from './useSocialGraph';

/** How many connections the profile names before deferring to the graph. */
const SHOWN = 5;

/**
 * A line or two under a person's contact details: the groups they're in and who they're closest
 * to, strongest first, each a link to that person's own profile. Draws nothing for someone the
 * graph knows nothing about — a profile isn't where this plugin advertises itself.
 */
export function PersonWidget({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const graph = useSocialGraph();
  if (graph.loading) return null;

  const groups = graph.groups.filter((group) => group.members.includes(personId));
  const connections = graph.links
    .filter((link) => link.a === personId || link.b === personId)
    // Your own tie to someone is a property of the graph, not a fact about them for their profile.
    .filter((link) => link.a !== ME_ID && link.b !== ME_ID)
    .map((link) => ({ link, other: graph.personById.get(link.a === personId ? link.b : link.a)! }))
    .sort((x, y) => y.link.strength - x.link.strength || x.other.name.localeCompare(y.other.name));
  if (!groups.length && !connections.length) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {groups.map((group) => (
            <span
              key={group.id}
              className="flex min-h-6 max-w-full items-center gap-1.5 rounded-xl border px-2 py-0.5 text-foreground"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{group.name}</span>
            </span>
          ))}
        </div>
      )}
      {connections.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span>{t('plugins.social-graph.knows')}</span>
          {connections.slice(0, SHOWN).map(({ link, other }) => (
            <Link
              key={link.id}
              to={`/people/${other.id}`}
              title={link.note || undefined}
              className="flex items-center gap-1 text-foreground hover:underline"
            >
              {other.name}
              <StrengthBars value={link.strength} />
            </Link>
          ))}
          {connections.length > SHOWN && <span>+{connections.length - SHOWN}</span>}
        </p>
      )}
      <Link
        to={`/plugins/social-graph?focus=${personId}`}
        className="flex w-fit items-center gap-1 hover:text-foreground hover:underline"
      >
        <Waypoints className="size-3" />
        {t('plugins.social-graph.openInGraph')}
      </Link>
    </div>
  );
}

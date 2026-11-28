import { getUndatedRecords } from '@/db/pluginRecords';
import i18n from '@/i18n';
import type { PluginModule } from '../types';
import { buildGraphMerged, buildGraphZip, graphExportDefaults } from './export';
import { connectionWeights, parseGraph, parseGroup, parseLink, PLUGIN_ID } from './model';
import { socialGraphOnboardingSteps } from './onboarding/steps';
import { PersonWidget } from './PersonWidget';
import SocialGraphPage from './SocialGraphPage';

/* The social graph. Five surfaces, matching ../registry: the page (reached from the People list,
   not the nav), a line on each profile, its connections for that profile's talking points, its
   own export type, and the tour. No day widget, settings, export or
   notifications — none of it is about a day, and there is nothing to configure. */

const socialGraph: PluginModule = {
  PeoplePage: SocialGraphPage,
  PersonWidget,
  exportOwn: {
    buildMerged: buildGraphMerged,
    buildZip: buildGraphZip,
    defaultOptions: graphExportDefaults,
  },
  talkingPointConnections: async (personId) =>
    connectionWeights(parseGraph(await getUndatedRecords(PLUGIN_ID)).links, personId),
  /* Rows hold only ids, which mean nothing in a backup review; strength and group name are the
     parts a person would recognise. */
  describeRecord: (record) => {
    const link = parseLink(record);
    if (link) {
      return i18n.t('plugins.social-graph.recordLink', {
        strength: i18n.t(`plugins.social-graph.strength${link.strength}`),
      });
    }
    const group = parseGroup(record);
    return group
      ? i18n.t('plugins.social-graph.recordGroup', { name: group.name })
      : i18n.t('plugins.social-graph.name');
  },
  onboardingSteps: socialGraphOnboardingSteps,
};

export default socialGraph;

import i18n from '@/i18n';
import type { PluginModule } from '../types';
import { parseGroup, parseLink } from './model';
import { socialGraphOnboardingSteps } from './onboarding/steps';
import { PersonWidget } from './PersonWidget';
import SocialGraphPage from './SocialGraphPage';

/* The social graph. Three surfaces, matching ../registry: the page (reached from the People list,
   not the nav), a line on each profile, and the tour. No day widget, settings, export or
   notifications — none of it is about a day, and there is nothing to configure. */

const socialGraph: PluginModule = {
  PeoplePage: SocialGraphPage,
  PersonWidget,
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

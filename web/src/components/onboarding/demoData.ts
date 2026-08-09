import type { EntryNode, PersonRefDto, TagDto } from '@diary/shared';
import type { TFunction } from 'i18next';

/**
 * The fake diary the tour is a tour of.
 *
 * Written out as literal DTOs rather than imported from `src/test/fixtures.ts`: that module is
 * test-only and would be pulled into the production bundle, and checkI18n walks `src/**` and would
 * start reading it too.
 *
 * **A function of `t`, not a module constant.** Step 1 of the tour is the language picker, so the
 * demo entries are re-read in the new language a moment after it is used — constants captured at
 * import time would leave the one screen the user is watching for a change stubbornly in English.
 * Callers memoise on `i18n.language`.
 *
 * The names inside the entry text are *interpolated*, never written into the sentence:
 *
 *     "Had a #{{tag}} meeting with @{{person}}"
 *
 * `segmentContent` (lib/tokens.ts) highlights a token only when the text right after `@` or `#`
 * matches an entity's `name`, so a locale where the sentence and the name were translated
 * independently would silently render plain grey text — a tour whose whole subject is the sigils,
 * teaching that they do nothing. Interpolating makes the two impossible to drift apart, and
 * checkI18n's interpolation-parity rule then enforces that every locale keeps both placeholders.
 * What it cannot check is that the `@` and `#` stayed glued to them, which is what demoData.test.ts
 * is for.
 */

/* Fixed rather than derived from `new Date()`. Nothing in the tour renders a date — every EntryRow
   is passed `showDate={false}`, and the "this fades with time" idea is told in prose on the people
   step — so a real clock would buy nothing and cost determinism in the tests. */
const AT = '2024-03-12T18:30:00.000Z';
const DATE_KEY = '2024-03-12';

export interface DemoData {
  /** The person the demo entry is *about* — the one it @mentions. */
  person: PersonRefDto;
  /**
   * Someone the entry never mentions, who carries the same tag it does.
   *
   * The point of the people step, and the reason it is this person's profile that gets opened
   * there: an entry reaches someone through a shared tag as well as through their name, which is
   * the half of the model a mention alone cannot demonstrate.
   */
  colleague: PersonRefDto;
  /** Nobody in particular, seen only half-clipped under the colleague so the people list reads as
      a list of many rather than as the two the demo happens to be about. Needs a name and nothing
      else — deliberately not the person the entry mentions, who would invite the reader to work out
      why she is there. */
  otherPerson: PersonRefDto;
  tag: TagDto;
  otherTags: TagDto[];
  /** One entry with two sub-entries hanging off it — the shape a real day in the diary takes. */
  entry: EntryNode;
}

export function demoData(t: TFunction): DemoData {
  const person: PersonRefDto = { id: 'demo-person', name: t('onboarding.demo.person') };
  const colleague: PersonRefDto = { id: 'demo-colleague', name: t('onboarding.demo.colleague') };
  const otherPerson: PersonRefDto = {
    id: 'demo-other-person',
    name: t('onboarding.demo.otherPerson'),
  };
  /* Teal from the tag palette rather than a fresh hex, so the chip in the tour is a colour a real
     tag could actually be. */
  const tag: TagDto = { id: 'demo-tag', name: t('onboarding.demo.tag'), color: '#4ECDC4' };

  const otherTags: TagDto[] = [
    { id: 'demo-other-tag-1', name: t('onboarding.demo.otherTags.0'), color: '#7F4CCD' },
    { id: 'demo-other-tag-2', name: t('onboarding.demo.otherTags.1'), color: '#CD4C4C' },
    { id: 'demo-other-tag-3', name: t('onboarding.demo.otherTags.2'), color: '#68CD4C' },
    { id: 'demo-other-tag-4', name: t('onboarding.demo.otherTags.3'), color: '#CD8A4C' },
  ];

  const base = {
    dateKey: DATE_KEY,
    tags: [] as TagDto[],
    people: [] as PersonRefDto[],
    threads: [],
    saidTo: [],
    hiddenFor: [],
    createdAt: AT,
    updatedAt: AT,
    children: [] as EntryNode[],
  };

  return {
    person,
    colleague,
    otherPerson,
    tag,
    otherTags,
    entry: {
      ...base,
      id: 'demo-entry',
      parentId: null,
      orderKey: 'a0',
      content: t('onboarding.demo.entryMeeting', { tag: tag.name, person: person.name }),
      importance: 3,
      tags: [tag],
      people: [person],
      children: [
        {
          ...base,
          id: 'demo-entry-collaboration',
          parentId: 'demo-entry',
          orderKey: 'a0',
          content: t('onboarding.demo.entryCollaboration'),
          importance: 4,
        },
      ],
    },
  };
}

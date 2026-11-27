import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginOnboardingStep } from '../../types';
import { GraphCanvas } from '../GraphCanvas';
import { GROUP_COLORS, type Strength } from '../model';
import { StrengthPicker } from '../StrengthPicker';

/* A made-up circle of friends, static: the tour's dialog swipes sideways, which a draggable graph
   would fight. Ids only need to be unique here — nothing is saved. */
const DEMO_PEOPLE = ['Ana', 'Luis', 'Marta', 'Jon', 'Sofía', 'Pablo', 'Irene'].map((name, i) => ({
  id: `demo-${i}`,
  name,
}));
const DEMO_LINKS = [
  { a: 'demo-0', b: 'demo-1', strength: 5 },
  { a: 'demo-0', b: 'demo-2', strength: 4 },
  { a: 'demo-1', b: 'demo-2', strength: 3 },
  { a: 'demo-2', b: 'demo-3', strength: 2 },
  { a: 'demo-3', b: 'demo-4', strength: 4 },
  { a: 'demo-4', b: 'demo-5', strength: 3 },
  { a: 'demo-5', b: 'demo-6', strength: 5 },
  { a: 'demo-3', b: 'demo-5', strength: 1 },
];

function GraphStep() {
  const { t } = useTranslation();
  const groups = [
    {
      id: 'family',
      name: t('plugins.social-graph.onboarding.graph.demoFamily'),
      color: GROUP_COLORS[0],
      members: ['demo-0', 'demo-1', 'demo-2'],
    },
    {
      id: 'work',
      name: t('plugins.social-graph.onboarding.graph.demoWork'),
      color: GROUP_COLORS[4],
      members: ['demo-2', 'demo-3', 'demo-4'],
    },
  ];
  const people = [{ id: 'demo-me', name: t('plugins.social-graph.you'), me: true }, ...DEMO_PEOPLE];
  const links = [
    ...DEMO_LINKS,
    { a: 'demo-me', b: 'demo-0', strength: 5 },
    { a: 'demo-me', b: 'demo-3', strength: 3 },
  ];
  return (
    <div className="h-64 overflow-hidden rounded-xl border bg-card shadow-xs">
      <GraphCanvas
        people={people}
        links={links}
        groups={groups}
        selected={new Set()}
        ariaLabel={t('plugins.social-graph.graphLabel')}
      />
    </div>
  );
}

function StrengthStep() {
  const { t } = useTranslation();
  const [value, setValue] = useState<Strength | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-sm font-medium">
        {t('plugins.social-graph.pairTitle', { a: 'Ana', b: 'Luis' })}
      </p>
      <StrengthPicker value={value} onChange={setValue} />
      <p className="text-xs text-muted-foreground">
        {t('plugins.social-graph.onboarding.strength.previewNote')}
      </p>
    </div>
  );
}

export const socialGraphOnboardingSteps: readonly PluginOnboardingStep[] = [
  { id: 'graph', Component: GraphStep },
  { id: 'strength', Component: StrengthStep },
];

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookOpen, Merge, Tag, UserPlus, Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { ConflictSection } from './ConflictSection';
import { ImportSummary } from './ImportSummary';

/*
 * The review screen's two new furniture pieces, rendered against the real English bundle.
 *
 * What these catch is the failure mode a typecheck cannot: a key that exists in the JSON under a
 * different name, or an interpolation the string never spends. Both compile, both pass every other
 * test, and both ship a screen with `importBackup.needsReview` printed on it where a count should
 * be — the exact class of bug web/src/test/setup.ts loads the real locale to expose.
 */

const categories = [
  { label: 'Tags', icon: Tag, total: 12, conflicts: 2 },
  { label: 'People', icon: Users, total: 48, conflicts: 0 },
  { label: 'Entries', icon: BookOpen, total: 1204, conflicts: 0 },
];

describe('ImportSummary', () => {
  it('names which backup is being reviewed', () => {
    render(<ImportSummary exportedAt="2026-08-08T10:00:00.000Z" version={2} categories={[]} />);

    // The date is formatted, not the raw ISO string, and the format number is not the app version.
    expect(screen.getByText('Exported August 8th, 2026')).toBeInTheDocument();
    expect(screen.getByText('Backup format v2')).toBeInTheDocument();
  });

  it('leads with the count, and says which categories need a decision', () => {
    render(
      <ImportSummary exportedAt="2026-08-08T10:00:00.000Z" version={2} categories={categories} />,
    );

    // Grouped digits: a four-figure entry count is the whole reason the tiles are this size.
    expect(screen.getByText('1,204')).toBeInTheDocument();
    expect(screen.getByText('2 to review')).toBeInTheDocument();
    // One per clean category, and no warning attached to them.
    expect(screen.getAllByText('All new')).toHaveLength(2);
  });
});

describe('ConflictSection', () => {
  it('says how much is left while a section is unfinished', () => {
    render(
      <ConflictSection title="Tags" icon={Tag} total={3} unresolved={2}>
        <li>a row</li>
      </ConflictSection>,
    );

    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
  });

  it('switches to completion once nothing is outstanding', () => {
    render(
      <ConflictSection title="People" icon={Users} total={3} unresolved={0}>
        <li>a row</li>
      </ConflictSection>,
    );

    // The count stops being "what is left" and becomes "what was done" — different number, and the
    // only signal on the page that one group is finished while others are not.
    expect(screen.getByText('3 resolved')).toBeInTheDocument();
    expect(screen.queryByText(/left/)).not.toBeInTheDocument();
  });

  it('starts closed, and opens onto a list so a screen reader gets the count', async () => {
    const user = userEvent.setup();
    render(
      <ConflictSection title="Tags" icon={Tag} total={2} unresolved={2}>
        <li>first</li>
        <li>second</li>
      </ConflictSection>,
    );

    // Closed is the whole point: the rows are the part of this screen worth not reading, and the
    // heading plus the section buttons are enough to act on without them.
    expect(screen.queryByText('first')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tags/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('carries the row buttons at section level, and shows which one the section is on', () => {
    const applied: string[] = [];
    render(
      <ConflictSection
        title="Tags"
        icon={Tag}
        total={2}
        unresolved={0}
        bulk={[
          { key: 'merge', label: 'Merge', icon: Merge, selected: true, onApply: () => {} },
          {
            key: 'create',
            label: 'Keep both',
            icon: UserPlus,
            selected: false,
            onApply: () => applied.push('create'),
          },
        ]}
      >
        <li>a row</li>
      </ConflictSection>,
    );

    expect(screen.getByText('Set all')).toBeInTheDocument();
    // Reachable without opening the section — answering every row at once is what it is for.
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    expect(applied).toEqual(['create']);
  });
});

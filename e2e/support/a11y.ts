import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { Result } from 'axe-core';

/* axe, wired to say something a person can act on.
 *
 * Two things this file exists to decide, neither of which belongs in a spec:
 *
 * *Which rules count.* axe ships far more than WCAG — `best-practice` covers house style (heading
 * order, landmark uniqueness, "region": every node inside a landmark) which is worth reading but is
 * not a defect, and failing a release on it is how a check becomes something people learn to skip.
 * So the gate is WCAG 2.0/2.1 level A and AA, the conformance target this app claims, and nothing
 * else.
 *
 * *What a failure looks like.* An axe violation is a deep object with every failing node's HTML
 * inline; printed raw it buries the rule id under a screenful of markup. `report()` flattens the
 * findings into the four things needed to fix one — which screen, which rule, which element, and
 * why — and the specs attach the untouched JSON to the Playwright report alongside it for anyone
 * who wants the rest.
 */

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Rules turned off, each with the reason it is off.
 *
 * A map rather than a list so a suppression cannot be added without writing down why — an unexplained
 * rule id in this file is indistinguishable from a bug someone hid. Empty is the goal.
 */
const SUPPRESSED: Record<string, string> = {};

/** One screen's worth of findings. `where` is what the failure message leads with. */
export interface Finding {
  where: string;
  violations: Result[];
}

/**
 * Wait until the DOM stops changing.
 *
 * Not defensive padding — without it this scan is measurably non-deterministic, and that was found
 * the hard way: consecutive runs disagreed about whether `/settings` had a contrast failure and
 * whether `/diary` had a prohibited-attribute one. Waiting on the page's `proof` locator is
 * necessary but not sufficient, because it answers "has this route mounted", and several screens
 * keep filling in afterwards — the settings page resolves `navigator.storage.estimate()`, the diary
 * page paints its rows once the Dexie query returns. axe reads the DOM at one instant, so whether it
 * saw those depended on the runner's mood.
 *
 * A mutation-quiet window rather than `networkidle`: none of the late content here is waiting on the
 * network — it is IndexedDB and a browser API, which `networkidle` cannot see.
 */
async function settle(page: Page, quietMs = 300, timeoutMs = 5_000): Promise<void> {
  await page.evaluate(
    ([quiet, limit]) =>
      new Promise<void>((resolve) => {
        let timer = setTimeout(done, quiet);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, quiet);
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        // The ceiling matters: an app with a permanent animation or a polling timer would otherwise
        // never go quiet and the scan would hang rather than fail.
        const ceiling = setTimeout(done, limit);

        function done() {
          clearTimeout(timer);
          clearTimeout(ceiling);
          observer.disconnect();
          resolve();
        }
      }),
    [quietMs, timeoutMs] as const,
  );
}

/**
 * Scan whatever is currently on screen.
 *
 * Takes no locator to wait on by design — the caller has already waited for the page's own content
 * (see `support/routes.ts`), because axe measures the DOM at the instant it runs and a Suspense
 * spinner passes everything. What this does add is `settle()`, for the content that arrives after
 * that.
 *
 * `exclude` takes CSS selectors for subtrees to leave out. Nothing needs it today; it is here so a
 * genuinely-third-party widget can be scoped out without disabling a rule globally, which would
 * blind the scan on the app's own markup too.
 */
export async function scan(page: Page, where: string, exclude: string[] = []): Promise<Finding> {
  await settle(page);

  let builder = new AxeBuilder({ page }).withTags(WCAG_AA);
  for (const selector of exclude) builder = builder.exclude(selector);

  const suppressed = Object.keys(SUPPRESSED);
  if (suppressed.length > 0) builder = builder.disableRules(suppressed);

  const { violations } = await builder.analyze();
  return { where, violations };
}

/**
 * The findings as a failure message, or `''` when there are none.
 *
 * Empty-string-means-clean so a spec can assert `expect(report(findings)).toBe('')` and have
 * Playwright print the whole report as the diff — every violation across every screen in one run,
 * rather than stopping at the first screen that has one.
 */
export function report(findings: Finding[]): string {
  const lines: string[] = [];

  for (const { where, violations } of findings) {
    for (const violation of violations) {
      lines.push(`${where} — ${violation.id} (${violation.impact ?? 'unknown'} impact)`);
      lines.push(`  ${violation.help}`);
      lines.push(`  ${violation.helpUrl}`);
      for (const node of violation.nodes) {
        lines.push(`  · ${node.target.join(' ')}`);
        /* axe's own one-line explanation of why *this* node failed — "Element has insufficient
           color contrast of 3.4:1", not the rule's generic description. Indented under the
           selector because a rule can fail several nodes for different reasons. */
        for (const detail of (node.failureSummary ?? '').split('\n').filter(Boolean)) {
          lines.push(`      ${detail.trim()}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

/** The raw results, for attaching to the Playwright report. */
export const asJson = (findings: Finding[]): string => JSON.stringify(findings, null, 2);

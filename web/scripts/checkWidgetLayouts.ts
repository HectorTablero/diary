import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Refuses a widget layout that uses a view RemoteViews cannot inflate.
 *
 * ## The failure this exists to catch
 *
 * `RemoteViews.apply` inflates with a `LayoutInflater.Filter` whose entire implementation is
 * `clazz.isAnnotationPresent(RemoteView.class)`. Only a fixed set of framework classes carry that
 * annotation. Anything else throws `InflateException`, and the launcher's response is to replace the
 * whole widget with "Can't load widget" — no partial render, no clue which element did it.
 *
 * Nothing else catches this. `aapt2` links the layout happily, the APK builds, the provider compiles,
 * and the widget is dead on the home screen. The specific way it bit: a one-pixel `<View>` used as a
 * divider, which is the ordinary way to draw a rule everywhere else in Android and is not on the
 * list.
 *
 * ## Why a script rather than a lint rule
 *
 * Android Lint has no check for this, and the project builds with the gradle CLI rather than Studio
 * anyway. This runs beside checkI18n and checkBundle, which is where this codebase already keeps the
 * rules that no compiler enforces.
 */

const LAYOUTS = fileURLToPath(new URL('../android/app/src/main/res/layout', import.meta.url));

/**
 * Every class annotated `@RemoteView` in the platform, which is exactly what the inflater's filter
 * accepts.
 *
 * The three at the end arrived in API 31. They are listed because they are legal to *inflate* on
 * every level this app supports — `minSdkVersion 24` — while only being *interactive* from 31; an
 * older device renders a CheckBox as an ordinary unresponsive box rather than refusing the layout.
 */
const ALLOWED = new Set([
  // Layouts
  'AdapterViewFlipper',
  'FrameLayout',
  'GridLayout',
  'GridView',
  'LinearLayout',
  'ListView',
  'RelativeLayout',
  'StackView',
  'ViewFlipper',
  // Leaves
  'AnalogClock',
  'Button',
  'Chronometer',
  'ImageButton',
  'ImageView',
  'ProgressBar',
  'TextClock',
  'TextView',
  'ViewStub',
  // API 31+
  'CheckBox',
  'RadioButton',
  'RadioGroup',
  'Switch',
]);

/** Element names opened in a layout file, ignoring comments — where the offending `<View>` would
    otherwise have hidden, since these files carry a lot of prose. */
function elementsIn(xml: string): { name: string; line: number }[] {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
  const found: { name: string; line: number }[] = [];
  const pattern = /<([A-Za-z][\w.]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutComments))) {
    const name = match[1];
    if (name === 'xml' || name === 'merge') continue;
    found.push({ name, line: withoutComments.slice(0, match.index).split('\n').length });
  }
  return found;
}

const problems: string[] = [];

for (const file of readdirSync(LAYOUTS).filter((name) => name.startsWith('widget_'))) {
  const xml = readFileSync(`${LAYOUTS}/${file}`, 'utf8');
  for (const { name, line } of elementsIn(xml)) {
    // A fully-qualified custom view is as fatal as a bare one, and just as silent.
    const simple = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    if (!ALLOWED.has(simple)) {
      problems.push(
        `  ${file}:${line}  <${name}> is not annotated @RemoteView — RemoteViews.apply will throw ` +
          `InflateException and the launcher will show "Can't load widget".`,
      );
    }
  }
}

if (problems.length) {
  console.error('widget layouts use views RemoteViews cannot inflate:\n');
  console.error(problems.join('\n'));
  console.error(
    '\nUse one of: ' +
      [...ALLOWED].sort().join(', ') +
      '\n(An empty LinearLayout draws the same pixels as a <View> and is allowed.)',
  );
  process.exit(1);
}

console.log(
  `widget layouts ok — every element across ${
    readdirSync(LAYOUTS).filter((name) => name.startsWith('widget_')).length
  } layout(s) is inflatable by RemoteViews.`,
);

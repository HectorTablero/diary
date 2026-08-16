#!/usr/bin/env tsx
/**
 * Asset generation script for Android adaptive icons and splash screens.
 *
 * Run from web/: npx tsx scripts/generateAssets.ts
 *
 * This regenerates all Android mipmap densities from the source SVG,
 * properly scaled to fill the adaptive icon canvas (no inset needed).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  APP_LOGO_PATHS,
  BRAND_LOGO_PATHS,
  LOGO_STROKE_WIDTH,
  NOTIFICATION_ICON_LOGO,
} from '@diary/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SILENT =
  process.argv.includes('--silent') ||
  process.env.npm_config_silent === 'true' ||
  process.env.npm_config_loglevel === 'silent';

const SVG_SOURCE = path.resolve(__dirname, '../public/icons/favicon-displaced.svg');
const ANDROID_RES = path.resolve(__dirname, '../android/app/src/main/res');
const WEB_PUBLIC = path.resolve(__dirname, '../public/icons');

/** Android adaptive icon foreground densities (108dp base). */
const ADAPTIVE_DENSITIES: Record<string, number> = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

/** Legacy launcher icon densities (48dp base). */
const LEGACY_DENSITIES: Record<string, number> = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

/** Splash screen densities (various sizes for different orientations/modes). */
const SPLASH_DENSITIES: Record<string, { w: number; h: number }> = {
  'drawable-land-hdpi': { w: 640, h: 384 },
  'drawable-land-mdpi': { w: 480, h: 288 },
  'drawable-land-xhdpi': { w: 960, h: 576 },
  'drawable-land-xxhdpi': { w: 1440, h: 864 },
  'drawable-land-xxxhdpi': { w: 1920, h: 1152 },
  'drawable-port-hdpi': { w: 384, h: 640 },
  'drawable-port-mdpi': { w: 288, h: 480 },
  'drawable-port-xhdpi': { w: 576, h: 960 },
  'drawable-port-xxhdpi': { w: 864, h: 1440 },
  'drawable-port-xxxhdpi': { w: 1152, h: 1920 },
  'drawable-land-night-hdpi': { w: 640, h: 384 },
  'drawable-land-night-mdpi': { w: 480, h: 288 },
  'drawable-land-night-xhdpi': { w: 960, h: 576 },
  'drawable-land-night-xxhdpi': { w: 1440, h: 864 },
  'drawable-land-night-xxxhdpi': { w: 1920, h: 1152 },
  'drawable-port-night-hdpi': { w: 384, h: 640 },
  'drawable-port-night-mdpi': { w: 288, h: 480 },
  'drawable-port-night-xhdpi': { w: 576, h: 960 },
  'drawable-port-night-xxhdpi': { w: 864, h: 1440 },
  'drawable-port-night-xxxhdpi': { w: 1152, h: 1920 },
  'drawable-night': { w: 576, h: 960 },
};

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;
const DARK_BG = { r: 24, g: 24, b: 27, alpha: 1 } as const; // #18181b

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

function log(...args: unknown[]): void {
  if (!SILENT) console.log(...args);
}

async function generateAdaptiveForegrounds(): Promise<void> {
  log('\n🎨 Generating adaptive icon foregrounds...');

  for (const [folder, size] of Object.entries(ADAPTIVE_DENSITIES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    const outPath = path.join(outDir, 'ic_launcher_foreground.png');

    await sharp(SVG_SOURCE)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toFile(outPath);

    log(`  ✓ ${folder}: ${size}×${size}`);
  }
}

async function generateAdaptiveBackgrounds(color = WHITE): Promise<void> {
  log('\n🎨 Generating adaptive icon backgrounds...');

  for (const [folder, size] of Object.entries(ADAPTIVE_DENSITIES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    const outPath = path.join(outDir, 'ic_launcher_background.png');

    await sharp({
      create: { width: size, height: size, channels: 4, background: color },
    })
      .png()
      .toFile(outPath);

    log(`  ✓ ${folder}: ${size}×${size}`);
  }
}

async function generateLegacyIcons(): Promise<void> {
  log('\n📱 Generating legacy launcher icons...');

  for (const [folder, size] of Object.entries(LEGACY_DENSITIES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    const outPath = path.join(outDir, 'ic_launcher.png');

    await sharp(SVG_SOURCE)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toFile(outPath);

    log(`  ✓ ${folder}: ${size}×${size}`);
  }
}

async function generateRoundIcons(): Promise<void> {
  log('\n🔘 Generating round launcher icons...');

  for (const [folder, size] of Object.entries(LEGACY_DENSITIES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);
    const outPath = path.join(outDir, 'ic_launcher_round.png');

    await sharp(SVG_SOURCE)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toFile(outPath);

    log(`  ✓ ${folder}: ${size}×${size}`);
  }
}

async function generateSplashScreens(): Promise<void> {
  log('\n💦 Generating splash screens...');

  const splashSource = path.resolve(__dirname, '../assets/splash.svg');
  const splashDarkSource = path.resolve(__dirname, '../assets/splash-dark.svg');

  const hasLight = fs.existsSync(splashSource);
  const hasDark = fs.existsSync(splashDarkSource);

  if (!hasLight && !hasDark) {
    log('  (No splash.svg or splash-dark.svg found in assets/, skipping)');
    return;
  }

  for (const [folder, { w, h }] of Object.entries(SPLASH_DENSITIES)) {
    const outDir = path.join(ANDROID_RES, folder);
    await ensureDir(outDir);

    const isNight = folder.includes('night');
    const source = isNight && hasDark ? splashDarkSource : splashSource;

    if (!fs.existsSync(source)) continue;

    const outPath = path.join(outDir, 'splash.png');

    await sharp(source).resize(w, h, { fit: 'cover', position: 'center' }).png().toFile(outPath);

    log(`  ✓ ${folder}: ${w}×${h}`);
  }
}

async function generateWebIcons(): Promise<void> {
  log('\n🌐 Generating web/PWA icons...');

  await ensureDir(WEB_PUBLIC);

  await sharp(SVG_SOURCE)
    .resize(192, 192, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(WEB_PUBLIC, 'icon-192.png'));
  log('  ✓ icon-192.png');

  await sharp(SVG_SOURCE)
    .resize(512, 512, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(WEB_PUBLIC, 'icon-512.png'));
  log('  ✓ icon-512.png');

  await sharp(SVG_SOURCE)
    .resize(384, 384, { fit: 'contain', background: TRANSPARENT })
    .extend({ top: 64, bottom: 64, left: 64, right: 64, background: TRANSPARENT })
    .png()
    .toFile(path.join(WEB_PUBLIC, 'icon-512-maskable.png'));
  log('  ✓ icon-512-maskable.png');
}

async function generateStoreAsset(): Promise<void> {
  log('\n🏪 Generating store asset...');

  const outDir = path.resolve(__dirname, '../assets');
  await ensureDir(outDir);

  await sharp(SVG_SOURCE)
    .resize(1024, 1024, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(outDir, 'store-1024x1024.png'));
  log('  ✓ store-1024x1024.png (for Google Play Console)');
}

/**
 * One of the shared logos as an Android VectorDrawable, on the same 500×500 viewport the SVGs use.
 *
 * Both callers below used to spell their paths out by hand, which meant the logo existed in a third
 * place that nothing kept in step with shared/src/constants.ts. Strokes rather than fills, matching
 * the SVG generator — `android:strokeWidth` is in viewport units, so LOGO_STROKE_WIDTH carries over
 * unchanged.
 */
function logoVectorDrawable({
  paths,
  color,
  sizeDp,
  scale,
  comment,
}: {
  paths: readonly { d: string }[];
  color: string;
  sizeDp: number;
  scale?: number;
  comment: string;
}): string {
  const indent = scale ? '        ' : '    ';
  const drawnPaths = paths
    .map((logoPath) =>
      [
        `${indent}<path`,
        `${indent}    android:fillColor="#00000000"`,
        `${indent}    android:strokeColor="${color}"`,
        `${indent}    android:strokeWidth="${LOGO_STROKE_WIDTH}"`,
        `${indent}    android:strokeLineCap="round"`,
        `${indent}    android:strokeLineJoin="round"`,
        `${indent}    android:pathData="${logoPath.d}" />`,
      ].join('\n'),
    )
    .join('\n');

  const body = scale
    ? [
        '    <group',
        '        android:pivotX="250"',
        '        android:pivotY="250"',
        `        android:scaleX="${scale}"`,
        `        android:scaleY="${scale}">`,
        drawnPaths,
        '    </group>',
      ].join('\n')
    : drawnPaths;

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- Generated by web/scripts/generateAssets.ts — do not edit.`,
    `     ${comment} -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${sizeDp}dp"`,
    `    android:height="${sizeDp}dp"`,
    '    android:viewportWidth="500"',
    '    android:viewportHeight="500">',
    body,
    '</vector>',
  ].join('\n');
}

async function generateSplashIcon(): Promise<void> {
  log('\n🎨 Generating Android SplashScreen icon...');

  const outDir = path.join(ANDROID_RES, 'drawable');
  await ensureDir(outDir);
  const outPath = path.join(outDir, 'ic_splash.xml');

  // Android 12+ SplashScreen API: 288×288 dp canvas, outer 1/3 masked,
  // visible content must fit inside a 192 dp diameter circle.
  // Our 500×500 viewBox maps to 288 dp, so the visible circle is ~333 units.
  // The logo's natural width is ~400 units — too big. We scale to 42.5%
  // so the scaled logo sits comfortably in the circle.
  await fs.promises.writeFile(
    outPath,
    logoVectorDrawable({
      paths: BRAND_LOGO_PATHS,
      color: '#0072FF',
      sizeDp: 288,
      scale: 0.425,
      comment: 'Android 12+ splash icon: the brand mark, inset to clear the circular mask.',
    }) + '\n',
    'utf-8',
  );
  log('  ✓ drawable/ic_splash.xml');
}

/**
 * The status-bar / notification icon named by `smallIcon` in web/capacitor.config.ts.
 *
 * White because Android keeps only the alpha channel of this drawable and tints the silhouette
 * itself (the tint is `iconColor`, in the same config) — so the colour here just has to be opaque.
 *
 * Which logo it draws is `NOTIFICATION_ICON_LOGO` in shared/src/constants.ts. Note that being
 * referenced by *name* from a config file rather than from code or a layout is also why
 * android/app/src/main/res/raw/keep.xml has to exist: the release build's resource shrinker cannot
 * see a reference that only exists as a string in an asset, and stripping this drawable is not a
 * build failure — Capacitor quietly falls back to android.R.drawable.ic_dialog_info, the ⓘ.
 */
async function generateNotificationIcon(): Promise<void> {
  log('\n🔔 Generating notification icon...');

  const outDir = path.join(ANDROID_RES, 'drawable');
  await ensureDir(outDir);
  const outPath = path.join(outDir, 'ic_stat_notify.xml');

  const brand = NOTIFICATION_ICON_LOGO === 'brand';
  await fs.promises.writeFile(
    outPath,
    logoVectorDrawable({
      paths: brand ? BRAND_LOGO_PATHS : APP_LOGO_PATHS,
      color: '#FFFFFF',
      sizeDp: 24,
      comment: `Status-bar notification icon: the ${brand ? 'brand (tab) mark' : 'app (diary) mark'}, per NOTIFICATION_ICON_LOGO.`,
    }) + '\n',
    'utf-8',
  );
  log(`  ✓ drawable/ic_stat_notify.xml (${brand ? 'brand/tab' : 'app/diary'} logo)`);
}

async function main(): Promise<void> {
  log('═══════════════════════════════════════════════');
  log('  Diary Asset Generator');
  log('═══════════════════════════════════════════════');

  if (!fs.existsSync(SVG_SOURCE)) {
    console.error(`\n❌ Source SVG not found: ${SVG_SOURCE}`);
    console.error('   Create it first with the logo filling ~90% of the 500×500 canvas.');
    process.exit(1);
  }

  await generateAdaptiveForegrounds();
  await generateAdaptiveBackgrounds();
  await generateLegacyIcons();
  await generateRoundIcons();
  //   await generateSplashScreens();
  await generateWebIcons();
  await generateStoreAsset();
  await generateSplashIcon();
  await generateNotificationIcon();
  log('\n═══════════════════════════════════════════════');
  log('  ✅ All assets generated!');
  log('═══════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

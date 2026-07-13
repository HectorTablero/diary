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
      .resize(size, size, { fit: 'contain', background: WHITE })
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
      .resize(size, size, { fit: 'contain', background: WHITE })
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

    await sharp(source)
      .resize(w, h, { fit: 'cover', position: 'center' })
      .png()
      .toFile(outPath);

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
    .resize(1024, 1024, { fit: 'contain', background: WHITE })
    .png()
    .toFile(path.join(outDir, 'store-1024x1024.png'));
  log('  ✓ store-1024x1024.png (for Google Play Console)');
}

async function generateSplashIcon(): Promise<void> {
  log('\n🎨 Generating Android SplashScreen icon...');

  const outDir = path.join(ANDROID_RES, 'drawable');
  await ensureDir(outDir);
  const outPath = path.join(outDir, 'ic_splash.xml');

  // Android 12+ SplashScreen API: 288×288 dp canvas, outer 1/3 masked,
  // visible content must fit inside a 192 dp diameter circle.
  // Our 500×500 viewBox maps to 288 dp, so the visible circle is ~333 units.
  // The logo's natural width is ~400 units — too big. We scale to 48%
  // so the scaled logo (~192 units wide) sits comfortably in the circle.
  const vectorDrawable = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="288dp"
    android:height="288dp"
    android:viewportWidth="500"
    android:viewportHeight="500">
    <group
        android:pivotX="250"
        android:pivotY="250"
        android:scaleX="0.425"
        android:scaleY="0.425">
        <path
            android:fillColor="#00000000"
            android:strokeColor="#0072FF"
            android:strokeWidth="50"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M 375 250 L 50 250" />
        <path
            android:fillColor="#00000000"
            android:strokeColor="#0072FF"
            android:strokeWidth="50"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M 300 125 L 375 250 L 300 375" />
        <path
            android:fillColor="#00000000"
            android:strokeColor="#0072FF"
            android:strokeWidth="50"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="M 450 100 L 450 400" />
    </group>
</vector>`;

  await fs.promises.writeFile(outPath, vectorDrawable.trim() + '\n', 'utf-8');
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
  log('\n═══════════════════════════════════════════════');
  log('  ✅ All assets generated!');
  log('═══════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
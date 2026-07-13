#!/usr/bin/env tsx
/**
 * Logo generation script for the SVG assets used by the app.
 *
 * Run from web/: npx tsx scripts/generateLogos.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_LOGO_PATHS,
  BRAND_LOGO_PATHS,
  LOGO_COLOR,
  LOGO_DISPLACED_VIEWBOX,
  LOGO_LOCAL_COLOR,
  LOGO_STROKE_WIDTH,
  LOGO_VIEWBOX,
} from '@diary/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_PUBLIC = path.resolve(__dirname, '../public');
const WEB_ICONS = path.resolve(__dirname, '../public/icons');
const WEB_ASSETS = path.resolve(__dirname, '../assets');
const SILENT =
  process.argv.includes('--silent') ||
  process.env.npm_config_silent === 'true' ||
  process.env.npm_config_loglevel === 'silent';

type LogoPath = { d: string };

function formatPath(pathConfig: LogoPath, color: string): string {
  return `    <path fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="${color}" stroke-width="${LOGO_STROKE_WIDTH}" d="${pathConfig.d}" />`;
}

function createSvg(viewBox: string, paths: readonly LogoPath[], color = LOGO_COLOR): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    '  <g fill="none">',
    ...paths.map((pathConfig) => formatPath(pathConfig, color)),
    '  </g>',
    '</svg>',
  ].join('\n');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function writeSvg(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${contents.trim()}\n`, 'utf-8');
}

function log(...args: unknown[]): void {
  if (!SILENT) console.log(...args);
}

async function main(): Promise<void> {
  log('═══════════════════════════════════════════════');
  log('  Diary Logo Generator');
  log('═══════════════════════════════════════════════');

  await writeSvg(path.join(WEB_ASSETS, 'splash-base.svg'), createSvg(LOGO_VIEWBOX, BRAND_LOGO_PATHS));
  log('  ✓ assets/splash-base.svg');

  await writeSvg(path.join(WEB_PUBLIC, 'favicon.svg'), createSvg(LOGO_VIEWBOX, APP_LOGO_PATHS));
  log('  ✓ public/favicon.svg');

  const localFavicon = createSvg(LOGO_VIEWBOX, APP_LOGO_PATHS, LOGO_LOCAL_COLOR);
  await writeSvg(path.join(WEB_PUBLIC, 'favicon-local.svg'), localFavicon);
  log('  ✓ public/favicon-local.svg');

  await writeSvg(
    path.join(WEB_ICONS, 'favicon-displaced.svg'),
    createSvg(LOGO_DISPLACED_VIEWBOX, APP_LOGO_PATHS),
  );
  log('  ✓ public/icons/favicon-displaced.svg');

  log('═══════════════════════════════════════════════');
  log('  ✅ Logo assets generated!');
  log('═══════════════════════════════════════════════');
}

main().catch((err: unknown) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
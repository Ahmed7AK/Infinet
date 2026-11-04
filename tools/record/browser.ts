/** Launch Playwright's Chromium, or one already in the Playwright cache (no download, works offline). */
import { chromium, type Browser } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
function cachedChromium(): string | undefined {
  const dir = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(dir, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
export const launch = (): Promise<Browser> => chromium.launch({ args }).catch(() => chromium.launch({ args, executablePath: cachedChromium() }));

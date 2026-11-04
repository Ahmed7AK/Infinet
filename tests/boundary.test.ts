import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Plan rule 3: the engine imports cleanly in Node with no DOM, and never imports three/react.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
}
describe('engine boundary', () => {
  it('imports in Node without a DOM', async () => {
    expect(typeof (globalThis as any).window).toBe('undefined');
    const mod = await import('../src/engine/index');
    expect(typeof mod.createSim).toBe('function');
  });
  it('no engine file imports three/react/zustand or the app', () => {
    for (const f of files('src/engine')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](three|react|react-dom|zustand|@react-three\/[^'"]+)['"]/);
      expect(src, f).not.toMatch(/from ['"][^'"]*\/app\//);
    }
  });
});

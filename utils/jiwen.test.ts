import { describe, expect, it } from 'vitest';
import { createJiwen } from './jiwen';

describe('jiwen', () => {
  it('does not contact before the connection threshold', async () => {
    const engine = createJiwen({ rates: { connectionGrowth: 0.001 } });
    const triggers = await engine.tick(5);
    expect(triggers.some((item) => item.action === 'contact')).toBe(false);
  });

  it('eventually contacts when pride is low', async () => {
    const engine = createJiwen({
      initialState: { connection: 0.34, pride: 0 },
      rates: { connectionGrowth: 0.01 },
    });
    const triggers = await engine.tick(2);
    expect(triggers.some((item) => item.action === 'contact')).toBe(true);
  });

  it('can persist and restore state', async () => {
    let saved: any = null;
    const first = createJiwen({ onSave: (state) => { saved = state; } });
    await first.applyDelta({ valence: -0.4, connection: 0.2 });
    const second = createJiwen({ onLoad: () => saved });
    expect((await second.getState()).connection).toBeCloseTo(0.2);
    expect((await second.getState()).valence).toBeCloseTo(-0.4);
  });
});

/* Mock traffic repository: the shared snapshot repository over a synthetic snapshot, rebuilt once per calendar day. */
import { buildMockTrafficSnapshot } from '../../data/mock/traffic.ts';
import { trafficRepositoryFrom } from '../traffic.ts';
import type { TrafficRepository } from '../types.ts';

let cached: { day: string; repo: TrafficRepository } | null = null;
export function mockTrafficRepository(now = new Date()): TrafficRepository {
  const day = now.toISOString().slice(0, 10);
  if (!cached || cached.day !== day) {
    const snapshot = buildMockTrafficSnapshot(now);
    cached = { day, repo: trafficRepositoryFrom('mock', async () => snapshot) };
  }
  return cached.repo;
}

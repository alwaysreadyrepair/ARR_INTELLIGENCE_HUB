/* Mock SEO repository: the shared snapshot repository over a synthetic snapshot, rebuilt once per calendar day. */
import { buildMockSeoSnapshot } from '../../data/mock/seo.ts';
import { seoRepositoryFrom } from '../seo.ts';
import type { SeoRepository } from '../types.ts';

let cached: { day: string; repo: SeoRepository } | null = null;
export function mockSeoRepository(now = new Date()): SeoRepository {
  const day = now.toISOString().slice(0, 10);
  if (!cached || cached.day !== day) {
    const snapshot = buildMockSeoSnapshot(now);
    cached = { day, repo: seoRepositoryFrom('mock', async () => snapshot) };
  }
  return cached.repo;
}

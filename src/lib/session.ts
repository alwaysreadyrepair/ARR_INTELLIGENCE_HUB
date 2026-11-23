/* Who is signed in, and what a verified token must contain to count. Pure: the Supabase calls are in auth.ts. */
export const ROLES = ['viewer', 'analyst', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface HubUser {
  id: string;
  name: string;
  role: Role;
  /** True for the dev stub. The shell shows a banner while this is set. */
  stub: boolean;
}

/** Local `astro dev` only. The middleware never uses it in a built Worker. */
export const DEV_USER: HubUser = { id: 'dev', name: 'Dev session', role: 'admin', stub: true };

/** The user behind verified claims, or null when they have no Hub role. The role comes from `app_metadata`, which only
 *  a project admin can set; `user_metadata` is editable by the user and is never trusted. */
export function userFromClaims(claims: Record<string, unknown>): HubUser | null {
  const meta = claims.app_metadata as { hub_role?: unknown } | null | undefined;
  const role = ROLES.find((r) => r === meta?.hub_role);
  if (!role || typeof claims.sub !== 'string' || !claims.sub || claims.is_anonymous === true) return null;
  return { id: claims.sub, name: typeof claims.email === 'string' && claims.email ? claims.email : 'Hub user', role, stub: false };
}

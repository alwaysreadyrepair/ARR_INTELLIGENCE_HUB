/* v1 has NO production authentication. The middleware attaches this stub so the shell can show who is signed in,
 * and every page already reads the user from one place. Swap in Supabase Auth (see README) before this app is
 * deployed anywhere reachable. */
export interface HubUser {
  id: string;
  name: string;
  role: 'admin' | 'analyst' | 'viewer';
  /** True for the dev stub. The shell shows a banner while this is set. */
  stub: boolean;
}

export const DEV_USER: HubUser = { id: 'dev', name: 'Dev session', role: 'admin', stub: true };

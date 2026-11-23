import type { APIRoute } from 'astro';
/* Liveness for uptime monitors. Public, so it says nothing but "up". */
export const GET: APIRoute = () => Response.json({ ok: true });

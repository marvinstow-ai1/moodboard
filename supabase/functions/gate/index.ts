// ============================================================
// Edge Function "gate" – Zugriffskontrolle für Marvin's Place
// ------------------------------------------------------------
// Läuft serverseitig mit Service Role; der Client sieht davon
// nichts außer den drei Aktionen:
//
//   request – { action:'request', email, name }
//             legt eine Zugriffs-Anfrage an (Status: pending).
//   login   – { action:'login', email, name }
//             prüft E-Mail + Name gegen die Freigabeliste und gibt
//             bei Erfolg eine fertige Session zurück (kein Passwort:
//             der Token wird hier serverseitig per generateLink +
//             verifyOtp erzeugt und nie per Mail verschickt).
//   decide  – { action:'decide', id, decision:'approve'|'block'|'unblock' }
//             nur für den Owner (JWT-Check): legt beim Freigeben den
//             Auth-User an, beim Sperren wird er zusätzlich gebannt,
//             sodass auch bestehende Sessions nicht verlängert werden.
//
// Repo-Kopie – deployed auf dem Supabase-Projekt als Funktion "gate".
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Namen tolerant vergleichen: Groß/Kleinschreibung und doppelte
// Leerzeichen egal – "max müller" == "Max  Müller".
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ');
const foldName = (s: unknown) => norm(s).toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseIdentity(body: Record<string, unknown>) {
  const email = norm(body.email).toLowerCase();
  const name = norm(body.name);
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  if (name.length < 2 || name.length > 64) return null;
  return { email, name };
}

// Auth-User zur Anfrage sicherstellen (angelegt ohne Passwort; einloggen
// kann er sich ausschließlich über diese Funktion). Gibt die User-Id zurück.
async function ensureUser(row: { id: string; email: string; name: string; user_id: string | null }) {
  if (row.user_id) return row.user_id;
  const { data, error } = await admin.auth.admin.createUser({
    email: row.email,
    email_confirm: true,
    app_metadata: { role: 'friend' },
    user_metadata: { name: row.name },
  });
  let userId = data?.user?.id ?? null;
  if (error && !userId) {
    // E-Mail existiert bereits als Auth-User (z. B. nach manuellem Anlegen):
    // per Liste wiederfinden. Die Nutzerzahl ist klein (Freundeskreis).
    for (let page = 1; page <= 10 && !userId; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      userId = list?.users?.find((u) => (u.email || '').toLowerCase() === row.email)?.id ?? null;
      if (!list || list.users.length < 200) break;
    }
    if (!userId) throw error;
  }
  await admin.from('access_requests').update({ user_id: userId }).eq('id', row.id);
  return userId!;
}

async function findByEmail(email: string) {
  const { data, error } = await admin
    .from('access_requests')
    .select('id,email,name,status,user_id')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Anfrage stellen ──────────────────────────────────────────
async function handleRequest(body: Record<string, unknown>) {
  const id = parseIdentity(body);
  if (!id) return json({ error: 'invalid_input' }, 400);
  const existing = await findByEmail(id.email);
  if (existing) {
    // Solange die Anfrage offen ist, darf ein Tippfehler im Namen
    // noch korrigiert werden; danach bleibt der Name fix.
    if (existing.status === 'pending' && existing.name !== id.name) {
      await admin.from('access_requests').update({ name: id.name }).eq('id', existing.id);
    }
    return json({ status: existing.status, existing: true });
  }
  // Simple Flutschutz-Bremse: nicht unendlich viele offene Anfragen.
  const { count } = await admin
    .from('access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if ((count ?? 0) >= 500) return json({ error: 'too_many_requests' }, 429);
  const { error } = await admin.from('access_requests').insert({ email: id.email, name: id.name });
  if (error) throw error;
  return json({ status: 'pending', created: true });
}

// ── Login (E-Mail + Name) ────────────────────────────────────
async function handleLogin(body: Record<string, unknown>) {
  const id = parseIdentity(body);
  if (!id) return json({ error: 'invalid_input' }, 400);
  const row = await findByEmail(id.email);
  if (!row) return json({ status: 'unknown' });
  if (row.status === 'pending') return json({ status: 'pending' });
  if (row.status === 'blocked') return json({ status: 'blocked' });
  if (foldName(row.name) !== foldName(id.name)) return json({ status: 'name_mismatch' });

  const userId = await ensureUser(row);
  // Session serverseitig erzeugen: Magic-Link-Token generieren (es wird
  // KEINE E-Mail verschickt) und sofort selbst einlösen.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: row.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) throw linkErr ?? new Error('no token');
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: otpErr } = await anon.auth.verifyOtp({
    type: 'email',
    token_hash: tokenHash,
  });
  if (otpErr || !verified?.session) throw otpErr ?? new Error('no session');
  return json({
    status: 'ok',
    userId,
    session: {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    },
  });
}

// ── Owner-Entscheidung ───────────────────────────────────────
async function handleDecide(req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (caller?.user?.app_metadata?.role !== 'owner') return json({ error: 'forbidden' }, 403);

  const reqId = String(body.id ?? '');
  const decision = String(body.decision ?? '');
  if (!reqId || !['approve', 'block', 'unblock'].includes(decision)) {
    return json({ error: 'invalid_input' }, 400);
  }
  const { data: row, error } = await admin
    .from('access_requests')
    .select('id,email,name,status,user_id')
    .eq('id', reqId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return json({ error: 'not_found' }, 404);

  if (decision === 'approve' || decision === 'unblock') {
    const userId = await ensureUser(row);
    // Falls vorher gesperrt: Bann aufheben.
    await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    await admin.from('access_requests')
      .update({ status: 'approved', decided_at: new Date().toISOString(), user_id: userId })
      .eq('id', row.id);
    return json({ ok: true, status: 'approved' });
  }

  // block: Status setzen + Auth-User bannen, damit auch eine bereits
  // bestehende Session nicht mehr verlängert wird. Lesezugriffe sind
  // durch gate_ok() ohnehin sofort dicht.
  await admin.from('access_requests')
    .update({ status: 'blocked', decided_at: new Date().toISOString() })
    .eq('id', row.id);
  if (row.user_id) {
    await admin.auth.admin.updateUserById(row.user_id, { ban_duration: '87660h' });
  }
  return json({ ok: true, status: 'blocked' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  try {
    switch (body.action) {
      case 'request': return await handleRequest(body);
      case 'login':   return await handleLogin(body);
      case 'decide':  return await handleDecide(req, body);
      default:        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error('gate error', e);
    return json({ error: 'internal' }, 500);
  }
});

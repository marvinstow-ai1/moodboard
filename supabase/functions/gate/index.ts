// ============================================================
// Edge Function "gate" – Zugriffskontrolle für Marvin's Place
// ------------------------------------------------------------
// Läuft serverseitig mit Service Role. Zugang gibt es nur noch für Nutzer,
// die der Owner selbst anlegt (Name + Passwort) – Selbst-Anfragen sind aus.
//
//   login   – { action:'login', name, password }
//             sucht den freigegebenen Nutzer zum Namen und meldet ihn
//             serverseitig mit seinem Passwort an; gibt bei Erfolg eine
//             fertige Session zurück. Die (interne) E-Mail des Auth-Users
//             verlässt den Server nie.
//   create  – { action:'create', name, password }   (nur Owner)
//             legt Auth-User (Rolle 'friend') + freigegebenen
//             access_requests-Eintrag an.
//   decide  – { action:'decide', id, decision:'block'|'unblock'|'approve' }
//             nur für den Owner (JWT-Check): sperrt (inkl. Bann, sodass
//             bestehende Sessions nicht verlängert werden) oder entsperrt.
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

// Interne Login-E-Mail für Nutzer ohne echte E-Mail. Wird nie verschickt
// (Nutzer werden bestätigt angelegt) und nie an den Client gegeben.
function internalEmail(name: string) {
  const slug = foldName(name).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
  return `${slug}-${crypto.randomUUID().slice(0, 8)}@nutzer.marvins-place.example.com`;
}

async function requireOwner(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  return caller?.user?.app_metadata?.role === 'owner';
}

async function findByName(name: string) {
  const { data, error } = await admin
    .from('access_requests')
    .select('id,email,name,status,user_id')
    .ilike('name', name.replace(/[\\%_]/g, (c) => '\\' + c));
  if (error) throw error;
  return (data || []).filter((r) => foldName(r.name) === foldName(name));
}

// ── Login (Name + Passwort) ──────────────────────────────────
async function handleLogin(body: Record<string, unknown>) {
  const name = norm(body.name);
  const password = String(body.password ?? '');
  if (name.length < 2 || name.length > 64 || !password || password.length > 128) {
    return json({ status: 'invalid' });
  }
  // Bewusst immer dieselbe Antwort, egal ob Name unbekannt, gesperrt oder
  // Passwort falsch – sonst ließen sich gültige Namen durchprobieren.
  const row = (await findByName(name)).find((r) => r.status === 'approved' && r.user_id);
  if (!row) return json({ status: 'invalid' });
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email: row.email, password });
  if (error || !data?.session) return json({ status: 'invalid' });
  return json({
    status: 'ok',
    userId: row.user_id,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}

// ── Nutzer anlegen (nur Owner) ───────────────────────────────
async function handleCreate(req: Request, body: Record<string, unknown>) {
  if (!(await requireOwner(req))) return json({ error: 'forbidden' }, 403);
  const name = norm(body.name);
  const password = String(body.password ?? '');
  if (name.length < 2 || name.length > 64) return json({ error: 'invalid_name' }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: 'invalid_password' }, 400);
  if ((await findByName(name)).length) return json({ error: 'name_taken' }, 409);

  const email = internalEmail(name);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'friend' },
    user_metadata: { name },
  });
  if (error || !data?.user) throw error ?? new Error('create failed');
  const { error: insErr } = await admin.from('access_requests').insert({
    email, name, status: 'approved', user_id: data.user.id, decided_at: new Date().toISOString(),
  });
  if (insErr) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw insErr;
  }
  return json({ ok: true, name });
}

// ── Owner-Entscheidung ───────────────────────────────────────
async function handleDecide(req: Request, body: Record<string, unknown>) {
  if (!(await requireOwner(req))) return json({ error: 'forbidden' }, 403);

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
    // Nutzer entstehen nur noch über 'create' – ohne Auth-User nichts zu tun.
    if (!row.user_id) return json({ error: 'no_user' }, 409);
    const userId = row.user_id;
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
      case 'login':   return await handleLogin(body);
      case 'create':  return await handleCreate(req, body);
      case 'decide':  return await handleDecide(req, body);
      default:        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error('gate error', e);
    return json({ error: 'internal' }, 500);
  }
});

// Edge Function: приглашение нового врача из админ-панели.
// Проверяет, что вызывающий — админ, затем через service role создаёт
// пользователя и шлёт invite-письмо от Supabase Auth.
// Deploy: supabase functions deploy admin-invite

import { createClient } from "npm:@supabase/supabase-js@2";

// Куда ведёт ссылка из письма-приглашения, если переменная PORTAL_URL не задана.
const PORTAL_URL_FALLBACK = "https://nnnnshsjsjsj.github.io/mediogram-portal/";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: "not authenticated" }, 401, cors);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "admin only" }, 403, cors);

    const { email, full_name, group_id } = await req.json();
    if (!email?.includes("@")) return json({ error: "bad email" }, 400, cors);

    const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name ?? "" },
      redirectTo: Deno.env.get("PORTAL_URL") ?? PORTAL_URL_FALLBACK,
    });
    if (error) return json({ error: error.message }, 400, cors);

    // Профиль создаёт триггер on_auth_user_created; здесь только группа.
    let group_error: string | null = null;
    if (group_id && data.user?.id) {
      const { error: gErr } = await svc
        .from("group_members")
        .upsert({ group_id, user_id: data.user.id });
      if (gErr) group_error = gErr.message;
    }

    return json({ ok: true, user_id: data.user?.id, group_error }, 200, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

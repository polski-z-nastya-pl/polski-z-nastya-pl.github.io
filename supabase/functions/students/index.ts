import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./logic.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error || r.data == null) throw new Error(r.error?.message ?? "empty result");
  return r.data;
};

const deps = {
  async getCaller(bearer: string) {
    const { data } = await admin.auth.getUser(bearer);
    return data.user?.id ?? null;
  },
  async isTeacher(userId: string) {
    const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    return data?.role === "teacher";
  },
  async createStudent(name: string) {
    const r = await admin.auth.admin.createUser({
      email: `${crypto.randomUUID()}@students.example.com`, // писем на этот адрес не отправляется
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    return must(r).user.id;
  },
  async newInvite(userId: string) {
    await admin.from("student_invites").delete().eq("user_id", userId);
    return must(await admin.from("student_invites").insert({ user_id: userId }).select("token").single()).token as string;
  },
  async userByToken(token: string) {
    const { data } = await admin.from("student_invites").select("user_id").eq("token", token).maybeSingle();
    return data?.user_id ?? null;
  },
  async setPassword(userId: string, password: string) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new Error(error.message);
  },
  async addStudent(email: string, name: string, password: string) {
    await admin.from("allowed_emails").upsert({ email, name });
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (r.error) {
      if (/already|registered|exists/i.test(r.error.message)) return null;
      throw new Error(r.error.message);
    }
    return r.data.user.id;
  },
  async tokenHashFor(userId: string) {
    const email = must(await admin.auth.admin.getUserById(userId)).user.email!;
    const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
    return must(r).properties.hashed_token as string;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  try {
    const body = await req.json().catch(() => ({}));
    const auth = req.headers.get("Authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const res = await handle(body, bearer, deps);
    return json(res.status, res.body);
  } catch (e) {
    console.error(e);
    return json(500, { error: "Внутренняя ошибка" });
  }
});

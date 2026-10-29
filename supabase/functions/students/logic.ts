// Логика функции «students»: приглашение учеников по личной ссылке и вход по ней.
// Зависимости передаются снаружи, чтобы логику можно было проверить без Supabase.
export type Deps = {
  getCaller(bearer: string): Promise<string | null>; // id пользователя по JWT
  isTeacher(userId: string): Promise<boolean>;
  createStudent(name: string): Promise<string>; // id нового пользователя
  newInvite(userId: string): Promise<string>; // заменяет старые ссылки, возвращает token
  userByToken(token: string): Promise<string | null>;
  tokenHashFor(userId: string): Promise<string>; // одноразовый хэш для verifyOtp
  setPassword(userId: string, password: string): Promise<void>;
  addStudent(email: string, name: string, password: string): Promise<string | null>; // null — такой email уже есть
};

export type Req = { action?: string; token?: string; name?: string; user_id?: string; email?: string };
export type Res = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // без похожих символов (l, 1, o, 0, i)
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const randomPassword = (n = 8) => {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
};
const err = (status: number, error: string): Res => ({ status, body: { error } });

export async function handle(req: Req, bearer: string | null, d: Deps): Promise<Res> {
  if (req.action === "claim") {
    if (!req.token || !UUID.test(req.token)) return err(404, "Ссылка недействительна");
    const userId = await d.userByToken(req.token);
    if (!userId) return err(404, "Ссылка недействительна");
    return { status: 200, body: { token_hash: await d.tokenHashFor(userId) } };
  }

  if (req.action === "invite" || req.action === "regenerate" || req.action === "set_password" || req.action === "add_student") {
    const caller = bearer ? await d.getCaller(bearer) : null;
    if (!caller) return err(401, "Нужно войти");
    if (!(await d.isTeacher(caller))) return err(403, "Только для учителя");

    if (req.action === "add_student") {
      const email = (req.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 120) return err(400, "Проверьте email");
      const name = (req.name ?? "").trim().slice(0, 60) || email.split("@")[0];
      const password = randomPassword(10);
      const userId = await d.addStudent(email, name, password);
      if (!userId) return err(409, "Ученик с таким email уже есть");
      return { status: 200, body: { user_id: userId, email, name, password } };
    }

    if (req.action === "invite") {
      const name = (req.name ?? "").trim();
      if (!name || name.length > 60) return err(400, "Укажите имя ученика (до 60 символов)");
      const userId = await d.createStudent(name);
      return { status: 200, body: { user_id: userId, token: await d.newInvite(userId) } };
    }

    if (!req.user_id || !UUID.test(req.user_id)) return err(400, "Не указан ученик");
    if (await d.isTeacher(req.user_id)) return err(400, "Для учителя это действие недоступно");
    if (req.action === "set_password") {
      const password = randomPassword();
      await d.setPassword(req.user_id, password);
      return { status: 200, body: { password } };
    }
    return { status: 200, body: { user_id: req.user_id, token: await d.newInvite(req.user_id) } };
  }

  return err(400, "Неизвестное действие");
}

import test from "node:test";
import assert from "node:assert/strict";
import { handle, type Deps } from "./logic.ts";

const T2 = "66666666-6666-4666-8666-666666666666", T = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const mk = (over: Partial<Deps> = {}): Deps & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    getCaller: async (b) => (b === "teacher-jwt" ? T : b === "student-jwt" ? S : null),
    isTeacher: async (id) => id === T || id === T2,
    createStudent: async (n) => { log.push("create:" + n); return "33333333-3333-4333-8333-333333333333"; },
    newInvite: async (u) => { log.push("invite:" + u); return "44444444-4444-4444-8444-444444444444"; },
    userByToken: async (t) => (t === "44444444-4444-4444-8444-444444444444" ? S : null),
    tokenHashFor: async () => "hash",
    setPassword: async (u, p) => { log.push("pw:" + u + ":" + p.length); },
    deleteStudent: async (u) => { log.push("del:" + u); },
    addStudent: async (e, n, p) => { log.push("add:" + e + ":" + n + ":" + p.length); return e === "dup@x.com" ? null : "55555555-5555-4555-8555-555555555555"; },
    inviteByEmail: async (e, n) => { log.push("mail:" + e + ":" + n); return e === "dup@x.com" ? null : "77777777-7777-4777-8777-777777777777"; },
    ...over,
  };
};

test("claim: верный токен отдаёт хэш, неверный/мусор — 404", async () => {
  assert.deepEqual(await handle({ action: "claim", token: "44444444-4444-4444-8444-444444444444" }, null, mk()), { status: 200, body: { token_hash: "hash" } });
  assert.equal((await handle({ action: "claim", token: "55555555-5555-4555-8555-555555555555" }, null, mk())).status, 404);
  assert.equal((await handle({ action: "claim", token: "' or 1=1" }, null, mk())).status, 404);
  assert.equal((await handle({ action: "claim" }, null, mk())).status, 404);
});

test("invite: только учитель, имя обязательно", async () => {
  const d = mk();
  assert.equal((await handle({ action: "invite", name: "Юлия" }, null, d)).status, 401);
  assert.equal((await handle({ action: "invite", name: "Юлия" }, "bad-jwt", d)).status, 401);
  assert.equal((await handle({ action: "invite", name: "Юлия" }, "student-jwt", d)).status, 403);
  assert.equal((await handle({ action: "invite", name: "  " }, "teacher-jwt", d)).status, 400);
  assert.deepEqual(d.log, []);
  const ok = await handle({ action: "invite", name: " Юлия " }, "teacher-jwt", d);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token, "44444444-4444-4444-8444-444444444444");
  assert.deepEqual(d.log, ["create:Юлия", "invite:33333333-3333-4333-8333-333333333333"]);
});

test("regenerate: ученику можно, учителю и мусору нельзя", async () => {
  const d = mk();
  assert.equal((await handle({ action: "regenerate", user_id: S }, "student-jwt", d)).status, 403);
  assert.equal((await handle({ action: "regenerate", user_id: S }, "teacher-jwt", d)).status, 200);
  assert.equal((await handle({ action: "regenerate", user_id: T }, "teacher-jwt", d)).status, 400);
  assert.equal((await handle({ action: "regenerate", user_id: "x" }, "teacher-jwt", d)).status, 400);
});

test("неизвестное действие", async () => {
  assert.equal((await handle({ action: "drop" }, "teacher-jwt", mk())).status, 400);
});

test("set_password: только учитель, не для учителя, пароль 8 символов без неоднозначных букв", async () => {
  const d = mk();
  assert.equal((await handle({ action: "set_password", user_id: S }, null, d)).status, 401);
  assert.equal((await handle({ action: "set_password", user_id: S }, "student-jwt", d)).status, 403);
  assert.equal((await handle({ action: "set_password", user_id: T }, "teacher-jwt", d)).status, 400);
  assert.deepEqual(d.log, []);
  const r = await handle({ action: "set_password", user_id: S }, "teacher-jwt", d);
  assert.equal(r.status, 200);
  assert.match(r.body.password as string, /^[a-km-np-z2-9]{8}$/);
  assert.deepEqual(d.log, ["pw:" + S + ":8"]);
});

test("add_student: только учитель, проверка email, дубликаты, пароль 10 символов", async () => {
  const d = mk();
  assert.equal((await handle({ action: "add_student", email: "a@b.com" }, "student-jwt", d)).status, 403);
  assert.equal((await handle({ action: "add_student", email: "не-почта" }, "teacher-jwt", d)).status, 400);
  assert.deepEqual(d.log, []);
  assert.equal((await handle({ action: "add_student", email: "dup@x.com" }, "teacher-jwt", d)).status, 409);
  const ok = await handle({ action: "add_student", email: "  Yuliya@Mail.com ", name: " Юлия " }, "teacher-jwt", d);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.email, "yuliya@mail.com");
  assert.equal(ok.body.name, "Юлия");
  assert.match(ok.body.password as string, /^[a-km-np-z2-9]{10}$/);
});

test("delete_student: только учитель, не учителя", async () => {
  const d = mk();
  assert.equal((await handle({ action: "delete_student", user_id: S }, null, d)).status, 401);
  assert.equal((await handle({ action: "delete_student", user_id: S }, "student-jwt", d)).status, 403);
  assert.equal((await handle({ action: "delete_student", user_id: T }, "teacher-jwt", d)).status, 400);
  assert.equal((await handle({ action: "delete_student", user_id: "x" }, "teacher-jwt", d)).status, 400);
  assert.deepEqual(d.log, []);
  assert.equal((await handle({ action: "delete_student", user_id: S }, "teacher-jwt", d)).status, 200);
  assert.deepEqual(d.log, ["del:" + S]);
});

test("set_password: другому учителю можно, себе и удаление учителя нельзя", async () => {
  const d = mk();
  assert.equal((await handle({ action: "set_password", user_id: T2 }, "teacher-jwt", d)).status, 200);
  assert.equal((await handle({ action: "set_password", user_id: T }, "teacher-jwt", d)).status, 400);
  assert.equal((await handle({ action: "delete_student", user_id: T2 }, "teacher-jwt", d)).status, 400);
  assert.equal((await handle({ action: "regenerate", user_id: T2 }, "teacher-jwt", d)).status, 400);
});

test("invite_email: только учитель, проверка email, дубликат — 409, письмо отправляется", async () => {
  assert.equal((await handle({ action: "invite_email", email: "a@x.com" }, null, mk())).status, 401);
  assert.equal((await handle({ action: "invite_email", email: "a@x.com" }, "student-jwt", mk())).status, 403);
  assert.equal((await handle({ action: "invite_email", email: "bad" }, "teacher-jwt", mk())).status, 400);
  assert.equal((await handle({ action: "invite_email", email: "dup@x.com" }, "teacher-jwt", mk())).status, 409);
  const d = mk();
  const r = await handle({ action: "invite_email", email: " Julia@X.com ", name: "Юлия" }, "teacher-jwt", d);
  assert.equal(r.status, 200);
  assert.deepEqual(d.log, ["mail:julia@x.com:Юлия"]);
  assert.equal(r.body.sent, true);
  assert.ok(!("password" in r.body));
});

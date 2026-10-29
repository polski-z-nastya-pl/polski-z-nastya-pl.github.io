import test from "node:test";
import assert from "node:assert/strict";
import { handle, type Deps } from "./logic.ts";

const T = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const mk = (over: Partial<Deps> = {}): Deps & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    getCaller: async (b) => (b === "teacher-jwt" ? T : b === "student-jwt" ? S : null),
    isTeacher: async (id) => id === T,
    createStudent: async (n) => { log.push("create:" + n); return "33333333-3333-4333-8333-333333333333"; },
    newInvite: async (u) => { log.push("invite:" + u); return "44444444-4444-4444-8444-444444444444"; },
    userByToken: async (t) => (t === "44444444-4444-4444-8444-444444444444" ? S : null),
    tokenHashFor: async () => "hash",
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

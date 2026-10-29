(() => {
  const sb = supabase.createClient(CFG.url, CFG.key);
  const $app = document.getElementById("app");
  const me = { user: null, profile: null };
  const INTERVALS = [0, 1, 3, 7, 14]; // дни до повтора для коробок 1..5

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const isTeacher = () => me.profile?.role === "teacher";
  const speak = (text) => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = "pl-PL"; u.rate = 0.85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  const $ = (id) => document.getElementById(id);
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const fail = (e) => { $app.innerHTML = `<p class="err">Ошибка: ${esc(e.message || e)}</p><button class="btn" id="r">Назад</button>`; on("r", home); };

  async function must(p) { const { data, error } = await p; if (error) throw error; return data; }

  // ---------- авторизация ----------
  function authView(mode = "login") {
    const reg = mode === "register";
    $app.innerHTML = `
      <h1><span class="flag"></span>Polski Quiz</h1>
      <p class="sub">Тесты и карточки для изучения польского (A2–B1)</p>
      <div class="tabs"><button class="tab ${reg ? "" : "on"}" id="tl">Вход</button><button class="tab ${reg ? "on" : ""}" id="tr">Регистрация</button></div>
      <form id="af" class="q">
        ${reg ? `<label class="field">Имя<input type="text" id="nm" required></label>` : ""}
        <label class="field">Email<input type="text" id="em" autocomplete="email" required></label>
        <label class="field">Пароль (от 6 символов)<input type="password" id="pw" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required></label>
        <div class="err" id="er"></div>
        <button class="btn" type="submit" style="width:100%">${reg ? "Создать аккаунт" : "Войти"}</button>
      </form>`;
    on("tl", () => authView("login")); on("tr", () => authView("register"));
    $("af").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("em").value.trim(), password = $("pw").value;
      const r = reg
        ? await sb.auth.signUp({ email, password, options: { data: { display_name: $("nm").value.trim() } } })
        : await sb.auth.signInWithPassword({ email, password });
      if (r.error) { $("er").textContent = r.error.message; return; }
      if (reg && !r.data.session) { $("er").style.color = "var(--ok)"; $("er").textContent = "Готово! Подтвердите email по письму и войдите."; return; }
    };
  }

  async function loadProfile() {
    me.profile = await must(sb.from("profiles").select("*").eq("id", me.user.id).single());
  }

  function header(extra = "") {
    return `<div class="top"><span>👤 ${esc(me.profile.display_name)}${isTeacher() ? " · учитель" : ""}</span>
      <span>${extra}<button class="link" id="out">Выйти</button></span></div>`;
  }

  // ---------- главная ученика ----------
  async function home() {
    try {
      const [words, prog] = await Promise.all([
        must(sb.from("words").select("id")), must(sb.from("card_progress").select("word_id,due"))]);
      const seen = new Map(prog.map((p) => [p.word_id, p.due]));
      const due = words.filter((w) => !seen.has(w.id) || seen.get(w.id) <= today()).length;
      $app.innerHTML = `${header()}
        <h1><span class="flag"></span>Polski Quiz</h1>
        <p class="sub">Выберите, чем заняться.</p>
        <div class="grid">
          <button class="card" id="gt"><span class="ico">📝</span><b>Тесты</b><small>Тесты уровней A2–B1</small></button>
          <button class="card" id="gf"><span class="ico">🃏</span><b>Карточки</b><small>К повторению: ${due}</small></button>
          <button class="card" id="gh"><span class="ico">📈</span><b>Мои результаты</b><small>История прохождений</small></button>
          ${isTeacher() ? `<button class="card" id="gp"><span class="ico">🧑‍🏫</span><b>Панель учителя</b><small>Тесты, слова, результаты</small></button>` : ""}
        </div>`;
      on("out", () => sb.auth.signOut());
      on("gt", testsList); on("gf", flashcards); on("gh", history); on("gp", () => teacher("tests"));
    } catch (e) { fail(e); }
  }

  // ---------- список тестов и прохождение ----------
  async function testsList() {
    try {
      const [tests, att] = await Promise.all([
        must(sb.from("tests").select("*").eq("published", true).order("level").order("title")),
        must(sb.from("attempts").select("test_id,score,total").eq("user_id", me.user.id))]);
      const best = {};
      att.forEach((a) => { if (!best[a.test_id] || a.score / a.total > best[a.test_id].score / best[a.test_id].total) best[a.test_id] = a; });
      $app.innerHTML = `<div class="top"><button class="link" id="back">← Назад</button><span>Тесты</span></div>
        ${tests.length ? `<div class="grid">${tests.map((t) => `<button class="card" data-t="${t.id}"><span class="badge">${t.level}</span><b>${esc(t.title)}</b><small>${esc(t.description)}</small>
          ${best[t.id] ? `<span class="best">Лучший: ${best[t.id].score}/${best[t.id].total}</span>` : ""}</button>`).join("")}</div>` : `<p class="sub">Пока нет опубликованных тестов.</p>`}`;
      on("back", home);
      $app.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => startTest(tests.find((t) => t.id === b.dataset.t)));
    } catch (e) { fail(e); }
  }

  async function startTest(test) {
    try {
      const qs = await must(sb.from("questions").select("*").eq("test_id", test.id).order("position"));
      if (!qs.length) { alert("В этом тесте пока нет вопросов."); return; }
      renderQ({ test, qs: qs.map((q) => ({ ...q, options: shuffle(q.options) })), i: 0, score: 0, wrong: [] });
    } catch (e) { fail(e); }
  }

  function renderQ(quiz) {
    const q = quiz.qs[quiz.i];
    $app.innerHTML = `
      <div class="top"><button class="link" id="back">← Выйти</button><span>${esc(quiz.test.title)} · ${quiz.i + 1}/${quiz.qs.length}</span></div>
      <div class="bar"><i style="width:${quiz.i / quiz.qs.length * 100}%"></i></div>
      <div class="q">
        <h2>${esc(q.prompt)}</h2>
        <p class="hint">${q.type === "type" ? "Введите ответ" : "Выберите вариант"}</p>
        ${q.type === "choice"
          ? `<div class="opts">${q.options.map((o) => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`
          : `<form id="f"><input type="text" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>
             <div class="row"><button class="btn" type="submit">Проверить</button></div></form>`}
        <div id="fb"></div>
      </div>`;
    on("back", () => { if (confirm("Выйти из теста? Прогресс теста будет потерян.")) testsList(); });
    if (q.type === "choice") $app.querySelectorAll(".opt").forEach((b) => b.onclick = () => answer(quiz, q, b.dataset.v, b));
    else $("f").onsubmit = (e) => { e.preventDefault(); const v = $("inp").value; if (v.trim()) answer(quiz, q, v); };
  }

  function answer(quiz, q, given, btn) {
    let ok, note = "";
    if (q.type === "choice") ok = given === q.answer;
    else {
      ok = norm(given) === norm(q.answer);
      if (!ok && norm(strip(given)) === norm(strip(q.answer))) { ok = true; note = ` Правильное написание: <b>${esc(q.answer)}</b>.`; }
    }
    if (ok) quiz.score++; else quiz.wrong.push({ prompt: q.prompt, given, answer: q.answer });
    if (q.type === "choice") {
      $app.querySelectorAll(".opt").forEach((b) => { b.disabled = true; if (b.dataset.v === q.answer) b.classList.add("ok"); });
      if (!ok) btn.classList.add("bad");
    } else { $("inp").disabled = true; document.querySelector("#f .btn").remove(); }
    const last = quiz.i + 1 === quiz.qs.length;
    $("fb").innerHTML = `
      <div class="fb ${ok ? "ok" : "bad"}">${ok ? "✅ Верно!" : `❌ Неверно. Правильный ответ: <b>${esc(q.answer)}</b>.`}${note}
        ${q.explain ? `<br><small>${esc(q.explain)}</small>` : ""}
        <button class="say" id="say" aria-label="Прослушать">🔊</button></div>
      <div class="row"><button class="btn" id="next" autofocus>${last ? "Результат" : "Дальше"}</button></div>`;
    on("say", () => speak(q.type === "type" || !/[а-яё]/i.test(q.answer) ? q.answer : q.prompt));
    on("next", () => { quiz.i++; last ? results(quiz) : renderQ(quiz); });
  }

  async function results(quiz) {
    const total = quiz.qs.length, pct = Math.round(quiz.score / total * 100);
    let saveErr = "";
    try { await must(sb.from("attempts").insert({ test_id: quiz.test.id, score: quiz.score, total })); }
    catch (e) { saveErr = `<p class="err">Не удалось сохранить результат: ${esc(e.message)}</p>`; }
    const msg = pct === 100 ? "Отлично! Perfekcyjnie! 🎉" : pct >= 70 ? "Хороший результат! Dobrze!" : pct >= 40 ? "Неплохо, но стоит повторить." : "Не сдавайтесь — практика ведёт к результату!";
    $app.innerHTML = `
      <h1>Результат</h1><div class="score">${quiz.score}/${total}</div>
      <p class="sub" style="text-align:center">${pct}% · ${msg}</p>${saveErr}
      ${quiz.wrong.length ? `<h3>Над чем поработать</h3><ul class="review">${quiz.wrong.map((w) =>
        `<li>${esc(w.prompt)}<br>Ваш ответ: <span class="u">${esc(w.given)}</span> · Верно: <span class="a">${esc(w.answer)}</span></li>`).join("")}</ul>` : ""}
      <div class="row"><button class="btn" id="again">Ещё раз</button><button class="btn alt" id="tl">К тестам</button></div>`;
    on("again", () => startTest(quiz.test)); on("tl", testsList);
  }

  async function history() {
    try {
      const att = await must(sb.from("attempts").select("*, tests(title,level)").eq("user_id", me.user.id).order("created_at", { ascending: false }).limit(50));
      $app.innerHTML = `<div class="top"><button class="link" id="back">← Назад</button><span>Мои результаты</span></div>
        ${att.length ? `<ul class="review">${att.map((a) => `<li><span class="badge">${esc(a.tests?.level)}</span>${esc(a.tests?.title)} — <b>${a.score}/${a.total}</b>
          <br><small>${new Date(a.created_at).toLocaleString("ru-RU")}</small></li>`).join("")}</ul>` : `<p class="sub">Вы ещё не проходили тесты.</p>`}`;
      on("back", home);
    } catch (e) { fail(e); }
  }

  // ---------- карточки (интервальное повторение) ----------
  async function flashcards() {
    try {
      const [words, prog] = await Promise.all([must(sb.from("words").select("*")), must(sb.from("card_progress").select("*"))]);
      const pm = new Map(prog.map((p) => [p.word_id, p]));
      const queue = shuffle(words.filter((w) => !pm.has(w.id) || pm.get(w.id).due <= today())).slice(0, 20);
      if (!queue.length) {
        $app.innerHTML = `<div class="top"><button class="link" id="back">← Назад</button><span>Карточки</span></div><p class="sub">На сегодня всё повторено. 🎉 Возвращайтесь завтра!</p>`;
        return on("back", home);
      }
      let i = 0, known = 0;
      const show = (flipped) => {
        const w = queue[i];
        $app.innerHTML = `
          <div class="top"><button class="link" id="back">← Выйти</button><span>Карточки · ${i + 1}/${queue.length}</span></div>
          <div class="bar"><i style="width:${i / queue.length * 100}%"></i></div>
          <div class="q flash">
            <div class="w">${esc(w.pl)} <button class="say" id="say" aria-label="Прослушать">🔊</button></div>
            ${flipped ? `<div class="tr">${esc(w.ru)}</div>${w.example ? `<div class="ex">${esc(w.example)}</div>` : ""}` : ""}
          </div>
          <div class="row">${flipped
            ? `<button class="btn alt" id="no">Не знал</button><button class="btn" id="yes">Знал</button>`
            : `<button class="btn" id="flip">Показать перевод</button>`}</div>`;
        on("back", home); on("say", () => speak(w.pl));
        on("flip", () => show(true));
        on("yes", () => rate(true)); on("no", () => rate(false));
      };
      const rate = async (ok) => {
        const w = queue[i], box = pm.get(w.id)?.box || 1;
        const nb = ok ? Math.min(5, box + 1) : 1;
        if (ok) known++;
        sb.from("card_progress").upsert({ user_id: me.user.id, word_id: w.id, box: nb, due: addDays(INTERVALS[nb - 1]) }).then(({ error }) => error && console.error(error));
        if (++i < queue.length) show(false);
        else {
          $app.innerHTML = `<h1>Готово!</h1><div class="score">${known}/${queue.length}</div><p class="sub" style="text-align:center">слов вы знали</p>
            <div class="row"><button class="btn" id="home">На главную</button></div>`;
          on("home", home);
        }
      };
      show(false);
    } catch (e) { fail(e); }
  }

  // ---------- панель учителя ----------
  function tabs(cur) {
    return `<div class="top"><button class="link" id="back">← На главную</button><span>Панель учителя</span></div>
      <div class="tabs">${[["tests", "Тесты"], ["students", "Ученики"], ["words", "Слова"], ["results", "Результаты"]].map(([k, t]) =>
        `<button class="tab ${cur === k ? "on" : ""}" data-tab="${k}">${t}</button>`).join("")}</div>`;
  }
  function bindTabs() {
    on("back", home);
    $app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => teacher(b.dataset.tab));
  }

  async function teacher(tab) {
    try {
      if (tab === "tests") return teacherTests();
      if (tab === "students") return teacherStudents();
      if (tab === "words") return teacherWords();
      return teacherResults();
    } catch (e) { fail(e); }
  }

  async function teacherTests() {
    const tests = await must(sb.from("tests").select("*, questions(count)").order("created_at", { ascending: false }));
    $app.innerHTML = `${tabs("tests")}
      <div class="row" style="margin:0 0 12px"><button class="btn sm" id="new">+ Новый тест</button></div>
      ${tests.map((t) => `<div class="item"><span class="badge">${t.level}</span><span class="badge ${t.published ? "" : "off"}">${t.published ? "опубликован" : "черновик"}</span>
        <b>${esc(t.title)}</b><br><small>${esc(t.description)} · вопросов: ${t.questions[0].count}</small>
        <div class="row"><button class="btn sm alt" data-e="${t.id}">Редактировать</button></div></div>`).join("") || `<p class="sub">Тестов пока нет.</p>`}`;
    bindTabs();
    on("new", async () => {
      try {
        const t = await must(sb.from("tests").insert({ title: "Новый тест", level: "A2" }).select().single());
        editTest(t.id);
      } catch (e) { fail(e); }
    });
    $app.querySelectorAll("[data-e]").forEach((b) => b.onclick = () => editTest(b.dataset.e));
  }

  async function editTest(id) {
    try {
      const [t, qs, students, asg] = await Promise.all([
        must(sb.from("tests").select("*").eq("id", id).single()),
        must(sb.from("questions").select("*").eq("test_id", id).order("position")),
        must(sb.from("profiles").select("id,display_name").eq("role", "student").order("display_name")),
        must(sb.from("test_assignments").select("user_id").eq("test_id", id))]);
      const assigned = new Set(asg.map((a) => a.user_id));
      $app.innerHTML = `<div class="top"><button class="link" id="back">← К тестам</button><span>Редактирование</span></div>
        <div class="q">
          <label class="field">Название<input type="text" id="tt" value="${esc(t.title)}"></label>
          <label class="field">Описание<input type="text" id="td" value="${esc(t.description)}"></label>
          <label class="field">Уровень<select id="tv"><option ${t.level === "A2" ? "selected" : ""}>A2</option><option ${t.level === "B1" ? "selected" : ""}>B1</option></select></label>
          <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="tp" ${t.published ? "checked" : ""}> Опубликован</label>
          <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="tfa" ${t.for_all ? "checked" : ""}> Доступен всем ученикам</label>
          <div class="field">Или только выбранным ученикам:
            ${students.length ? students.map((p) => `<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" data-as="${p.id}" ${assigned.has(p.id) ? "checked" : ""}> ${esc(p.display_name)}</label>`).join("") : "<i>Учеников пока нет</i>"}</div>
          <div class="row"><button class="btn sm" id="ts">Сохранить тест</button><button class="btn sm danger" id="tdel">Удалить тест</button></div>
          <div class="err" id="er"></div>
        </div>
        <h3>Вопросы</h3>
        ${qs.map((q) => qForm(q)).join("")}
        <div class="row"><button class="btn sm" id="nq">+ Добавить вопрос</button></div>`;
      on("back", teacherTests);
      on("ts", async () => {
        const { error } = await sb.from("tests").update({ title: $("tt").value, description: $("td").value, level: $("tv").value, published: $("tp").checked, for_all: $("tfa").checked }).eq("id", id);
        $("er").style.color = error ? "var(--bad)" : "var(--ok)"; $("er").textContent = error ? error.message : "Сохранено";
      });
      $app.querySelectorAll("[data-as]").forEach((c) => c.onchange = () => setAssign(id, c.dataset.as, c.checked, c));
      on("tdel", async () => { if (confirm("Удалить тест вместе с вопросами и результатами?")) { await must(sb.from("tests").delete().eq("id", id)); teacherTests(); } });
      on("nq", async () => {
        await must(sb.from("questions").insert({ test_id: id, position: qs.length + 1, type: "choice", prompt: "Новый вопрос", options: ["вариант 1", "вариант 2"], answer: "вариант 1" }));
        editTest(id);
      });
      $app.querySelectorAll("[data-qs]").forEach((b) => b.onclick = async () => {
        const f = b.closest(".item"), type = f.querySelector(".qt").value;
        const options = type === "choice" ? f.querySelector(".qo").value.split("\n").map((s) => s.trim()).filter(Boolean) : [];
        const answer = f.querySelector(".qa").value.trim();
        const msg = f.querySelector(".err");
        if (type === "choice" && !options.includes(answer)) { msg.textContent = "Правильный ответ должен совпадать с одним из вариантов."; return; }
        const { error } = await sb.from("questions").update({ type, prompt: f.querySelector(".qp").value, options, answer, explain: f.querySelector(".qx").value }).eq("id", b.dataset.qs);
        msg.style.color = error ? "var(--bad)" : "var(--ok)"; msg.textContent = error ? error.message : "Сохранено";
      });
      $app.querySelectorAll("[data-qd]").forEach((b) => b.onclick = async () => {
        if (confirm("Удалить вопрос?")) { await must(sb.from("questions").delete().eq("id", b.dataset.qd)); editTest(id); }
      });
    } catch (e) { fail(e); }
  }

  function qForm(q) {
    return `<div class="item">
      <label class="field">Тип<select class="qt"><option value="choice" ${q.type === "choice" ? "selected" : ""}>Выбор ответа</option><option value="type" ${q.type === "type" ? "selected" : ""}>Ввод слова</option></select></label>
      <label class="field">Вопрос<input type="text" class="qp" value="${esc(q.prompt)}"></label>
      <label class="field">Варианты (по одному в строке; только для «Выбор ответа»)<textarea class="qo">${esc(q.options.join("\n"))}</textarea></label>
      <label class="field">Правильный ответ<input type="text" class="qa" value="${esc(q.answer)}"></label>
      <label class="field">Пояснение (необязательно)<input type="text" class="qx" value="${esc(q.explain)}"></label>
      <div class="err"></div>
      <div class="row"><button class="btn sm" data-qs="${q.id}">Сохранить</button><button class="btn sm danger" data-qd="${q.id}">Удалить</button></div></div>`;
  }

  async function setAssign(testId, userId, on, box) {
    const q = on ? sb.from("test_assignments").upsert({ test_id: testId, user_id: userId })
                 : sb.from("test_assignments").delete().eq("test_id", testId).eq("user_id", userId);
    const { error } = await q;
    if (error) { box.checked = !on; alert("Не удалось сохранить: " + error.message); }
  }

  async function teacherStudents() {
    const [profs, tests, asg] = await Promise.all([
      must(sb.from("profiles").select("*").order("display_name")),
      must(sb.from("tests").select("id,title,level,published,for_all").order("level").order("title")),
      must(sb.from("test_assignments").select("*"))]);
    const has = new Set(asg.map((a) => a.test_id + ":" + a.user_id));
    $app.innerHTML = `${tabs("students")}
      <p class="hint">Здесь Настя назначает роль и выбирает, какие тесты видит каждый ученик. Новые пользователи регистрируются сами и по умолчанию — ученики.</p>
      ${profs.map((p) => `<div class="item"><b>${esc(p.display_name)}</b>
        <select data-role="${p.id}" style="width:auto;margin-left:8px" ${p.id === me.user.id ? "disabled" : ""}>
          <option value="student" ${p.role === "student" ? "selected" : ""}>ученик</option>
          <option value="teacher" ${p.role === "teacher" ? "selected" : ""}>учитель</option></select>
        ${p.role === "student" ? `<div style="margin-top:8px">${tests.map((t) => `<label style="display:flex;gap:8px;align-items:center;font-size:14px">
          <input type="checkbox" data-t="${t.id}" data-u="${p.id}" ${has.has(t.id + ":" + p.id) ? "checked" : ""}>
          <span class="badge">${t.level}</span>${esc(t.title)}${t.for_all ? " <small>(доступен всем)</small>" : ""}${t.published ? "" : " <small>(черновик)</small>"}</label>`).join("") || "<small>Тестов нет</small>"}</div>` : ""}
      </div>`).join("")}`;
    bindTabs();
    $app.querySelectorAll("[data-t]").forEach((c) => c.onchange = () => setAssign(c.dataset.t, c.dataset.u, c.checked, c));
    $app.querySelectorAll("[data-role]").forEach((sel) => sel.onchange = async () => {
      const { error } = await sb.from("profiles").update({ role: sel.value }).eq("id", sel.dataset.role);
      if (error) alert("Не удалось сохранить: " + error.message);
      teacherStudents();
    });
  }

  async function teacherWords() {
    const words = await must(sb.from("words").select("*").order("level").order("topic").order("pl"));
    $app.innerHTML = `${tabs("words")}
      <div class="q"><b>Добавить слова списком</b>
        <p class="hint">Одно слово в строке: <code>слово ; перевод ; пример (необязательно)</code></p>
        <textarea id="bulk" placeholder="zamierzać ; намереваться ; Zamierzam zmienić pracę."></textarea>
        <div class="row" style="align-items:center">
          <select id="bl" style="width:auto"><option>A2</option><option>B1</option></select>
          <input type="text" id="bt" placeholder="Тема" style="width:auto;flex:1">
          <button class="btn sm" id="bs">Добавить</button></div>
        <div class="err" id="er"></div></div>
      <h3>Слова (${words.length})</h3>
      <table><tr><th>PL</th><th>RU</th><th>Ур.</th><th></th></tr>
      ${words.map((w) => `<tr><td>${esc(w.pl)}</td><td>${esc(w.ru)}</td><td>${w.level}</td><td><button class="link" data-wd="${w.id}">удалить</button></td></tr>`).join("")}</table>`;
    bindTabs();
    on("bs", async () => {
      const rows = $("bulk").value.split("\n").map((l) => l.split(";").map((s) => s.trim())).filter((p) => p[0] && p[1])
        .map((p) => ({ pl: p[0], ru: p[1], example: p[2] || "", level: $("bl").value, topic: $("bt").value.trim() }));
      if (!rows.length) { $("er").textContent = "Нет строк в формате «слово ; перевод»."; return; }
      const { error } = await sb.from("words").insert(rows);
      if (error) { $("er").textContent = error.message; return; }
      teacherWords();
    });
    $app.querySelectorAll("[data-wd]").forEach((b) => b.onclick = async () => {
      if (confirm("Удалить слово?")) { await must(sb.from("words").delete().eq("id", b.dataset.wd)); teacherWords(); }
    });
  }

  async function teacherResults() {
    const [att, profs, tests] = await Promise.all([
      must(sb.from("attempts").select("*").order("created_at", { ascending: false }).limit(200)),
      must(sb.from("profiles").select("id,display_name")), must(sb.from("tests").select("id,title"))]);
    const pn = Object.fromEntries(profs.map((p) => [p.id, p.display_name])), tn = Object.fromEntries(tests.map((t) => [t.id, t.title]));
    $app.innerHTML = `${tabs("results")}
      ${att.length ? `<table><tr><th>Ученик</th><th>Тест</th><th>Балл</th><th>Дата</th></tr>${att.map((a) =>
        `<tr><td>${esc(pn[a.user_id] || "—")}</td><td>${esc(tn[a.test_id] || "—")}</td><td>${a.score}/${a.total}</td><td>${new Date(a.created_at).toLocaleDateString("ru-RU")}</td></tr>`).join("")}</table>`
        : `<p class="sub">Пока никто не проходил тесты.</p>`}`;
    bindTabs();
  }

  // ---------- старт ----------
  async function route(session) {
    if (!session) { me.user = null; me.profile = null; return authView(); }
    me.user = session.user;
    try { await loadProfile(); home(); } catch (e) { fail(e); }
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session && me.user?.id === session.user.id) return; // обновление токена/возврат на вкладку
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => route(session), 0);
  });
})();

(() => {
  const sb = supabase.createClient(CFG.url, CFG.key);
  const $app = document.getElementById("app");
  const me = { user: null, profile: null, preview: false };
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
      <p class="sub">Тесты и карточки для изучения польского. Доступ выдаёт учитель: логин и пароль придут от неё.</p>
      <h3 style="margin:0 0 10px">Вход</h3>
      <form id="af" class="q">
        ${reg ? `<label class="field">Имя<input type="text" id="nm" required></label>` : ""}
        <label class="field">Email<input type="text" id="em" autocomplete="email" required></label>
        <label class="field">Пароль (от 6 символов)
          <span class="pw"><input type="password" id="pw" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required>
          <button type="button" id="eye" class="eye" aria-label="Показать пароль" aria-pressed="false">👁</button></span></label>
        ${reg ? `<p class="hint">Регистрация только для учеников, чей email добавила учитель.</p>` : ""}
        <div class="err" id="er"></div>
        <button class="btn" type="submit" style="width:100%">${reg ? "Создать аккаунт" : "Войти"}</button>
      </form>`;

    on("eye", () => {
      const inp = $("pw"), show = inp.type === "password";
      inp.type = show ? "text" : "password";
      $("eye").setAttribute("aria-pressed", String(show));
      $("eye").setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
      $("eye").style.opacity = show ? "1" : ".55";
    });
    $("af").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("em").value.trim(), password = $("pw").value;
      const r = reg
        ? await sb.auth.signUp({ email, password, options: { data: { display_name: $("nm").value.trim() } } })
        : await sb.auth.signInWithPassword({ email, password });
      if (r.error) {
        const m = r.error.message || "";
        $("er").textContent = reg && /database error|invitation|приглашению/i.test(m) ? "Этого email нет в списке. Попросите учителя добавить вас."
          : /invalid login/i.test(m) ? "Неверный email или пароль." : m;
        return;
      }
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

  // ---------- навигация и состояния ----------
  const spacer = `<div style="height:84px"></div>`;
  function navBar(active) {
    const items = [["home", "📝", "Задания"], ["cards", "🃏", "Слова"], ["hist", "📈", "Результаты"]];
    if (isTeacher()) items.push(["panel", "⚙️", "Панель"]);
    return `<nav class="nav" aria-label="Разделы">${items.map(([k, i, t]) =>
      `<button data-nav="${k}" class="${k === active ? "on" : ""}" ${k === active ? 'aria-current="page"' : ""}><span class="ni">${i}</span>${t}</button>`).join("")}</nav>`;
  }
  function bindNav() {
    const go = { home: () => home(), cards: () => flashcards(), hist: () => history(), panel: () => { me.preview = false; teacher("tests"); } };
    $app.querySelectorAll("[data-nav]").forEach((b) => b.onclick = go[b.dataset.nav]);
  }
  const loading = () => { $app.innerHTML = `<p class="sub" style="text-align:center;margin-top:40px">Загрузка…</p>`; };
  const plural = (n, one, few, many) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many; };
  const pctOf = (a) => Math.round(a.score / a.total * 100);

  // ---------- главная ученика: сразу задания ----------
  async function home() {
    if (isTeacher() && !me.preview) return teacher("tests");
    loading();
    try {
      const [tests, att, words, prog] = await Promise.all([
        must(sb.from("tests").select("*").eq("published", true).order("level").order("title")),
        must(sb.from("attempts").select("test_id,score,total,created_at").eq("user_id", me.user.id)),
        must(sb.from("words").select("id")), must(sb.from("card_progress").select("word_id,due"))]);
      const best = {};
      att.forEach((a) => { if (!best[a.test_id] || pctOf(a) > pctOf(best[a.test_id])) best[a.test_id] = a; });
      const seen = new Map(prog.map((p) => [p.word_id, p.due]));
      const due = words.filter((w) => !seen.has(w.id) || seen.get(w.id) <= today()).length;
      const todo = tests.filter((t) => !best[t.id]), done = tests.filter((t) => best[t.id]);
      const card = (t) => {
        const b = best[t.id];
        return `<button class="task" data-t="${t.id}">
          <span class="task-main"><b>${esc(t.title)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ""}</span>
          <span class="task-side">${b ? `<span class="chip ok">✓ ${b.score}/${b.total}</span><small>Пройти ещё раз</small>` : `<span class="chip new">Новое</span><small>Начать</small>`}</span></button>`;
      };
      $app.innerHTML = `${header()}
        ${me.preview ? `<div class="fb almost" style="margin:0 0 12px">👁 Режим просмотра: так приложение видит ученик (показаны все опубликованные тесты). <button class="link" id="exitprev">← Вернуться в панель</button></div>` : ""}
        <h1>Привет, ${esc(me.profile.display_name.split(" ")[0])}! 👋</h1>
        <p class="sub">${todo.length ? `Новых заданий: ${todo.length}. Нажмите на задание, чтобы начать.` : tests.length ? "Все задания пройдены. Можно повторить или потренировать слова." : "Когда учитель назначит тест, он появится здесь."}</p>
        ${todo.length ? `<h3 class="sec">Новые задания</h3>${todo.map(card).join("")}` : ""}
        <button class="task words" id="gf"><span class="task-main"><b>🃏 Повторить слова</b><small>${due ? `На сегодня: ${due} ${plural(due, "слово", "слова", "слов")}` : "На сегодня всё повторено 🎉"}</small></span><span class="task-side"><small>${due ? "Начать" : ""}</small></span></button>
        ${done.length ? `<h3 class="sec">Пройденные</h3>${done.map(card).join("")}` : ""}
        ${navBar("home")}`;
      on("out", () => sb.auth.signOut()); on("gf", flashcards); on("exitprev", () => { me.preview = false; teacher("tests"); }); bindNav();
      $app.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => startTest(tests.find((t) => t.id === b.dataset.t)));
    } catch (e) { fail(e); }
  }
  const testsList = home;

  // ---------- прохождение теста: одно задание на экране ----------
  const LETTERS = ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"];
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith("on")) el[k] = v; else el.setAttribute(k, v); }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const asList = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  // старые вопросы (type='type') приводим к input
  const normQ = (q) => {
    const type = q.type === "type" ? "input" : q.type;
    return { ...q, type, answers: type === "choice" ? [q.answer] : (asList(q.answers).length ? q.answers : [q.answer]) };
  };
  const shown = (q) => q.answers.join(q.type === "input" ? " / " : "; ");
  const given2text = (g) => Array.isArray(g) ? g.join("; ") : g;

  async function startTest(test, opts = {}) {
    try {
      const raw = await must(sb.from("questions").select("*").eq("test_id", test.id).order("position"));
      if (!raw.length) { alert("В этом тесте пока нет вопросов."); return; }
      const qs = raw.map(normQ);
      const order = [], groups = new Map();
      qs.forEach((q) => { const k = q.task_title + "\u0000" + q.task_instruction; if (!groups.has(k)) { groups.set(k, { title: q.task_title, instruction: q.task_instruction, qs: [] }); order.push(k); } groups.get(k).qs.push(q); });
      const tasks = order.map((k) => { const g = groups.get(k); return { ...g, qs: shuffle(g.qs).map((q) => q.options?.length ? { ...q, options: shuffle(q.options) } : q) }; });
      runTask({ test, tasks, ti: 0, results: [], dry: !!opts.dry });
    } catch (e) { fail(e); }
  }

  function grade(q, given) {
    const r = { q, given, correct: false, status: "bad" };
    if (q.type === "choice") r.correct = given === q.answers[0];
    else if (q.type === "multi") r.correct = given.length === q.answers.length && given.every((g) => q.answers.includes(g));
    else {
      const g = norm(given);
      if (q.answers.some((a) => norm(a) === g)) r.correct = true;
      else if (q.answers.some((a) => norm(strip(a)) === norm(strip(given)))) r.status = "almost"; // только диакритика
    }
    if (r.correct) r.status = "ok";
    return r;
  }

  function feedback(q, r) {
    const why = q.explain ? h("span", { class: "why" }, q.explain) : null;
    if (r.correct) return h("div", { class: "fb ok" }, "✅ Верно! ", why);
    if (r.status === "almost") return h("div", { class: "fb almost" }, "🟡 Почти! Проверь польские буквы: правильно — ", h("b", {}, shown(q)), why);
    return h("div", { class: "fb bad" }, "❌ Правильно: ", h("b", {}, shown(q)), why);
  }

  function runTask(run) {
    const task = run.tasks[run.ti], widgets = [];
    const card = h("div", { class: "q" });
    task.qs.forEach((q, i) => {
      const box = h("div", { class: "qbox" }, h("p", { class: "prompt" }, `${i + 1}. ${q.prompt}`));
      const fb = h("div");
      let w;
      if (q.type === "input") {
        const inp = h("input", { type: "text", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Ответ" });
        const keys = h("div", { class: "keys" }, LETTERS.map((c) => {
          const b = h("button", { type: "button", "aria-label": c }, c);
          b.onpointerdown = (e) => e.preventDefault();
          b.onclick = () => { if (inp.disabled) return; const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s; inp.value = inp.value.slice(0, s) + c + inp.value.slice(e); inp.focus(); inp.setSelectionRange(s + 1, s + 1); };
          return b;
        }));
        box.append(keys, inp, fb);
        w = { read: () => inp.value.trim() && inp.value, lock: (r) => { inp.disabled = true; inp.classList.add(r.status); } };
      } else {
        const multi = q.type === "multi";
        const labels = q.options.map((o) => {
          const input = h("input", { type: multi ? "checkbox" : "radio", name: "q" + q.id, value: o });
          const lab = h("label", { class: "qopt" }, input, h("span", {}, o));
          input.onchange = () => labels.forEach((l) => l.lab.classList.toggle("sel", l.input.checked));
          return { o, input, lab };
        });
        box.append(...labels.map((l) => l.lab), fb);
        w = {
          read: () => { const v = labels.filter((l) => l.input.checked).map((l) => l.o); return v.length ? (multi ? v : v[0]) : null; },
          lock: () => labels.forEach((l) => {
            l.input.disabled = true; l.lab.classList.remove("sel");
            const correct = q.answers.includes(l.o);
            if (l.input.checked) l.lab.classList.add(correct ? "ok" : "bad"); else if (correct) l.lab.classList.add("miss");
          })
        };
      }
      widgets.push({ q, fb, ...w });
      card.append(box);
    });

    const hint = h("p", { class: "err", style: "text-align:center" });
    const btn = h("button", { class: "btn", style: "width:100%;margin-top:12px" }, "Проверить");
    btn.onclick = () => {
      const answers = widgets.map((x) => x.read());
      if (answers.some((a) => !a)) { hint.textContent = "Ответь на все вопросы задания."; return; }
      hint.textContent = "";
      widgets.forEach((x, i) => { const r = grade(x.q, answers[i]); run.results.push(r); x.lock(r); x.fb.replaceChildren(feedback(x.q, r)); });
      const last = run.ti + 1 === run.tasks.length;
      btn.textContent = last ? "Показать результат" : "Дальше";
      btn.onclick = () => { if (last) results(run); else { run.ti++; runTask(run); } };
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const back = h("button", { class: "link", onclick: () => { if (confirm("Выйти из теста? Прогресс теста будет потерян.")) (run.dry ? teacher("check") : testsList()); } }, "← Выйти");
    $app.replaceChildren(
      h("div", { class: "top" }, back, h("span", {}, `${run.test.title} · ${run.ti + 1}/${run.tasks.length}`)),
      h("div", { class: "bar" }, h("i", { style: `width:${run.ti / run.tasks.length * 100}%` })),
      task.title ? h("h2", {}, task.title) : null,
      task.instruction ? h("p", { class: "hint" }, task.instruction) : null,
      card, hint, btn);
    window.scrollTo(0, 0);
  }

  async function results(run) {
    const total = run.results.length, score = run.results.filter((r) => r.correct).length, pct = Math.round(score / total * 100);
    const wrong = run.results.filter((r) => !r.correct);
    let saveErr = null;
    if (!run.dry) try { await must(sb.from("attempts").insert({ test_id: run.test.id, score, total })); }
    catch (e) { saveErr = h("p", { class: "err" }, "Не удалось сохранить результат: " + e.message); }
    const msg = pct === 100 ? "Отлично! Perfekcyjnie! 🎉" : pct >= 70 ? "Хороший результат! Dobrze!" : pct >= 40 ? "Неплохо, но стоит повторить." : "Не сдавайтесь — практика ведёт к результату!";
    $app.replaceChildren(
      h("h1", {}, "Результат"), run.dry ? h("div", { class: "fb almost", style: "margin:0 0 8px" }, "🧪 Пробный режим: результат не сохранён.") : null, h("div", { class: "score" }, `${score}/${total}`),
      h("p", { class: "sub", style: "text-align:center" }, `${pct}% · ${msg}`), saveErr,
      wrong.length ? h("div", {}, h("h3", {}, "Над чем поработать"), h("ul", { class: "review" }, wrong.map((r) => h("li", {},
        r.q.prompt, h("br"), "Ваш ответ: ", h("span", { class: "u" }, given2text(r.given)), " · Верно: ", h("span", { class: "a" }, shown(r.q)),
        r.q.explain ? h("br") : null, r.q.explain ? h("small", {}, r.q.explain) : null)))) : null,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => startTest(run.test, { dry: run.dry }) }, "Ещё раз"), h("button", { class: "btn alt", onclick: () => (run.dry ? teacher("check") : testsList()) }, run.dry ? "К списку тестов" : "К заданиям")));
    window.scrollTo(0, 0);
  }

  async function history() {
    loading();
    try {
      const att = await must(sb.from("attempts").select("*, tests(title,level)").eq("user_id", me.user.id).order("created_at", { ascending: false }).limit(50));
      $app.innerHTML = `${header()}<h1>Мои результаты</h1>
        ${att.length ? `<p class="sub">Последние прохождения.</p>${att.map((a) => `<div class="task static"><span class="task-main"><b>${esc(a.tests?.title)}</b>
          <small>${new Date(a.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</small></span>
          <span class="task-side"><span class="chip ${pctOf(a) >= 70 ? "ok" : "mid"}">${a.score}/${a.total}</span></span></div>`).join("")}`
          : `<p class="sub">Вы ещё не проходили тесты. Начните с вкладки «Задания».</p>`}
        ${navBar("hist")}`;
      on("out", () => sb.auth.signOut()); bindNav();
    } catch (e) { fail(e); }
  }

  // ---------- карточки (интервальное повторение) ----------
  async function flashcards() {
    try {
      const [words, prog] = await Promise.all([must(sb.from("words").select("*")), must(sb.from("card_progress").select("*"))]);
      const pm = new Map(prog.map((p) => [p.word_id, p]));
      const queue = shuffle(words.filter((w) => !pm.has(w.id) || pm.get(w.id).due <= today())).slice(0, 20);
      if (!queue.length) {
        $app.innerHTML = `<h1>Слова</h1><p class="sub">На сегодня всё повторено. 🎉 Возвращайтесь завтра!</p>${navBar("cards")}`;
        return bindNav();
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
            <div class="row"><button class="btn" id="home">К заданиям</button></div>`;
          on("home", home);
        }
      };
      show(false);
    } catch (e) { fail(e); }
  }

  // ---------- панель учителя ----------
  function tabs(cur) {
    const items = [["tests", "📝", "Тесты"], ["students", "👥", "Ученики"], ["words", "🃏", "Слова"], ["results", "📈", "Результаты"], ["check", "🧪", "Проверка"]];
    return `${header('<button class="link" id="prev">👁 Как видит ученик</button> ')}
      <nav class="nav" aria-label="Панель учителя">${items.map(([k, i, t]) =>
        `<button data-tab="${k}" class="${k === cur ? "on" : ""}" ${k === cur ? 'aria-current="page"' : ""}><span class="ni">${i}</span>${t}</button>`).join("")}</nav>`;
  }
  function bindTabs() {
    on("out", () => sb.auth.signOut());
    on("prev", () => { me.preview = true; home(); });
    $app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => teacher(b.dataset.tab));
  }

  async function teacher(tab) {
    try {
      if (tab === "tests") return teacherTests();
      if (tab === "students") return teacherStudents();
      if (tab === "check") return teacherCheck();
      if (tab === "words") return teacherWords();
      return teacherResults();
    } catch (e) { fail(e); }
  }

  async function teacherTests() {
    const [tests, logs] = await Promise.all([
      must(sb.from("tests").select("*, questions(count)").order("created_at", { ascending: false })),
      must(sb.from("agent_log").select("*").eq("seen", false).order("created_at", { ascending: false }).limit(8))]);
    const icon = { draft: "📝", question: "❓", error: "⚠️", info: "ℹ️" };
    $app.innerHTML = `${tabs("tests")}
      ${logs.length ? `<div class="q" style="margin-bottom:14px"><b>🤖 Помощник сообщает</b>
        ${logs.map((l) => `<p style="margin:8px 0 0;font-size:15px">${icon[l.kind] || ""} ${esc(l.message)}${l.test_id ? ` <button class="link" data-e="${l.test_id}">Открыть</button>` : ""}${l.kind === "published" && l.test_id ? ` <button class="link" data-unpub="${l.test_id}">Снять с публикации</button>` : ""}</p>`).join("")}
        <div class="row"><button class="btn sm alt" id="seen">Понятно, скрыть</button></div></div>` : ""}
      <p class="hint">Новые тесты сначала черновики: их видите только вы. Чтобы ученик увидел тест, откройте его, поставьте «Опубликован» и отметьте ученика (здесь или во вкладке «Ученики»).</p>
      <div class="row" style="margin:0 0 12px"><button class="btn sm" id="new">+ Новый тест</button><button class="btn sm alt" id="imp">⬆ Загрузить тест (JSON)</button></div>
      ${tests.map((t) => `<div class="item"><span class="badge">${t.level}</span><span class="badge ${t.published ? "" : "off"}">${t.published ? "опубликован" : "черновик"}</span>
        <b>${esc(t.title)}</b><br><small>${esc(t.description)} · вопросов: ${t.questions[0].count}</small>
        <div class="row"><button class="btn sm alt" data-e="${t.id}">Редактировать</button></div></div>`).join("") || `<p class="sub">Тестов пока нет.</p>`}`;
    bindTabs();
    on("imp", importView);
    $app.querySelectorAll("[data-unpub]").forEach((b) => b.onclick = async () => {
      if (!confirm("Снять тест с публикации? Ученики перестанут его видеть.")) return;
      const { error } = await sb.from("tests").update({ published: false }).eq("id", b.dataset.unpub);
      if (error) { alert("Не удалось: " + error.message); return; }
      teacherTests();
    });
    on("seen", async () => { await sb.from("agent_log").update({ seen: true }).in("id", logs.map((l) => l.id)); teacherTests(); });
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
        const f = b.closest(".item"), type = f.querySelector(".qt").value, msg = f.querySelector(".err");
        const lines = (sel) => f.querySelector(sel).value.split("\n").map((x) => x.trim()).filter(Boolean);
        const options = type === "input" ? [] : lines(".qo"), answers = lines(".qa");
        const bad = !answers.length ? "Укажите правильный ответ."
          : type === "choice" && (answers.length !== 1 || !options.includes(answers[0])) ? "Для выбора нужен один ответ, совпадающий с вариантом."
          : type === "multi" && (answers.length < 2 || answers.length >= options.length || !answers.every((a) => options.includes(a))) ? "Для «отметить все» нужно ≥2 верных (не все), каждый из вариантов."
          : type !== "input" && options.length < 2 ? "Нужно минимум 2 варианта." : "";
        if (bad) { msg.style.color = "var(--bad)"; msg.textContent = bad; return; }
        const { error } = await sb.from("questions").update({ type, prompt: f.querySelector(".qp").value, options, answer: answers[0], answers: type === "choice" ? [] : answers,
          explain: f.querySelector(".qx").value, task_title: f.querySelector(".qtt").value, task_instruction: f.querySelector(".qti").value }).eq("id", b.dataset.qs);
        msg.style.color = error ? "var(--bad)" : "var(--ok)"; msg.textContent = error ? error.message : "Сохранено";
      });
      $app.querySelectorAll("[data-qd]").forEach((b) => b.onclick = async () => {
        if (confirm("Удалить вопрос?")) { await must(sb.from("questions").delete().eq("id", b.dataset.qd)); editTest(id); }
      });
    } catch (e) { fail(e); }
  }

  function qForm(q) {
    const t = q.type === "type" ? "input" : q.type;
    const ans = t === "choice" ? [q.answer] : (Array.isArray(q.answers) && q.answers.length ? q.answers : [q.answer]);
    return `<div class="item">
      <label class="field">Тип<select class="qt"><option value="choice" ${t === "choice" ? "selected" : ""}>Выбор ответа</option><option value="multi" ${t === "multi" ? "selected" : ""}>Отметить все верные</option><option value="input" ${t === "input" ? "selected" : ""}>Ввод слова</option></select></label>
      <label class="field">Задание (заголовок, необязательно)<input type="text" class="qtt" value="${esc(q.task_title)}"></label>
      <label class="field">Инструкция к заданию (необязательно)<input type="text" class="qti" value="${esc(q.task_instruction)}"></label>
      <label class="field">Вопрос (в «Ввод слова» нужен пропуск ___)<input type="text" class="qp" value="${esc(q.prompt)}"></label>
      <label class="field">Варианты (по одному в строке; для выбора и «отметить все»)<textarea class="qo">${esc((q.options || []).join("\n"))}</textarea></label>
      <label class="field">Правильный ответ(ы) (по одному в строке; для «Выбор ответа» — один)<textarea class="qa">${esc(ans.join("\n"))}</textarea></label>
      <label class="field">Пояснение (необязательно)<input type="text" class="qx" value="${esc(q.explain)}"></label>
      <div class="err"></div>
      <div class="row"><button class="btn sm" data-qs="${q.id}">Сохранить</button><button class="btn sm danger" data-qd="${q.id}">Удалить</button></div></div>`;
  }

  // ---------- импорт теста из JSON (формат генератора polish-tests) ----------
  async function importView() {
    const students = await must(sb.from("profiles").select("id,display_name").eq("role", "student").order("display_name"));
    $app.innerHTML = `<div class="top"><button class="link" id="back">← К тестам</button><span>Загрузка теста</span></div>
      <div class="q">
        <p class="hint">Загрузите файл .json (его делает генератор) или вставьте текст. Тест появится черновиком — его можно проверить и поправить.</p>
        <label class="field">Файл<input type="file" id="fi" accept=".json,application/json"></label>
        <label class="field">…или вставьте JSON<textarea id="ft" style="min-height:140px" spellcheck="false"></textarea></label>
        <label class="field">Уровень<select id="fl"><option>A2</option><option>B1</option></select></label>
        <div class="field">Кому назначить (необязательно):
          ${students.map((p) => `<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" data-as="${p.id}"> ${esc(p.display_name)}</label>`).join("") || "<i>Учеников пока нет</i>"}</div>
        <label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="fp"> Сразу опубликовать</label>
        <div class="err" id="er"></div>
        <button class="btn" id="go">Загрузить</button>
      </div>`;
    on("back", teacherTests);
    $("fi").onchange = async (e) => { const f = e.target.files[0]; if (f) $("ft").value = await f.text(); };
    on("go", async () => {
      const er = $("er"); er.style.color = "var(--bad)";
      let t;
      try { t = JSON.parse($("ft").value); } catch (e) { er.textContent = "Не удалось прочитать JSON: " + e.message; return; }
      const errs = window.validateTest(t);
      if (errs.length) { er.innerHTML = "Тест не прошёл проверку:<br>• " + errs.slice(0, 12).map(esc).join("<br>• "); return; }
      try {
        const test = await must(sb.from("tests").insert({ title: t.topic + (t.student ? ` (${t.student})` : ""), description: t.created ? "Создан " + t.created : "", level: $("fl").value, published: $("fp").checked }).select().single());
        let pos = 0;
        const rows = t.tasks.flatMap((task) => task.questions.map((q) => ({
          test_id: test.id, position: ++pos, type: q.type, prompt: q.prompt, options: q.options || [],
          answer: Array.isArray(q.answer) ? q.answer[0] : q.answer, answers: q.type === "choice" ? [] : q.answer,
          explain: q.explanation_ru, task_title: task.title, task_instruction: task.instruction_ru })));
        await must(sb.from("questions").insert(rows));
        const ids = [...$app.querySelectorAll("[data-as]:checked")].map((c) => c.dataset.as);
        if (ids.length) await must(sb.from("test_assignments").insert(ids.map((u) => ({ test_id: test.id, user_id: u }))));
        editTest(test.id);
      } catch (e) { er.textContent = "Ошибка сохранения: " + e.message; }
    });
  }

  async function setAssign(testId, userId, on, box) {
    const q = on ? sb.from("test_assignments").upsert({ test_id: testId, user_id: userId })
                 : sb.from("test_assignments").delete().eq("test_id", testId).eq("user_id", userId);
    const { error } = await q;
    if (error) { box.checked = !on; alert("Не удалось сохранить: " + error.message); }
  }

  // ---------- личные ссылки учеников ----------
  async function callFn(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(CFG.url + "/functions/v1/students", { method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.key, ...(session ? { Authorization: "Bearer " + session.access_token } : {}) },
      body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Ошибка " + r.status);
    return j;
  }
  const inviteUrl = (token) => location.origin + location.pathname + "#invite=" + token;

  function showLink(name, token) {
    const url = inviteUrl(token);
    $app.innerHTML = `<div class="top"><button class="link" id="back">← К ученикам</button><span>Ссылка для входа</span></div>
      <div class="q">
        <h2>${esc(name)}</h2>
        <p class="hint">Отправьте эту ссылку ученику. Открыв её, он сразу окажется в приложении и больше не будет входить заново. Ссылка личная — не публикуйте её.</p>
        <input type="text" id="lk" readonly value="${esc(url)}" onfocus="this.select()">
        <div class="row"><button class="btn" id="cp">Скопировать</button></div>
        <div class="err" id="er"></div>
      </div>`;
    on("back", teacherStudents);
    on("cp", async () => {
      try { await navigator.clipboard.writeText(url); $("er").style.color = "var(--ok)"; $("er").textContent = "Скопировано"; }
      catch { $("lk").select(); $("er").textContent = "Выделено — нажмите «Копировать» в меню телефона."; }
    });
  }

  function showCredentials(r) {
    const url = location.origin + location.pathname;
    const text = `Здравствуйте, ${r.name}! 👋\nДля занятий польским есть приложение с заданиями:\n${url}\n\nВход: ${r.email}\nПароль: ${r.password}\n\nВойти нужно один раз, приложение запомнит вас.`;
    const mail = `mailto:${r.email}?subject=${encodeURIComponent("Доступ к заданиям по польскому")}&body=${encodeURIComponent(text)}`;
    $app.innerHTML = `<div class="top"><button class="link" id="back">← К ученикам</button><span>Приглашение</span></div>
      <div class="q"><h2>✅ Ученик добавлен</h2>
        <p class="hint">Отправьте это сообщение ученику. Пароль показывается один раз; если потеряется, в списке будет кнопка «🔑 Новый пароль».</p>
        <textarea id="inv" readonly style="min-height:190px">${esc(text)}</textarea>
        <div class="row"><button class="btn" id="cp">Скопировать приглашение</button><a class="btn alt" href="${esc(mail)}" style="text-decoration:none">✉ Открыть письмо</a></div>
        <div class="err" id="er"></div></div>`;
    on("back", teacherStudents);
    on("cp", async () => { try { await navigator.clipboard.writeText(text); $("er").style.color = "var(--ok)"; $("er").textContent = "Скопировано. Вставьте в мессенджер."; } catch { $("inv").select(); $("er").textContent = "Выделено: скопируйте вручную."; } });
  }

  function showPassword(p, password) {
    $app.innerHTML = `<div class="top"><button class="link" id="back">← К ученикам</button><span>Новый пароль</span></div>
      <div class="q"><h2>${esc(p.display_name)}</h2>
        <p class="hint">Отправьте ученику: вход по email <b>${esc(p.email)}</b> и этому паролю. Пароль показывается один раз.</p>
        <input type="text" id="pwv" readonly value="${esc(password)}" onfocus="this.select()" style="font-size:24px;letter-spacing:2px">
        <div class="row"><button class="btn" id="cp">Скопировать</button></div><div class="err" id="er"></div></div>`;
    on("back", teacherStudents);
    on("cp", async () => { try { await navigator.clipboard.writeText(password); $("er").style.color = "var(--ok)"; $("er").textContent = "Скопировано"; } catch { $("pwv").select(); } });
  }

  async function teacherStudents() {
    const [profs, tests, asg, invs, allowed] = await Promise.all([
      must(sb.from("profiles").select("*").order("display_name")),
      must(sb.from("tests").select("id,title,level,published,for_all").order("level").order("title")),
      must(sb.from("test_assignments").select("*")),
      must(sb.from("student_invites").select("*")),
      must(sb.from("allowed_emails").select("*").order("created_at"))]);
    const registered = new Set(profs.map((p) => p.email).filter(Boolean));
    const pending = allowed.filter((a) => !registered.has(a.email));
    const has = new Set(asg.map((a) => a.test_id + ":" + a.user_id));
    const invOf = Object.fromEntries(invs.map((i) => [i.user_id, i.token]));
    $app.innerHTML = `${tabs("students")}
      <div class="q" style="margin-bottom:14px">
        <b>Добавить ученика</b>
        <p class="hint">Впишите имя и email. Приложение создаст доступ и покажет готовое приглашение со ссылкой, логином и паролем: его остаётся отправить ученику (мессенджер или почта).</p>
        <label class="field">Имя<input type="text" id="an" placeholder="Например, Юлия"></label>
        <label class="field">Email<input type="text" id="ae" placeholder="email ученика" inputmode="email" autocapitalize="off"></label>
        <div class="row" style="margin:0"><button class="btn sm" id="aa">Создать доступ</button></div>
        <div class="err" id="aer"></div>
        ${pending.length ? `<p class="hint" style="margin-top:10px">Ждут регистрации:</p>${pending.map((a) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:15px"><span>${esc(a.email)}</span><button class="link" data-del="${esc(a.email)}">убрать</button></div>`).join("")}` : ""}
      </div>
      <div class="row" style="margin:0 0 12px"><button class="btn sm alt" id="inv">+ Ученик без почты (по ссылке)</button></div>
      ${profs.map((p) => `<div class="item"><b>${esc(p.display_name)}</b>${p.email ? ` <small>${esc(p.email)}</small>` : ""}
        <select data-role="${p.id}" style="width:auto;margin-left:8px" ${p.id === me.user.id ? "disabled" : ""}>
          <option value="student" ${p.role === "student" ? "selected" : ""}>ученик</option>
          <option value="teacher" ${p.role === "teacher" ? "selected" : ""}>учитель</option></select>
        ${p.role === "student" && p.email ? `<button class="link" data-pw="${p.id}">🔑 Новый пароль</button>` : ""}
        ${p.role === "student" ? (invOf[p.id]
          ? `<button class="link" data-link="${p.id}">🔗 Ссылка</button> <button class="link" data-newlink="${p.id}">↻ Новая</button>`
          : `<button class="link" data-newlink="${p.id}">🔗 Создать ссылку</button>`) : ""}
        ${p.role === "student" ? `<div style="margin-top:8px">${tests.map((t) => `<label style="display:flex;gap:8px;align-items:center;font-size:14px">
          <input type="checkbox" data-t="${t.id}" data-u="${p.id}" ${has.has(t.id + ":" + p.id) ? "checked" : ""}>
          <span class="badge">${t.level}</span>${esc(t.title)}${t.for_all ? " <small>(доступен всем)</small>" : ""}${t.published ? "" : " <small>(черновик)</small>"}</label>`).join("") || "<small>Тестов нет</small>"}</div>` : ""}
      </div>`).join("")}`;
    bindTabs();
    $app.querySelectorAll("[data-t]").forEach((c) => c.onchange = () => setAssign(c.dataset.t, c.dataset.u, c.checked, c));
    on("aa", async () => {
      const email = $("ae").value.trim().toLowerCase(), name = $("an").value.trim(), er = $("aer");
      er.style.color = "var(--bad)";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { er.textContent = "Проверьте email."; return; }
      $("aa").disabled = true; er.textContent = "";
      try { showCredentials(await callFn({ action: "add_student", email, name })); }
      catch (e) { er.textContent = e.message; $("aa").disabled = false; }
    });
    $app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (confirm("Убрать " + b.dataset.del + " из списка? Он не сможет зарегистрироваться.")) {
        await must(sb.from("allowed_emails").delete().eq("email", b.dataset.del)); teacherStudents();
      }
    });
    $app.querySelectorAll("[data-pw]").forEach((b) => b.onclick = async () => {
      if (!confirm("Задать ученику новый пароль? Старый перестанет работать.")) return;
      try { const r = await callFn({ action: "set_password", user_id: b.dataset.pw }); showPassword(profs.find((p) => p.id === b.dataset.pw), r.password); }
      catch (e) { alert("Не удалось: " + e.message); }
    });
    on("inv", async () => {
      const name = (prompt("Имя ученика:") || "").trim();
      if (!name) return;
      try { const r = await callFn({ action: "invite", name }); showLink(name, r.token); } catch (e) { alert("Не удалось: " + e.message); }
    });
    const nameOf = (id) => profs.find((p) => p.id === id)?.display_name || "";
    $app.querySelectorAll("[data-link]").forEach((b) => b.onclick = () => showLink(nameOf(b.dataset.link), invOf[b.dataset.link]));
    $app.querySelectorAll("[data-newlink]").forEach((b) => b.onclick = async () => {
      if (invOf[b.dataset.newlink] && !confirm("Старая ссылка перестанет работать. Создать новую?")) return;
      try { const r = await callFn({ action: "regenerate", user_id: b.dataset.newlink }); showLink(nameOf(b.dataset.newlink), r.token); } catch (e) { alert("Не удалось: " + e.message); }
    });
    $app.querySelectorAll("[data-role]").forEach((sel) => sel.onchange = async () => {
      const { error } = await sb.from("profiles").update({ role: sel.value }).eq("id", sel.dataset.role);
      if (error) alert("Не удалось сохранить: " + error.message);
      teacherStudents();
    });
  }

  // ---------- «Проверка»: учитель решает любые тесты (в том числе черновики), результат не сохраняется ----------
  async function teacherCheck() {
    const tests = await must(sb.from("tests").select("*, questions(count)").order("created_at", { ascending: false }));
    $app.innerHTML = `${tabs("check")}<h1>Проверка тестов</h1>
      <p class="sub">Пройдите тест как ученик, чтобы увидеть, как он выглядит и работает. Здесь доступны и черновики. Результат не сохраняется и ученикам не виден.</p>
      ${tests.map((t) => `<button class="task" data-dry="${t.id}"><span class="task-main"><b>${esc(t.title)}</b><small>${esc(t.description || "")} · вопросов: ${t.questions[0].count}</small></span>
        <span class="task-side"><span class="chip ${t.published ? "ok" : "mid"}">${t.published ? "опубликован" : "черновик"}</span><small>Пройти пробно</small></span></button>`).join("") || `<p class="hint">Тестов пока нет.</p>`}`;
    bindTabs();
    $app.querySelectorAll("[data-dry]").forEach((b) => b.onclick = () => startTest(tests.find((t) => t.id === b.dataset.dry), { dry: true }));
  }

  async function teacherWords() {
    const [words, profs, prog] = await Promise.all([
      must(sb.from("words").select("*").order("level").order("topic").order("pl")),
      must(sb.from("profiles").select("id,display_name").eq("role", "student").order("display_name")),
      must(sb.from("card_progress").select("*"))]);
    const byId = new Map(words.map((w) => [w.id, w])), t0 = today();
    const stats = profs.map((p) => {
      const mine = prog.filter((c) => c.user_id === p.id && byId.has(c.word_id));
      const learned = mine.filter((c) => c.box >= 4).length;
      return { p, started: mine.length, learned, learning: mine.length - learned,
        fresh: words.length - mine.length, due: words.length - mine.length + mine.filter((c) => c.due <= t0).length,
        hard: mine.filter((c) => c.box === 1).map((c) => byId.get(c.word_id).pl) };
    });
    $app.innerHTML = `${tabs("words")}
      <h1>Слова</h1>
      <h3 class="sec">Как ученики учат слова</h3>
      ${stats.length ? stats.map((x) => `<div class="item"><b>${esc(x.p.display_name)}</b>
        <div class="bar" style="margin:8px 0"><i style="width:${words.length ? Math.round(x.learned / words.length * 100) : 0}%"></i></div>
        <small>Выучено: <b>${x.learned}</b> из ${words.length} · в процессе: ${x.learning} · ещё не начато: ${x.fresh} · к повторению сегодня: ${x.due}</small>
        ${x.hard.length ? `<br><small>Сейчас не даются: ${esc(x.hard.slice(0, 8).join(", "))}${x.hard.length > 8 ? " …" : ""}</small>` : ""}</div>`).join("")
        : `<p class="hint">Учеников пока нет. Когда они начнут проходить карточки, здесь появится прогресс.</p>`}
      <p class="hint">«Выучено» — слово, которое ученик уже несколько раз подряд назвал правильно. «Не даются» — слова, на которые он ответил «не знал» в последний раз.</p>

      <h3 class="sec">Добавить слово</h3>
      <div class="q">
        <label class="field">Слово по-польски<input type="text" id="nw" autocapitalize="off"></label>
        <label class="field">Перевод<input type="text" id="nr"></label>
        <label class="field">Пример (необязательно)<input type="text" id="ne"></label>
        <div class="row" style="align-items:center;margin-top:0">
          <select id="nl" style="width:auto"><option>A2</option><option>B1</option></select>
          <input type="text" id="nt" placeholder="Тема (необязательно)" style="flex:1">
          <button class="btn sm" id="na">Добавить</button></div>
        <div class="err" id="aer"></div>
        <details style="margin-top:12px"><summary>Добавить много слов списком</summary>
          <p class="hint">Одно слово в строке: <code>слово ; перевод ; пример</code></p>
          <textarea id="bulk" placeholder="zamierzać ; намереваться ; Zamierzam zmienić pracę."></textarea>
          <div class="row"><button class="btn sm alt" id="bs">Добавить списком</button></div><div class="err" id="er"></div></details>
      </div>

      <h3 class="sec">Все слова (${words.length})</h3>
      <div id="wl">${words.map((w) => `<div class="item" data-w="${w.id}"><span class="badge">${w.level}</span><b>${esc(w.pl)}</b> — ${esc(w.ru)}
        ${w.example ? `<br><small>${esc(w.example)}</small>` : ""}
        <div class="row"><button class="btn sm alt" data-we="${w.id}">Изменить</button><button class="btn sm danger" data-wd="${w.id}">Удалить</button></div></div>`).join("")}</div>`;
    bindTabs();
    on("na", async () => {
      const pl = $("nw").value.trim(), ru = $("nr").value.trim();
      if (!pl || !ru) { $("aer").style.color = "var(--bad)"; $("aer").textContent = "Заполните слово и перевод."; return; }
      const { error } = await sb.from("words").insert({ pl, ru, example: $("ne").value.trim(), level: $("nl").value, topic: $("nt").value.trim() });
      if (error) { $("aer").style.color = "var(--bad)"; $("aer").textContent = error.message; return; }
      teacherWords();
    });
    on("bs", async () => {
      const rows = $("bulk").value.split("\n").map((l) => l.split(";").map((x) => x.trim())).filter((q) => q[0] && q[1])
        .map((q) => ({ pl: q[0], ru: q[1], example: q[2] || "", level: $("nl").value, topic: $("nt").value.trim() }));
      if (!rows.length) { $("er").style.color = "var(--bad)"; $("er").textContent = "Нет строк в формате «слово ; перевод»."; return; }
      const { error } = await sb.from("words").insert(rows);
      if (error) { $("er").style.color = "var(--bad)"; $("er").textContent = error.message; return; }
      teacherWords();
    });
    $app.querySelectorAll("[data-wd]").forEach((b) => b.onclick = async () => {
      if (confirm("Удалить слово? У учеников пропадёт и его прогресс.")) { await must(sb.from("words").delete().eq("id", b.dataset.wd)); teacherWords(); }
    });
    $app.querySelectorAll("[data-we]").forEach((b) => b.onclick = () => {
      const w = byId.get(b.dataset.we), box = b.closest(".item");
      box.innerHTML = `<label class="field">Слово<input type="text" class="ew" value="${esc(w.pl)}"></label>
        <label class="field">Перевод<input type="text" class="er2" value="${esc(w.ru)}"></label>
        <label class="field">Пример<input type="text" class="ee" value="${esc(w.example)}"></label>
        <label class="field">Уровень<select class="el"><option ${w.level === "A2" ? "selected" : ""}>A2</option><option ${w.level === "B1" ? "selected" : ""}>B1</option></select></label>
        <div class="err"></div><div class="row"><button class="btn sm sv">Сохранить</button><button class="btn sm alt cn">Отмена</button></div>`;
      box.querySelector(".cn").onclick = teacherWords;
      box.querySelector(".sv").onclick = async () => {
        const pl = box.querySelector(".ew").value.trim(), ru = box.querySelector(".er2").value.trim();
        if (!pl || !ru) { box.querySelector(".err").textContent = "Заполните слово и перевод."; return; }
        const { error } = await sb.from("words").update({ pl, ru, example: box.querySelector(".ee").value.trim(), level: box.querySelector(".el").value }).eq("id", w.id);
        if (error) { box.querySelector(".err").textContent = error.message; return; }
        teacherWords();
      };
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
  let claiming = false;
  async function route(session) {
    if (!session) { me.user = null; me.profile = null; return authView(); }
    me.user = session.user;
    try { await loadProfile(); home(); } catch (e) { fail(e); }
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (claiming) return;
    if (event === "SIGNED_IN" && session && me.user?.id === session.user.id) return; // обновление токена/возврат на вкладку
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => route(session), 0);
  });

  // Личная ссылка вида #invite=<token>: обмениваем токен на сессию и убираем его из адресной строки.
  const m = location.hash.match(/^#invite=([0-9a-f-]{36})$/i);
  if (m) {
    claiming = true;
    $app.innerHTML = `<p class="sub">Входим…</p>`;
    (async () => {
      try {
        const { token_hash } = await callFn({ action: "claim", token: m[1] });
        const { data, error } = await sb.auth.verifyOtp({ token_hash, type: "magiclink" });
        if (error) throw error;
        window.history.replaceState(null, "", location.pathname);
        claiming = false;
        route(data.session);
      } catch (e) {
        claiming = false;
        $app.innerHTML = `<p class="err">Не удалось войти по ссылке: ${esc(e.message)}</p><p class="sub">Попросите учителя прислать новую ссылку.</p>`;
      }
    })();
  }
})();

(() => {
  const sb = supabase.createClient(CFG.url, CFG.key);
  const $app = document.getElementById("app");
  const me = { user: null, profile: null, preview: false };
  const INTERVALS = [0, 1, 3, 7, 14]; // дни до повтора для коробок 1..5

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
  // род существительного: указатель и метка
  const ART = { m: "ten", "ż": "ta", n: "to" };
  const GCLASS = { m: "gm", "ż": "gz", n: "gn" };
  const withArt = (w) => (w.gender ? ART[w.gender] + " " + w.pl : w.pl);
  const gchip = (g) => (g ? `<span class="gc ${GCLASS[g]}">${g}</span>` : "");
  const bareWord = (s) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^(ten|ta|to) /, "");
  const gOfArt = (a) => ({ ten: "m", ta: "ż", to: "n" })[String(a).split(" ")[0]];
  // "ta przychodnia" -> {gender:"ż", pl:"przychodnia"}
  const parsePl = (raw) => { const m = raw.trim().match(/^(ten|ta|to)\s+(.+)$/i); return m ? { gender: gOfArt(m[1].toLowerCase()), pl: m[2].trim() } : { gender: null, pl: raw.trim() }; };
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
        ${reg ? "" : `<p style="text-align:center;margin:14px 0 0"><button type="button" class="link" id="forgot">Забыли пароль?</button></p>`}
      </form>`;
    on("forgot", showForgot);

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

  function showForgot() {
    $app.innerHTML = `<div class="top"><button class="link" id="back">← Назад ко входу</button></div>
      <h1>Забыли пароль?</h1>
      <p class="sub">Выберите, как восстановить доступ.</p>
      <div class="q">
        <h3>1. Новый пароль от учителя</h3>
        <p class="hint">Самый надёжный способ. Ученик просит учителя нажать у себя «🔑 Новый пароль» в разделе «Ученики». Учитель просит об этом другого учителя (например, владельца приложения). Новый пароль приходит сообщением, потом его можно сменить на свой в меню «⋯».</p>
      </div>
      <div class="q" style="margin-top:12px">
        <h3>2. Ссылка на почту</h3>
        <p class="hint">Мы отправим письмо со ссылкой для нового пароля. Письмо может не дойти: отправка почты пока работает не для всех адресов.</p>
        <label class="field">Ваш email<input type="text" id="fe" autocomplete="email" inputmode="email" autocapitalize="off"></label>
        <div class="err" id="fer"></div>
        <button class="btn" id="fs" style="width:100%">Отправить ссылку</button>
      </div>`;
    on("back", authView);
    on("fs", async () => {
      const email = $("fe").value.trim(), er = $("fer");
      er.style.color = "var(--bad)";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { er.textContent = "Проверьте email."; return; }
      $("fs").disabled = true; er.textContent = "";
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      $("fs").disabled = false;
      if (error) { er.textContent = /rate|лимит|limit/i.test(error.message) ? "Письмо сейчас отправить не получается. Используйте способ 1." : error.message; return; }
      er.style.color = "var(--ok)"; er.textContent = "Если такой email есть в системе, письмо отправлено. Не пришло за несколько минут: используйте способ 1.";
    });
  }

  // уменьшаем фото до 160×160 (по центру) и храним прямо в профиле
  function resizeImage(file, size = 160) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = c.height = size;
        const k = Math.min(img.width, img.height), sx = (img.width - k) / 2, sy = (img.height - k) / 2;
        c.getContext("2d").drawImage(img, sx, sy, k, k, 0, 0, size, size);
        URL.revokeObjectURL(url); resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось прочитать картинку")); };
      img.src = url;
    });
  }
  function showProfile() {
    let avatar = me.profile.avatar || null;
    const draw = () => { $("pv").outerHTML = avatarHtml({ avatar, display_name: $("pn").value || me.profile.display_name }, "avatar big").replace("<span", '<span id="pv"'); };
    $app.innerHTML = `<div class="top"><button class="link" id="back">← Назад</button><span>Мой профиль</span></div>
      <div class="q" style="text-align:center">
        <span id="pv"></span>
        <div class="row" style="justify-content:center"><label class="btn alt sm" style="cursor:pointer">Выбрать фото<input type="file" id="pf" accept="image/*" hidden></label><button class="btn alt sm" id="pd">Убрать фото</button></div>
        <label class="field" style="text-align:left;margin-top:14px">Имя<input type="text" id="pn" maxlength="60" value="${esc(me.profile.display_name)}"></label>
        <p class="hint" style="text-align:left;margin:0 0 6px">Вход: ${esc(me.profile.email || "по личной ссылке")} · ${isTeacher() ? "учитель" : "ученик"}</p>
        <div class="err" id="per"></div>
        <button class="btn" id="ps" style="width:100%">Сохранить</button></div>`;
    draw();
    on("back", home);
    $("pn").oninput = () => { if (!avatar) draw(); };
    $("pf").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { avatar = await resizeImage(f); draw(); $("per").textContent = ""; } catch (err) { $("per").style.color = "var(--bad)"; $("per").textContent = err.message; }
    };
    on("pd", () => { avatar = null; draw(); });
    on("ps", async () => {
      const name = $("pn").value.trim().slice(0, 60), er = $("per");
      er.style.color = "var(--bad)";
      if (!name) { er.textContent = "Введите имя."; return; }
      $("ps").disabled = true; er.style.color = "var(--muted)"; er.textContent = "Сохраняем…";
      const { error } = await sb.from("profiles").update({ display_name: name, avatar }).eq("id", me.user.id);
      if (error) { er.style.color = "var(--bad)"; er.textContent = "Не удалось сохранить: " + error.message; $("ps").disabled = false; return; }
      me.profile.display_name = name; me.profile.avatar = avatar;
      er.style.color = "var(--ok)"; er.textContent = "Сохранено ✓"; setTimeout(home, 600);
    });
  }

  function showChangePassword(opts = {}) {
    $app.innerHTML = `${opts.recovery ? "" : `<div class="top"><button class="link" id="back">← Назад</button></div>`}
      <h1>${opts.welcome ? "Добро пожаловать!" : opts.recovery ? "Новый пароль" : "Сменить пароль"}</h1>
      <p class="sub">${opts.welcome ? "Придумайте пароль: с ним вы будете входить в приложение." : opts.recovery ? "Придумайте новый пароль для входа." : "Задайте свой пароль вместо временного."}</p>
      <form id="cf" class="q">
        <label class="field">Новый пароль (от 6 символов)
          <span class="pw"><input type="password" id="np" autocomplete="new-password" minlength="6" required>
          <button type="button" id="eye" class="eye" aria-label="Показать пароль">👁</button></span></label>
        <label class="field">Повторите пароль<input type="password" id="np2" autocomplete="new-password" minlength="6" required></label>
        <div class="err" id="cer"></div>
        <button class="btn" type="submit" style="width:100%">Сохранить пароль</button>
      </form>`;
    on("back", home);
    on("eye", () => { const i = $("np"); i.type = i.type === "password" ? "text" : "password"; });
    $("cf").onsubmit = async (e) => {
      e.preventDefault();
      const er = $("cer"); er.style.color = "var(--bad)";
      if ($("np").value !== $("np2").value) { er.textContent = "Пароли не совпадают."; return; }
      const { error } = await sb.auth.updateUser({ password: $("np").value });
      if (error) { er.textContent = /same|different/i.test(error.message) ? "Новый пароль должен отличаться от старого." : error.message; return; }
      er.style.color = "var(--ok)"; er.textContent = "Пароль изменён ✓";
      setTimeout(() => { recovering = false; sb.auth.getSession().then(({ data }) => route(data.session)); }, 900);
    };
  }

  async function loadProfile() {
    me.profile = await must(sb.from("profiles").select("*").eq("id", me.user.id).single());
  }

  const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => (w.match(/\p{L}/u) || [""])[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const avatarHtml = (p, cls = "avatar") => p?.avatar && /^data:image\//.test(p.avatar)
    ? `<span class="${cls}" style="padding:0;overflow:hidden"><img src="${esc(p.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></span>`
    : `<span class="${cls}">${esc(initials(p?.display_name))}</span>`;
  const curTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  function header(menu = "") {
    const n = me.profile.display_name;
    return `<div class="appbar"><div class="who">${avatarHtml(me.profile)}<span><b>${esc(n)}</b><small>${isTeacher() ? "учитель" : "ученик"}</small></span></div>
      <details class="menu"><summary aria-label="Меню">⋯</summary><div class="menu-pop">${menu}<button id="prof">👤 Мой профиль</button><button id="theme">${curTheme() === "dark" ? "☀️ Светлая тема" : "🌙 Тёмная тема"}</button><button id="chpw">🔑 Сменить пароль</button><button id="out">Выйти</button></div></details></div>`;
  }
  const bindHeader = () => { on("theme", () => { const t = curTheme() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch (e) {} const d = document.querySelector(".menu"); if (d) d.open = false; document.getElementById("theme") && (document.getElementById("theme").textContent = t === "dark" ? "☀️ Светлая тема" : "🌙 Тёмная тема"); }); on("out", () => sb.auth.signOut()); on("chpw", () => showChangePassword()); on("prof", showProfile); };
  // меню закрывается по клику вне него
  document.addEventListener("click", (e) => document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }));

  // ---------- навигация и состояния ----------
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
      bindHeader(); on("gf", flashcards); on("exitprev", () => { me.preview = false; teacher("tests"); }); bindNav();
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
      else if (q.answers.some((a) => /^(ten|ta|to) /i.test(a) && bareWord(a) === bareWord(given))) r.status = "gender"; // слово верно, род нет
    }
    if (r.correct) r.status = "ok";
    return r;
  }

  function feedback(q, r) {
    const why = q.explain ? h("span", { class: "why" }, q.explain) : null;
    if (r.correct) return h("div", { class: "fb ok" }, "✅ Верно! ", why);
    if (r.status === "gender") return h("div", { class: "fb bad" }, "❌ Слово верно, но род: ", h("b", {}, q.answers[0] + " (" + gOfArt(q.answers[0]) + ")"), why);
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
        w = { read: () => inp.value.trim() && inp.value, lock: (r) => { inp.disabled = true; inp.classList.add(r.status === "gender" ? "bad" : r.status); } };
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
    if (!run.dry) try { await must(sb.from("attempts").insert({ test_id: run.test.id, score, total, details: run.results.map((r) => ({
      task: r.q.task_title || "", type: r.q.type, prompt: r.q.prompt, given: r.given, right: r.q.answers, ok: r.correct, almost: r.status === "almost", why: r.q.explain || "" })) })); }
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
      bindHeader(); bindNav();
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
      let i = 0, known = 0, failed = 0, lastErr = "";
      const saved = ({ error }) => { if (error) { failed++; lastErr = error.message; const el = $("warn"); if (el) el.textContent = "⚠️ Ответ не сохранился: " + error.message; } };
      const show = (flipped) => {
        const w = queue[i];
        $app.innerHTML = `
          <div class="top"><button class="link" id="back">← Выйти</button><span>Карточки · ${i + 1}/${queue.length}</span></div>
          <div class="bar"><i style="width:${i / queue.length * 100}%"></i></div>
          <div class="q flash">
            <div class="w">${gchip(w.gender)}${esc(withArt(w))} <button class="say" id="say" aria-label="Прослушать">🔊</button></div>
            ${flipped ? `<div class="tr">${esc(w.ru)}</div>${w.example ? `<div class="ex">${esc(w.example)}</div>` : ""}` : ""}
          </div>
          <div class="row">${flipped
            ? `<button class="btn alt" id="no">Не знал</button><button class="btn" id="yes">Знал</button>`
            : `<button class="btn" id="flip">Показать перевод</button>`}</div>
          <p class="err" id="warn" style="text-align:center">${failed ? "⚠️ Ответ не сохранился: " + esc(lastErr) : ""}</p>`;
        on("back", home); on("say", () => speak(withArt(w)));
        on("flip", () => show(true));
        on("yes", () => rate(true)); on("no", () => rate(false));
      };
      const rate = async (ok) => {
        const w = queue[i], box = pm.get(w.id)?.box || 1;
        const nb = ok ? Math.min(5, box + 1) : 1;
        if (ok) known++;
        sb.from("card_progress").upsert({ user_id: me.user.id, word_id: w.id, box: nb, due: addDays(INTERVALS[nb - 1]), updated_at: new Date().toISOString() }).then(saved);
        sb.from("card_reviews").insert({ word_id: w.id, ok }).then(saved);
        if (++i < queue.length) show(false);
        else {
          $app.innerHTML = `<h1>Готово!</h1><div class="score">${known}/${queue.length}</div><p class="sub" style="text-align:center">слов вы знали</p>${failed ? `<p class="err" style="text-align:center">⚠️ Не все ответы сохранились (${esc(lastErr)}). Сообщите учителю.</p>` : `<p class="hint" style="text-align:center">Результат сохранён. Учитель видит ваш прогресс.</p>`}
            <div class="row"><button class="btn" id="home">К заданиям</button></div>`;
          on("home", home);
        }
      };
      show(false);
    } catch (e) { fail(e); }
  }

  // ---------- панель учителя ----------
  function tabs(cur) {
    const items = [["tests", "📝", "Тесты"], ["students", "👥", "Ученики"], ["words", "🃏", "Слова"], ["results", "📈", "Итоги"], ["check", "🧪", "Проба"]];
    return `${header('<button id="prev">👁 Как видит ученик</button>')}
      <nav class="nav" aria-label="Панель учителя">${items.map(([k, i, t]) =>
        `<button data-tab="${k}" class="${k === cur ? "on" : ""}" ${k === cur ? 'aria-current="page"' : ""}><span class="ni">${i}</span>${t}</button>`).join("")}</nav>`;
  }
  function bindTabs() {
    bindHeader();
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

  // ---------- слова недели: карточка одобрения ----------
  const WORDS_TEST = "Повседневные слова и фразы";
  const batchCard = (b) => `<div class="q wb" data-b="${b.id}" style="margin-bottom:16px">
    <b>🤖 Słówka na tydzień (${esc(b.profiles?.display_name || "—")}): ${b.items.length} słów — добавить?</b>
    <p class="hint" style="margin:4px 0 8px">Тема: ${esc(b.topic || "—")} · неделя с ${new Date(b.week).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}. Снимите галочку с лишних слов. Пока вы не нажмёте «Добавить», ничего не меняется.</p>
    <div class="checks">${b.items.map((it, i) => `<label><input type="checkbox" data-i="${i}" checked>
      <span>${gchip(it.gender)}<b>${esc(withArt(it))}</b> — ${esc(it.ru)}${it.pos ? ` <small>(${esc(it.pos)})</small>` : ""}</span></label>`).join("")}</div>
    <div class="err" data-berr></div>
    <div class="row"><button class="btn" data-badd>Добавить</button><button class="btn alt" data-brej>Отклонить</button></div></div>`;
  function bindBatch(b) {
    const box = $app.querySelector(`[data-b="${b.id}"]`); if (!box) return;
    const err = box.querySelector("[data-berr]");
    box.querySelector("[data-brej]").onclick = async () => {
      if (!confirm("Отклонить список недели? Слова не будут добавлены.")) return;
      const { error } = await sb.from("word_batches").update({ status: "rejected", decided_at: new Date().toISOString() }).eq("id", b.id);
      if (error) { err.textContent = error.message; return; }
      teacherTests();
    };
    box.querySelector("[data-badd]").onclick = async () => {
      const keep = [...box.querySelectorAll("[data-i]")].filter((c) => c.checked).map((c) => +c.dataset.i);
      if (!keep.length) { err.textContent = "Отметьте хотя бы одно слово или нажмите «Отклонить»."; return; }
      box.querySelector("[data-badd]").disabled = true; err.style.color = "var(--muted)"; err.textContent = "Добавляем…";
      try { const r = await approveBatch(b, keep); alert(`Готово: слов добавлено — ${r.words}, вопросов в тест — ${r.questions}.`); teacherTests(); }
      catch (e) { err.style.color = "var(--bad)"; err.textContent = "Не удалось: " + e.message; box.querySelector("[data-badd]").disabled = false; }
    };
  }
  const wordPrompt = (it) => it.gender ? `Напишите по-польски: ${it.demo ? it.demo + " " : ""}${it.ru}` : `Напишите по-польски: «${it.ru}»`;
  const wordAnswers = (it) => it.gender ? [withArt(it)] : [it.pl, ...(it.alts || [])];
  // Добавляет выбранные слова в «Слова» и вопросы в существующий тест; повторных слов не дублирует
  async function approveBatch(b, keep) {
    const items = keep.map((i) => b.items[i]);
    const tests = await must(sb.from("tests").select("id").eq("title", WORDS_TEST));
    if (tests.length !== 1) throw new Error(`тест «${WORDS_TEST}» не найден или их несколько`);
    const tid = tests[0].id;
    const [words, qs] = await Promise.all([must(sb.from("words").select("pl,gender")), must(sb.from("questions").select("*").eq("test_id", tid).order("position"))]);
    const key = (g, pl) => (g || "") + "|" + pl.trim().toLowerCase();
    const have = new Set(words.map((w) => key(w.gender, w.pl)));
    const wk = new Date(b.week).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" });
    const used = new Set(qs.map((q) => q.prompt));
    const fresh = items.filter((it) => !used.has(wordPrompt(it)));
    let pos = qs.reduce((m, q) => Math.max(m, q.position), 0);
    const rows = [], parts = Math.ceil(fresh.length / 5);
    fresh.forEach((it, i) => { const a = wordAnswers(it); rows.push({ test_id: tid, position: ++pos, type: "input", prompt: wordPrompt(it), options: [], answer: a[0], answers: a, explain: "",
      task_title: `Слова недели ${wk} · часть ${Math.floor(i / 5) + 1} из ${parts}`, task_instruction: "Напишите слово по-польски. У существительных добавляйте ten / ta / to." }); });
    const reviewTitle = `Повторение · ${wk}`;
    if (!qs.some((q) => q.task_title === reviewTitle)) {
      const pool = shuffle(qs.filter((q) => !q.task_title.startsWith("Повторение")).slice()).slice(0, 5);
      pool.forEach((q) => rows.push({ test_id: tid, position: ++pos, type: q.type, prompt: q.prompt, options: q.options, answer: q.answer, answers: q.answers, explain: q.explain, task_title: reviewTitle, task_instruction: "Слова из прошлых недель: повторение." }));
    }
    if (rows.length) await must(sb.from("questions").insert(rows).select("id"));
    const newWords = items.filter((it) => !have.has(key(it.gender, it.pl))).map((it) => ({ pl: it.pl, ru: it.ru, gender: it.gender || null, pos: it.pos || "", example: it.example || "", level: "B1", topic: b.topic || "" }));
    if (newWords.length) await must(sb.from("words").insert(newWords).select("id"));
    await must(sb.from("word_batches").update({ status: "approved", decided_at: new Date().toISOString() }).eq("id", b.id).select("id"));
    return { words: newWords.length, questions: rows.length };
  }

  // ---------- обновление теста: запрос → подготовка помощником → проверка → «Применить» ----------
  const MODE_TXT = { append: "дописать к тесту", replace: "заменить все вопросы" };
  function updateCard(u) {
    const t = u.tests?.title || "тест";
    if (u.status === "requested") return `<p class="hint" style="margin:0 0 12px">⏳ Запрос на обновление теста «${esc(t)}» (${MODE_TXT[u.mode]}) принят. Помощник подготовит вопросы при ближайшей проверке (каждый день в 17:00), и они появятся здесь на проверку.</p>`;
    const qs = u.questions || [];
    return `<div class="q" data-u="${u.id}" style="margin-bottom:16px"><b>🔄 Обновление теста «${esc(t)}»: ${qs.length} ${plural(qs.length, "вопрос", "вопроса", "вопросов")} — ${MODE_TXT[u.mode]}</b>
      ${u.note ? `<p class="hint" style="margin:4px 0">${esc(u.note)}</p>` : ""}
      <p class="hint" style="margin:4px 0 8px">Проверьте вопросы ниже. Пока вы не нажмёте «Применить», тест не меняется.${u.mode === "replace" ? " Старые вопросы будут удалены, результаты учеников сохранятся." : ""}</p>
      <details class="acc"><summary class="li"><span class="li-main"><b>Проверить вопросы</b><small>${qs.length} шт. с правильными ответами</small></span><span class="li-side chev">›</span></summary>
        <ul class="review">${qs.map((q, i) => `<li><b>${i + 1}. ${esc(q.prompt)}</b>${q.options?.length ? `<br><small>${q.options.map(esc).join(" · ")}</small>` : ""}<br>Верно: <span class="a">${esc((q.answers?.length ? q.answers : [q.answer]).join("; "))}</span>${q.explain ? `<br><small>${esc(q.explain)}</small>` : ""}</li>`).join("")}</ul></details>
      <div class="err" data-uerr></div>
      <div class="row"><button class="btn" data-uapply>Применить</button><button class="btn alt" data-udrop>Отклонить</button></div></div>`;
  }
  function bindUpdAsk(box) {
    const ask = box.querySelector("[data-uask]"), keep = box.querySelector("[data-ukeep]");
    const done = async (extra) => { await sb.from("agent_log").update({ seen: true }).eq("id", box.dataset.ul); teacherTests(); };
    keep.onclick = () => done();
    ask.onclick = () => {
      box.innerHTML = `<small>Как обновить?</small> <button class="btn sm" data-m="append">Дописать новые вопросы</button> <button class="btn sm alt" data-m="replace">Заменить все вопросы</button> <button class="link" data-mx>Отмена</button>`;
      box.querySelector("[data-mx]").onclick = teacherTests;
      box.querySelectorAll("[data-m]").forEach((b) => b.onclick = async () => {
        const { error } = await sb.from("test_updates").insert({ test_id: box.dataset.ut, mode: b.dataset.m, status: "requested" });
        if (error) { alert("Не удалось: " + error.message); return; }
        await done();
      });
    };
  }
  function bindUpdate(u) {
    const box = $app.querySelector(`[data-u="${u.id}"]`); if (!box) return;
    const err = box.querySelector("[data-uerr]");
    box.querySelector("[data-udrop]").onclick = async () => {
      if (!confirm("Отклонить обновление? Тест останется как есть.")) return;
      const { error } = await sb.from("test_updates").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", u.id);
      if (error) { err.textContent = error.message; return; }
      teacherTests();
    };
    box.querySelector("[data-uapply]").onclick = async () => {
      box.querySelector("[data-uapply]").disabled = true; err.style.color = "var(--muted)"; err.textContent = "Применяем…";
      try { const n = await applyUpdate(u); alert(`Готово: тест обновлён, добавлено вопросов — ${n}.`); teacherTests(); }
      catch (e) { err.style.color = "var(--bad)"; err.textContent = "Не удалось: " + e.message; box.querySelector("[data-uapply]").disabled = false; }
    };
  }
  // Сначала добавляем новые вопросы и только потом убираем старые, чтобы тест не остался пустым при сбое
  async function applyUpdate(u) {
    const qs = u.questions || [];
    if (!qs.length) throw new Error("в обновлении нет вопросов");
    const old = await must(sb.from("questions").select("id,position,prompt").eq("test_id", u.test_id).order("position"));
    let pos = old.reduce((m, q) => Math.max(m, q.position), 0);
    const have = new Set(old.map((q) => q.prompt));
    const rows = qs.filter((q) => u.mode === "replace" || !have.has(q.prompt)).map((q) => ({ test_id: u.test_id, position: ++pos, type: q.type, prompt: q.prompt, options: q.options || [],
      answer: q.answer, answers: q.answers || [], explain: q.explain || "", task_title: q.task_title || "", task_instruction: q.task_instruction || "" }));
    if (!rows.length) throw new Error("все вопросы уже есть в тесте");
    await must(sb.from("questions").insert(rows).select("id"));
    if (u.mode === "replace" && old.length) await must(sb.from("questions").delete().in("id", old.map((q) => q.id)).select("id"));
    await must(sb.from("test_updates").update({ status: "applied", decided_at: new Date().toISOString() }).eq("id", u.id).select("id"));
    return rows.length;
  }

  async function teacherTests() {
    const [tests, logs, states, batches, updates] = await Promise.all([
      must(sb.from("tests").select("*, questions(count)").order("created_at", { ascending: false })),
      must(sb.from("agent_log").select("*").eq("seen", false).order("created_at", { ascending: false }).limit(8)),
      must(sb.from("agent_state").select("checked_at").order("checked_at", { ascending: false }).limit(1)),
      must(sb.from("word_batches").select("*, profiles(display_name)").eq("status", "pending").order("week", { ascending: false })),
      must(sb.from("test_updates").select("*, tests(title)").in("status", ["requested", "ready"]).order("created_at"))]);
    const busy = new Set(updates.map((u) => u.test_id));
    const last = states[0] && new Date(states[0].checked_at), stale = !last || Date.now() - last > 2 * 864e5;
    const agentLine = `<p class="hint">🤖 Помощник проверял материалы: ${last ? last.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "ещё не проверял"}${stale ? ` <b style="color:var(--bad)">· давно не проверял, сообщите владельцу</b>` : ""}</p>`;
    const icon = { draft: "📝", published: "✅", question: "❓", error: "⚠️", info: "ℹ️" };
    $app.innerHTML = `${tabs("tests")}
      <h1>Тесты</h1>
      ${agentLine}
      ${batches.map(batchCard).join("")}
      ${updates.map(updateCard).join("")}
      ${logs.length ? `<div class="q" style="margin-bottom:16px"><b>🤖 Помощник сообщает</b>
        ${logs.map((l) => `<p style="margin:10px 0 0;font-size:15px">${icon[l.kind] || ""} ${esc(l.message)}${l.test_id ? ` <button class="link" data-e="${l.test_id}">Открыть</button>` : ""}${l.kind === "published" && l.test_id ? ` <button class="link" data-unpub="${l.test_id}">Снять с публикации</button>` : ""}${l.kind === "question" && l.test_id && !busy.has(l.test_id) ? ` <span class="upd" data-ul="${l.id}" data-ut="${l.test_id}"><button class="btn sm" data-uask>Обновить тест</button> <button class="btn sm alt" data-ukeep>Оставить как есть</button></span>` : ""}</p>`).join("")}
        <div class="row"><button class="btn sm alt" id="seen">Понятно, скрыть</button></div></div>` : ""}
      <div class="row" style="margin:0 0 16px"><button class="btn" id="new">＋ Новый тест</button><button class="btn alt" id="imp">Из файла</button></div>
      ${tests.length ? `<div class="list">${tests.map((t) => {
        const n = t.questions[0].count;
        return `<button class="li" data-e="${t.id}"><span class="li-main"><b>${esc(t.title)}</b><small><span class="badge">${t.level}</span>${n} ${plural(n, "вопрос", "вопроса", "вопросов")}</small></span>
          <span class="li-side"><span class="chip ${t.published ? "ok" : "off"}">${t.published ? "опубликован" : "черновик"}</span><span class="chev">›</span></span></button>`;
      }).join("")}</div>` : `<div class="list"><div class="empty">Тестов пока нет. Создайте первый или загрузите из файла.</div></div>`}
      <p class="hint" style="margin-top:12px">Черновики видите только вы. Чтобы тест увидел ученик: откройте тест, включите «Опубликован» и отметьте ученика.</p>`;
    bindTabs();
    batches.forEach(bindBatch);
    updates.forEach(bindUpdate);
    $app.querySelectorAll(".upd").forEach(bindUpdAsk);
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
      const access = t.for_all ? "всем ученикам" : assigned.size ? `${assigned.size} ${plural(assigned.size, "ученик", "ученика", "учеников")}` : "никому";
      $app.innerHTML = `<div class="top"><button class="link" id="back">← К тестам</button></div>
        <h1>${esc(t.title)}</h1>
        <p class="sub"><span class="chip ${t.published ? "ok" : "off"}">${t.published ? "опубликован" : "черновик"}</span></p>
        <div class="q">
          <label class="field">Название<input type="text" id="tt" value="${esc(t.title)}"></label>
          <label class="field">Описание<input type="text" id="td" value="${esc(t.description)}"></label>
          <label class="field">Уровень<select id="tv"><option ${t.level === "A2" ? "selected" : ""}>A2</option><option ${t.level === "B1" ? "selected" : ""}>B1</option></select></label>
          <div class="checks" style="margin:0"><label><input type="checkbox" id="tp" ${t.published ? "checked" : ""}> <span><b>Опубликован</b> (виден ученикам, которым доступен)</span></label></div>
        </div>
        <div class="list" style="margin-top:12px"><details class="acc"><summary class="li"><span class="li-main"><b>Кому доступен</b><small>${access}</small></span><span class="li-side chev">›</span></summary>
          <div class="acc-body"><div class="checks"><label><input type="checkbox" id="tfa" ${t.for_all ? "checked" : ""}> <b>Всем ученикам</b></label>
            ${students.map((p) => `<label><input type="checkbox" data-as="${p.id}" ${assigned.has(p.id) ? "checked" : ""}> ${esc(p.display_name)}</label>`).join("") || "<small>Учеников пока нет</small>"}</div></div></details></div>
        <div class="row"><button class="btn" id="ts">Сохранить</button><button class="btn danger" id="tdel">Удалить тест</button></div>
        <div class="err" id="er"></div>
        <h3 class="sec">Вопросы (${qs.length})</h3>
        <div class="list">${qs.map((q, i) => qForm(q, i)).join("") || `<div class="empty">Вопросов пока нет.</div>`}</div>
        <div class="row"><button class="btn alt" id="nq">＋ Добавить вопрос</button></div>`;
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
        const f = b.closest(".acc-body"), type = f.querySelector(".qt").value, msg = f.querySelector(".err");
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

  function qForm(q, i) {
    const t = q.type === "type" ? "input" : q.type;
    const ans = t === "choice" ? [q.answer] : (Array.isArray(q.answers) && q.answers.length ? q.answers : [q.answer]);
    const kind = { choice: "Выбор", multi: "Несколько верных", input: "Ввод слова" }[t];
    return `<details class="acc"><summary class="li"><span class="li-main"><b>${i + 1}. ${esc(q.prompt.length > 70 ? q.prompt.slice(0, 70) + "…" : q.prompt)}</b><small>${kind}${q.task_title ? " · " + esc(q.task_title) : ""}</small></span><span class="li-side chev">›</span></summary>
      <div class="acc-body">
      <label class="field">Тип<select class="qt"><option value="choice" ${t === "choice" ? "selected" : ""}>Выбор ответа</option><option value="multi" ${t === "multi" ? "selected" : ""}>Отметить все верные</option><option value="input" ${t === "input" ? "selected" : ""}>Ввод слова</option></select></label>
      <label class="field">Задание (заголовок, необязательно)<input type="text" class="qtt" value="${esc(q.task_title)}"></label>
      <label class="field">Инструкция к заданию (необязательно)<input type="text" class="qti" value="${esc(q.task_instruction)}"></label>
      <label class="field">Вопрос (для «Ввод слова» нужен пропуск ___)<input type="text" class="qp" value="${esc(q.prompt)}"></label>
      <label class="field">Варианты (по одному в строке)<textarea class="qo">${esc((q.options || []).join("\n"))}</textarea></label>
      <label class="field">Правильный ответ (по одному в строке; для «Выбор ответа» один)<textarea class="qa">${esc(ans.join("\n"))}</textarea></label>
      <label class="field">Пояснение (необязательно)<input type="text" class="qx" value="${esc(q.explain)}"></label>
      <div class="err"></div>
      <div class="row"><button class="btn sm" data-qs="${q.id}">Сохранить вопрос</button><button class="btn sm danger" data-qd="${q.id}">Удалить</button></div></div></details>`;
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

  function showInviteSent(r) {
    $app.innerHTML = `<div class="top"><button class="link" id="back">← К ученикам</button><span>Приглашение</span></div>
      <div class="q"><h2>✉ Приглашение отправлено</h2>
        <p class="hint">Письмо ушло на <b>${esc(r.email)}</b>. Ученик нажмёт ссылку в письме, придумает пароль и сразу попадёт в приложение.</p>
        <p class="hint">Если письма нет несколько минут, пусть проверит папку «Спам». Если не нашлось, вернитесь и создайте пароль вручную.</p></div>`;
    on("back", teacherStudents);
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
    const students = profs.filter((p) => p.role === "student"), teachers = profs.filter((p) => p.role === "teacher");
    const countFor = (p) => tests.filter((t) => t.for_all || has.has(t.id + ":" + p.id)).length;
    const sub = (p) => (p.email ? esc(p.email) : "вход по личной ссылке");
    $app.innerHTML = `${tabs("students")}
      <h1>Ученики</h1>
      <div class="list"><details class="acc"><summary class="li"><span class="li-main"><b>＋ Добавить ученика</b><small>Приложение создаст доступ и покажет приглашение</small></span><span class="li-side chev">›</span></summary>
        <div class="acc-body">
          <label class="field">Имя<input type="text" id="an" placeholder="Например, Юлия"></label>
          <label class="field">Email<input type="text" id="ae" placeholder="email ученика" inputmode="email" autocapitalize="off"></label>
          <div class="row"><button class="btn" id="am">✉ Отправить приглашение на почту</button><button class="btn alt" id="aa">Создать пароль вручную</button><button class="btn alt" id="inv">Ученик без почты</button></div>
          <div class="err" id="aer"></div>
        </div></details></div>

      <h3 class="sec">Ученики (${students.length})</h3>
      ${students.length ? `<div class="list">${students.map((p) => `<details class="acc"><summary class="li">
          <span class="who">${avatarHtml(p)}<span class="li-main"><b>${esc(p.display_name)}</b><small>${sub(p)}</small></span></span>
          <span class="li-side"><span class="chip off">${countFor(p)} из ${tests.length}</span><span class="chev">›</span></span></summary>
        <div class="acc-body">
          <p class="hint" style="margin:10px 0 2px">Доступные тесты</p>
          <div class="checks">${tests.map((t) => `<label><input type="checkbox" data-t="${t.id}" data-u="${p.id}" ${has.has(t.id + ":" + p.id) ? "checked" : ""}>
            <span><span class="badge">${t.level}</span>${esc(t.title)}${t.for_all ? " <small>(всем)</small>" : ""}${t.published ? "" : ` <small>(черновик)</small>`}</span></label>`).join("") || "<small>Тестов нет</small>"}</div>
          <div class="checks" style="margin:10px 0 0"><label><input type="checkbox" data-ww="${p.id}" ${p.weekly_words ? "checked" : ""}><span>Слова недели: помощник готовит список по понедельникам</span></label></div>
          <div class="row">
            ${p.email ? `<button class="btn sm alt" data-pw="${p.id}">🔑 Новый пароль</button>` : ""}
            ${invOf[p.id] ? `<button class="btn sm alt" data-link="${p.id}">🔗 Ссылка</button><button class="btn sm alt" data-newlink="${p.id}">↻ Новая ссылка</button>` : `<button class="btn sm alt" data-newlink="${p.id}">🔗 Создать ссылку</button>`}
            <button class="btn sm alt" data-role="${p.id}" data-to="teacher">Сделать учителем</button>
            <button class="btn sm danger" data-delst="${p.id}">Удалить</button>
          </div></div></details>`).join("")}</div>` : `<div class="list"><div class="empty">Учеников пока нет. Добавьте первого выше.</div></div>`}

      <h3 class="sec">Учителя (${teachers.length})</h3>
      <div class="list">${teachers.map((p) => `<div class="li" style="cursor:default;flex-wrap:wrap"><span class="who">${avatarHtml(p)}<span class="li-main"><b>${esc(p.display_name)}</b><small>${sub(p)}</small></span></span>
        <span class="li-side" style="flex-wrap:wrap;justify-content:flex-end">${p.id === me.user.id ? `<span class="chip off">это вы</span>` : `<button class="btn sm alt" data-pw="${p.id}">🔑 Новый пароль</button><button class="btn sm alt" data-role="${p.id}" data-to="student">Сделать учеником</button>`}</span></div>`).join("")}</div>
      ${pending.length ? `<h3 class="sec">Добавлены, но ещё не вошли</h3><div class="list">${pending.map((a) => `<div class="li" style="cursor:default"><span class="li-main"><b>${esc(a.email)}</b></span><span class="li-side"><button class="link" data-del="${esc(a.email)}">убрать</button></span></div>`).join("")}</div>` : ""}`;
    bindTabs();
    $app.querySelectorAll("[data-t]").forEach((c) => c.onchange = () => setAssign(c.dataset.t, c.dataset.u, c.checked, c));
    $app.querySelectorAll("[data-ww]").forEach((c) => c.onchange = async () => {
      const { error } = await sb.from("profiles").update({ weekly_words: c.checked }).eq("id", c.dataset.ww);
      if (error) { c.checked = !c.checked; alert("Не удалось сохранить: " + error.message); }
    });
    on("am", async () => {
      const email = $("ae").value.trim().toLowerCase(), name = $("an").value.trim(), er = $("aer");
      er.style.color = "var(--bad)";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { er.textContent = "Проверьте email."; return; }
      $("am").disabled = true; er.textContent = "Отправляем…"; er.style.color = "var(--muted)";
      try { showInviteSent(await callFn({ action: "invite_email", email, name })); }
      catch (e) { er.style.color = "var(--bad)"; er.textContent = e.message; $("am").disabled = false; }
    });
    on("aa", async () => {
      const email = $("ae").value.trim().toLowerCase(), name = $("an").value.trim(), er = $("aer");
      er.style.color = "var(--bad)";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { er.textContent = "Проверьте email."; return; }
      $("aa").disabled = true; er.textContent = "";
      try { showCredentials(await callFn({ action: "add_student", email, name })); }
      catch (e) { er.textContent = e.message; $("aa").disabled = false; }
    });
    $app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (confirm("Убрать " + b.dataset.del + " из списка?")) { await must(sb.from("allowed_emails").delete().eq("email", b.dataset.del)); teacherStudents(); }
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
    $app.querySelectorAll("[data-role]").forEach((b) => b.onclick = async () => {
      const toTeacher = b.dataset.to === "teacher";
      if (!confirm(toTeacher ? `Дать ${nameOf(b.dataset.role)} права учителя? Появится доступ ко всем тестам и ученикам.` : `Сделать ${nameOf(b.dataset.role)} учеником?`)) return;
      const { error } = await sb.from("profiles").update({ role: b.dataset.to }).eq("id", b.dataset.role);
      if (error) alert("Не удалось сохранить: " + error.message);
      teacherStudents();
    });
    $app.querySelectorAll("[data-delst]").forEach((b) => b.onclick = async () => {
      const nm = nameOf(b.dataset.delst);
      if (!confirm(`Удалить ученика «${nm}»? Будут удалены его доступ, результаты и прогресс по словам. Это нельзя отменить.`)) return;
      try { await callFn({ action: "delete_student", user_id: b.dataset.delst }); teacherStudents(); }
      catch (e) { alert("Не удалось удалить: " + e.message); }
    });
  }

  // ---------- «Проверка»: учитель решает любые тесты (в том числе черновики), результат не сохраняется ----------
  async function teacherCheck() {
    const tests = await must(sb.from("tests").select("*, questions(count)").order("created_at", { ascending: false }));
    $app.innerHTML = `${tabs("check")}<h1>Проверка</h1>
      <p class="sub">Пройдите любой тест как ученик, чтобы увидеть, как он выглядит и работает. Доступны и черновики. Результат не сохраняется.</p>
      ${tests.length ? `<div class="list">${tests.map((t) => {
        const n = t.questions[0].count;
        return `<button class="li" data-dry="${t.id}"><span class="li-main"><b>${esc(t.title)}</b><small><span class="badge">${t.level}</span>${n} ${plural(n, "вопрос", "вопроса", "вопросов")}</small></span>
          <span class="li-side"><span class="chip ${t.published ? "ok" : "off"}">${t.published ? "опубликован" : "черновик"}</span><span class="chev">›</span></span></button>`;
      }).join("")}</div>` : `<div class="list"><div class="empty">Тестов пока нет.</div></div>`}`;
    bindTabs();
    $app.querySelectorAll("[data-dry]").forEach((b) => b.onclick = () => startTest(tests.find((t) => t.id === b.dataset.dry), { dry: true }));
  }

  async function teacherWords() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [words, profs, prog, reviews] = await Promise.all([
      must(sb.from("words").select("*").order("level").order("topic").order("pl")),
      must(sb.from("profiles").select("id,display_name,role").order("display_name")),
      must(sb.from("card_progress").select("*")),
      must(sb.from("card_reviews").select("user_id,ok,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(5000))]);
    const students = profs.filter((p) => p.role === "student");
    const byId = new Map(words.map((w) => [w.id, w])), t0 = today();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = Date.now() - 7 * 864e5;
    const when = (d) => {
      if (!d) return "ещё не занимался";
      const days = Math.round((startOfDay - new Date(new Date(d).setHours(0, 0, 0, 0))) / 864e5);
      const time = new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      return days <= 0 ? `сегодня в ${time}` : days === 1 ? `вчера в ${time}` : new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    };
    const stats = students.map((p) => {
      const mine = prog.filter((c) => c.user_id === p.id && byId.has(c.word_id));
      const rv = reviews.filter((r) => r.user_id === p.id);
      const today_ = rv.filter((r) => new Date(r.created_at) >= startOfDay), week = rv.filter((r) => new Date(r.created_at).getTime() >= weekAgo);
      const learned = mine.filter((c) => c.box >= 4).length;
      return { p, started: mine.length, learned, fresh: words.length - mine.length, last: rv[0]?.created_at || null,
        todayN: today_.length, todayOk: today_.filter((r) => r.ok).length, weekN: week.length, weekOk: week.filter((r) => r.ok).length,
        due: words.length - mine.length + mine.filter((c) => c.due <= t0).length,
        hard: mine.filter((c) => c.box === 1).map((c) => withArt(byId.get(c.word_id))) };
    });
    $app.innerHTML = `${tabs("words")}
      <h1>Слова</h1>
      <h3 class="sec">Как ученики учат слова</h3>
      ${stats.length ? `<div class="list">${stats.map((x) => `<div class="li" style="cursor:default;align-items:stretch;flex-direction:column;gap:8px">
        <span style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>${esc(x.p.display_name)}</b><small>${esc(when(x.last))}</small></span>
        <span class="bar" style="margin:0" title="начато слов"><i style="width:${words.length ? Math.round(x.started / words.length * 100) : 0}%"></i></span>
        <small>Начато слов: <b>${x.started}</b> из ${words.length} · выучено: <b>${x.learned}</b> · на повторение сегодня: ${x.due}</small>
        <small>Сегодня: <b>${x.todayN}</b> ${plural(x.todayN, "ответ", "ответа", "ответов")}${x.todayN ? ` (верно ${x.todayOk})` : ""} · за 7 дней: <b>${x.weekN}</b>${x.weekN ? ` (верно ${x.weekOk})` : ""}</small>
        ${x.hard.length ? `<small>Не даются: ${esc(x.hard.slice(0, 8).join(", "))}${x.hard.length > 8 ? " …" : ""}</small>` : ""}</div>`).join("")}</div>
        <p class="hint" style="margin-top:8px">Полоса показывает, сколько слов ученик уже начал учить. «Выучено» — слово, которое он назвал правильно несколько раз подряд в разные дни, поэтому это число растёт медленно. «Не даются» — слова с последним ответом «не знал».</p>`
        : `<div class="list"><div class="empty">Учеников пока нет. Когда они начнут проходить карточки, здесь появится прогресс.</div></div>`}

      <h3 class="sec">Словарь</h3>
      <div class="list"><details class="acc"><summary class="li"><span class="li-main"><b>＋ Добавить слово</b><small>Одно слово или список</small></span><span class="li-side chev">›</span></summary>
        <div class="acc-body">
          <label class="field">Слово по-польски (у существительных с ten / ta / to)<input type="text" id="nw" autocapitalize="off" placeholder="ta przychodnia"></label>
          <label class="field">Перевод<input type="text" id="nr"></label>
          <label class="field">Пример (необязательно)<input type="text" id="ne"></label>
          <div class="row" style="align-items:center"><select id="nl"><option>A2</option><option>B1</option></select><input type="text" id="nt" placeholder="Тема (необязательно)" style="flex:1;min-width:140px"><button class="btn" id="na">Добавить</button></div>
          <div class="err" id="aer"></div>
          <details style="margin-top:10px"><summary><b>Добавить много слов списком</b></summary>
            <p class="hint" style="margin-top:8px">Одно слово в строке: <code>слово ; перевод ; пример</code></p>
            <textarea id="bulk" placeholder="zamierzać ; намереваться ; Zamierzam zmienić pracę."></textarea>
            <div class="row"><button class="btn alt sm" id="bs">Добавить списком</button></div><div class="err" id="er"></div></details>
        </div></details></div>
      <label class="field" style="margin:12px 0 8px"><input type="text" id="wq" placeholder="Поиск по словарю (${words.length} слов)"></label>
      <div class="list" id="wl">${words.map((w) => `<div class="li" data-w="${w.id}" data-q="${esc((withArt(w) + " " + w.ru).toLowerCase())}" style="cursor:default">
        <span class="li-main"><b>${gchip(w.gender)}${esc(withArt(w))}</b><small>${esc(w.ru)}${w.example ? " · " + esc(w.example) : ""}</small></span>
        <span class="li-side"><span class="badge" style="margin:0">${w.level}</span><button class="link" data-we="${w.id}" aria-label="Изменить">✎</button><button class="link" data-wd="${w.id}" aria-label="Удалить" style="color:var(--bad)">✕</button></span></div>`).join("") || `<div class="empty">Слов пока нет.</div>`}</div>`;
    bindTabs();
    $("wq").oninput = () => { const q = $("wq").value.trim().toLowerCase(); $app.querySelectorAll("#wl [data-w]").forEach((r) => r.style.display = !q || r.dataset.q.includes(q) ? "" : "none"); };
    on("na", async () => {
      const pw = parsePl($("nw").value), pl = pw.pl, ru = $("nr").value.trim();
      if (!pl || !ru) { $("aer").style.color = "var(--bad)"; $("aer").textContent = "Заполните слово и перевод."; return; }
      const { error } = await sb.from("words").insert({ pl, ru, gender: pw.gender, example: $("ne").value.trim(), level: $("nl").value, topic: $("nt").value.trim() });
      if (error) { $("aer").style.color = "var(--bad)"; $("aer").textContent = error.message; return; }
      teacherWords();
    });
    on("bs", async () => {
      const rows = $("bulk").value.split("\n").map((l) => l.split(";").map((x) => x.trim())).filter((q) => q[0] && q[1])
        .map((q) => { const pw = parsePl(q[0]); return { pl: pw.pl, gender: pw.gender, ru: q[1], example: q[2] || "", level: $("nl").value, topic: $("nt").value.trim() }; });
      if (!rows.length) { $("er").style.color = "var(--bad)"; $("er").textContent = "Нет строк в формате «слово ; перевод»."; return; }
      const { error } = await sb.from("words").insert(rows);
      if (error) { $("er").style.color = "var(--bad)"; $("er").textContent = error.message; return; }
      teacherWords();
    });
    $app.querySelectorAll("[data-wd]").forEach((b) => b.onclick = async () => {
      if (confirm("Удалить слово? У учеников пропадёт и его прогресс.")) { await must(sb.from("words").delete().eq("id", b.dataset.wd)); teacherWords(); }
    });
    $app.querySelectorAll("[data-we]").forEach((b) => b.onclick = () => {
      const w = byId.get(b.dataset.we), box = b.closest(".li");
      box.style.display = "block";
      box.innerHTML = `<label class="field">Слово (с ten / ta / to у существительных)<input type="text" class="ew" value="${esc(withArt(w))}"></label>
        <label class="field">Перевод<input type="text" class="er2" value="${esc(w.ru)}"></label>
        <label class="field">Пример<input type="text" class="ee" value="${esc(w.example)}"></label>
        <label class="field">Уровень<select class="el"><option ${w.level === "A2" ? "selected" : ""}>A2</option><option ${w.level === "B1" ? "selected" : ""}>B1</option></select></label>
        <div class="err"></div><div class="row"><button class="btn sm sv">Сохранить</button><button class="btn sm alt cn">Отмена</button></div>`;
      box.querySelector(".cn").onclick = teacherWords;
      box.querySelector(".sv").onclick = async () => {
        const pw = parsePl(box.querySelector(".ew").value), pl = pw.pl, ru = box.querySelector(".er2").value.trim();
        if (!pl || !ru) { box.querySelector(".err").textContent = "Заполните слово и перевод."; return; }
        const { error } = await sb.from("words").update({ pl, gender: pw.gender, ru, example: box.querySelector(".ee").value.trim(), level: box.querySelector(".el").value }).eq("id", w.id);
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
    $app.innerHTML = `${tabs("results")}<h1>Результаты</h1>
      ${att.length ? `<div class="list">${att.map((a) => {
        const pct = Math.round(a.score / a.total * 100);
        return `<button class="li" data-a="${a.id}"><span class="li-main"><b>${esc(pn[a.user_id] || "—")}</b><small>${esc(tn[a.test_id] || "—")} · ${new Date(a.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</small></span>
          <span class="li-side"><span class="chip ${pct >= 70 ? "ok" : "mid"}">${a.score}/${a.total}</span><span class="chev">›</span></span></button>`;
      }).join("")}</div>` : `<div class="list"><div class="empty">Пока никто не проходил тесты.</div></div>`}`;
    bindTabs();
    $app.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => { const a = att.find((x) => x.id === b.dataset.a); attemptView(a, pn[a.user_id], tn[a.test_id]); });
  }

  // Разбор одного прохождения: что и как ответил ученик
  function attemptView(a, who, title) {
    const d = Array.isArray(a.details) ? a.details : null;
    const txt = (g) => Array.isArray(g) ? g.join("; ") : String(g ?? "");
    const row = (x, i) => `<li class="${x.ok ? "r-ok" : x.almost ? "r-almost" : "r-bad"}"><b>${i + 1}. ${esc(x.prompt)}</b><br>
      ${x.ok ? "✅" : x.almost ? "🟡" : "❌"} Ответ ученика: <span class="u">${esc(txt(x.given))}</span>${x.ok ? "" : `<br>Верно: <span class="a">${esc(txt(x.right))}</span>`}${x.why && !x.ok ? `<br><small>${esc(x.why)}</small>` : ""}</li>`;
    let body = `<p class="sub">Подробный разбор не сохранён: тест был пройден до появления этой функции.</p>`;
    if (d) {
      const wrong = d.filter((x) => !x.ok), tasks = [...new Set(d.map((x) => x.task))];
      body = `${wrong.length ? `<h3 class="sec">Ошибки (${wrong.length})</h3><ul class="review">${d.map((x, i) => [x, i]).filter(([x]) => !x.ok).map(([x, i]) => row(x, i)).join("")}</ul>` : `<p class="sub">Ошибок нет 🎉</p>`}
        <details class="acc"><summary class="li"><span class="li-main"><b>Все ответы</b><small>${d.length} вопросов по заданиям</small></span><span class="li-side chev">›</span></summary>
        ${tasks.map((t) => `${t ? `<h3 class="sec">${esc(t)}</h3>` : ""}<ul class="review">${d.map((x, i) => [x, i]).filter(([x]) => x.task === t).map(([x, i]) => row(x, i)).join("")}</ul>`).join("")}</details>`;
    }
    $app.innerHTML = `${tabs("results")}<p><button class="link" id="bk">← К результатам</button></p><h1>${esc(who || "—")}</h1>
      <p class="sub">${esc(title || "—")} · ${new Date(a.created_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · <b>${a.score}/${a.total}</b></p>${body}`;
    bindTabs(); $app.querySelector("#bk").onclick = () => teacherResults().catch(fail);
  }

  // ---------- старт ----------
  let claiming = false;
  async function route(session) {
    if (!session) { me.user = null; me.profile = null; return authView(); }
    me.user = session.user;
    try { await loadProfile(); home(); } catch (e) { fail(e); }
  }
  let recovering = false;
  let inviteLink = /[#&]type=invite\b/.test(location.hash); // ссылка из письма-приглашения
  sb.auth.onAuthStateChange((event, session) => {
    if (claiming) return;
    if (inviteLink && session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) { inviteLink = false; recovering = true; setTimeout(() => showChangePassword({ recovery: true, welcome: true }), 0); return; }
    if (event === "PASSWORD_RECOVERY") { recovering = true; setTimeout(() => showChangePassword({ recovery: true }), 0); return; }
    if (recovering) return;
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

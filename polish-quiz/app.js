(() => {
  const $app = document.getElementById("app");
  const QUIZ_LEN = 10;
  const STORE = "polish-quiz-v1";

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
  const save = (s) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {} };

  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "");

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = "pl-PL"; u.rate = 0.85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  // ---------- генерация вопросов ----------
  function pairQuestions(cat) {
    const pool = PAIRS[cat];
    return pool.map(([pl, ru]) => {
      const kind = Math.random();
      if (kind < 0.4) { // пол → ру, выбор
        const wrong = shuffle(pool.filter((p) => p[1] !== ru)).slice(0, 3).map((p) => p[1]);
        return { type: "choice", prompt: `Что значит «${pl}»?`, say: pl, options: shuffle([ru, ...wrong]), answer: ru };
      }
      if (kind < 0.7) { // ру → пол, выбор
        const wrong = shuffle(pool.filter((p) => p[0] !== pl)).slice(0, 3).map((p) => p[0]);
        return { type: "choice", prompt: `Как по-польски «${ru}»?`, options: shuffle([pl, ...wrong]), answer: pl, sayAnswer: pl };
      }
      return { type: "type", prompt: `Напишите по-польски: «${ru}»`, answer: pl, sayAnswer: pl };
    });
  }
  function choiceQuestions(cat) {
    return CHOICES[cat].map(([q, opts, answer, explain]) => ({ type: "choice", prompt: q, options: shuffle(opts), answer, explain }));
  }
  function build(cat) {
    const gen = { vocab: pairQuestions, phrases: pairQuestions, numbers: pairQuestions, grammar: choiceQuestions, time: choiceQuestions };
    let qs;
    if (cat === "mixed") qs = Object.keys(gen).flatMap((c) => gen[c](c));
    else qs = gen[cat](cat);
    return shuffle(qs).slice(0, QUIZ_LEN);
  }

  // ---------- экраны ----------
  function home() {
    const st = load();
    $app.innerHTML = `
      <h1><span class="flag"></span>Polski Quiz</h1>
      <p class="sub">Тесты для изучения польского языка. Выберите тему.</p>
      <div class="grid">${CATEGORIES.map((c) => {
        const b = st[c.id];
        return `<button class="card" data-cat="${c.id}"><span class="ico">${c.icon}</span><b>${c.title}</b><small>${c.desc}</small>
          ${b ? `<span class="best">Лучший: ${b.best}/${b.total} · пройдено ${b.plays}×</span>` : ""}</button>`;
      }).join("")}</div>
      ${Object.keys(st).length ? `<div class="row"><button class="link" id="reset">Сбросить прогресс</button></div>` : ""}`;
    $app.querySelectorAll("[data-cat]").forEach((el) => el.onclick = () => startQuiz(el.dataset.cat));
    const r = document.getElementById("reset");
    if (r) r.onclick = () => { if (confirm("Удалить сохранённый прогресс?")) { save({}); home(); } };
  }

  function startQuiz(cat) {
    const quiz = { cat, qs: build(cat), i: 0, score: 0, wrong: [] };
    renderQ(quiz);
  }

  function renderQ(quiz) {
    const q = quiz.qs[quiz.i];
    const title = CATEGORIES.find((c) => c.id === quiz.cat).title;
    $app.innerHTML = `
      <div class="top"><button class="link" id="back">← Темы</button><span>${title} · ${quiz.i + 1}/${quiz.qs.length}</span></div>
      <div class="bar"><i style="width:${quiz.i / quiz.qs.length * 100}%"></i></div>
      <div class="q">
        <h2>${esc(q.prompt)} ${q.say ? `<button class="say" id="say" title="Прослушать" aria-label="Прослушать">🔊</button>` : ""}</h2>
        <p class="hint">${q.type === "type" ? "Введите ответ (польские буквы желательны, но без них тоже засчитаем с подсказкой)" : "Выберите вариант"}</p>
        ${q.type === "choice"
          ? `<div class="opts">${q.options.map((o) => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`
          : `<form id="f"><input type="text" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>
             <div class="row"><button class="btn" type="submit">Проверить</button></div></form>`}
        <div id="fb"></div>
      </div>`;
    document.getElementById("back").onclick = () => { if (confirm("Выйти из теста? Прогресс теста будет потерян.")) home(); };
    const say = document.getElementById("say"); if (say) say.onclick = () => speak(q.say);

    if (q.type === "choice") {
      $app.querySelectorAll(".opt").forEach((b) => b.onclick = () => answer(quiz, q, b.dataset.v, b));
    } else {
      document.getElementById("f").onsubmit = (e) => { e.preventDefault(); const v = document.getElementById("inp").value; if (v.trim()) answer(quiz, q, v); };
    }
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
    } else {
      document.getElementById("inp").disabled = true;
      document.querySelector("#f .btn").remove();
    }
    const last = quiz.i + 1 === quiz.qs.length;
    document.getElementById("fb").innerHTML = `
      <div class="fb ${ok ? "ok" : "bad"}">${ok ? "✅ Верно!" : `❌ Неверно. Правильный ответ: <b>${esc(q.answer)}</b>.`}${note}
        ${q.explain ? `<br><small>${esc(q.explain)}</small>` : ""}
        ${q.sayAnswer ? ` <button class="say" id="say2" aria-label="Прослушать">🔊</button>` : ""}</div>
      <div class="row"><button class="btn" id="next" autofocus>${last ? "Результат" : "Дальше"}</button></div>`;
    const s2 = document.getElementById("say2"); if (s2) s2.onclick = () => speak(q.sayAnswer);
    document.getElementById("next").onclick = () => { quiz.i++; last ? results(quiz) : renderQ(quiz); };
  }

  function results(quiz) {
    const total = quiz.qs.length, pct = Math.round(quiz.score / total * 100);
    const st = load(), prev = st[quiz.cat] || { best: 0, plays: 0, total };
    st[quiz.cat] = { best: Math.max(prev.best, quiz.score), plays: prev.plays + 1, total };
    save(st);
    const msg = pct === 100 ? "Отлично! Perfekcyjnie! 🎉" : pct >= 70 ? "Хороший результат! Dobrze!" : pct >= 40 ? "Неплохо, но стоит повторить." : "Не сдавайтесь — практика ведёт к результату!";
    $app.innerHTML = `
      <h1>Результат</h1>
      <div class="score">${quiz.score}/${total}</div>
      <p class="sub" style="text-align:center">${pct}% · ${msg}</p>
      ${quiz.wrong.length ? `<h3>Над чем поработать</h3><ul class="review">${quiz.wrong.map((w) =>
        `<li>${esc(w.prompt)}<br>Ваш ответ: <span class="u">${esc(w.given)}</span> · Верно: <span class="a">${esc(w.answer)}</span></li>`).join("")}</ul>` : ""}
      <div class="row"><button class="btn" id="again">Ещё раз</button><button class="btn alt" id="home">К темам</button></div>`;
    document.getElementById("again").onclick = () => startQuiz(quiz.cat);
    document.getElementById("home").onclick = home;
  }

  home();
})();

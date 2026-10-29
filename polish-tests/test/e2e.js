// Ручная проверка страницы в браузере (нужен playwright): node test/e2e.js [путь к html]
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const file = path.resolve(process.argv[2] || 'dist/zaimki-2026-10-29.html');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const external = [], errors = [];
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) external.push(r.url()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('file://' + file);

  await p.screenshot({ path: 'dist/shot-start.png' });
  await p.click('text=Начать');

  const answers = JSON.parse(require('fs').readFileSync('example/zaimki-sample.json', 'utf8'));
  const byPrompt = {};
  answers.tasks.forEach((t) => t.questions.forEach((q) => { byPrompt[q.prompt] = q; }));

  let wrongDone = false, almostDone = false;
  for (let task = 0; task < 4; task++) {
    const qs = await p.$$('.q');
    for (const el of qs) {
      const prompt = (await el.$eval('.prompt', (n) => n.textContent)).replace(/^\d+\.\s/, '');
      const q = byPrompt[prompt];
      if (q.type === 'input') {
        // keys panel: вставка польской буквы
        const inp = await el.$('input[type=text]');
        if (!almostDone && q.answer[0] === 'nią') {
          await inp.fill('nia'); almostDone = true;
        } else {
          await inp.fill('');
          for (const ch of q.answer[0]) {
            if ('ąćęłńóśźż'.includes(ch)) await (await el.$(`.keys button:text-is("${ch}")`)).click(); else await inp.press(ch);
          }
        }
      } else {
        const wanted = q.type === 'multi' ? q.answer : [q.answer];
        let pick = wanted;
        if (!wrongDone && q.type === 'choice') { pick = [q.options.find((o) => o !== q.answer)]; wrongDone = true; }
        for (const o of pick) {
          const labels = await el.$$('.opt');
          for (const l of labels) if ((await l.textContent()) === o) await l.click();
        }
      }
    }
    await p.click('text=Проверить');
    if (task === 0) {
      assert(await p.$('.opt.bad'), 'неверный вариант подсвечен красным');
      assert(await p.$('.opt.ok, .opt.miss'), 'верный вариант подсвечен');
      assert((await p.$$('.fb.bad')).length === 1, 'одно объяснение ошибки');
      await p.screenshot({ path: 'dist/shot-check.png', fullPage: true });
      assert(await p.$eval('input[type=radio]', (i) => i.disabled), 'поля заблокированы после проверки');
    }
    if (task === 1) {
      assert(await p.$('.fb.almost'), 'правило «Почти!»');
      assert((await p.textContent('.fb.almost')).includes('Проверь польские буквы: правильно — nią'));
    }
    await p.click(task === 3 ? 'text=Показать результат' : 'text=Дальше');
  }
  const score = await p.textContent('.score');
  console.log('score:', score);
  assert.strictEqual(score, '14 из 16');                 // 1 неверный choice + «nia» = 2 ошибки
  assert.strictEqual((await p.$$('.err-item')).length, 2);
  await p.screenshot({ path: 'dist/shot-result.png', fullPage: true });

  await p.click('text=Пройти ещё раз');
  assert((await p.textContent('h2')).length > 0 && (await p.textContent('p.muted')).includes('Задание 1 из 4'));

  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, 'нет горизонтальной прокрутки');
  assert.deepStrictEqual(external, [], 'нет сетевых запросов');
  assert.deepStrictEqual(errors, []);
  console.log('OK');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

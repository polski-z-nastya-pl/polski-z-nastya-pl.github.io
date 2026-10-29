// Веб-приложение Google Apps Script: принимает результаты теста и пишет строку в таблицу.
// Развернуть: Расширения → Apps Script (из таблицы) → вставить код → Развернуть → Веб-приложение
// (выполнять от своего имени, доступ: «Все»). URL записать в RESULTS_WEBHOOK_URL.
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) sheet.appendRow(['Дата', 'Ученица', 'Тема', 'Баллы', 'Ошибки']);
  var mistakes = (d.mistakes || []).map(function (m) {
    return m.prompt + ' → ' + m.given + ' (верно: ' + m.correct + ')';
  }).join('\n');
  sheet.appendRow([d.date, d.student, d.topic, d.score + '/' + d.total, mistakes]);
  return ContentService.createTextOutput('ok');
}

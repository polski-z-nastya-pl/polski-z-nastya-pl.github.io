// Банк вопросов. vocab/phrases/numbers — пары слов; grammar/time — готовые вопросы с вариантами.
window.PAIRS = {
  vocab: [
    ["dom", "дом"], ["kot", "кот"], ["pies", "собака"], ["chleb", "хлеб"], ["woda", "вода"],
    ["mleko", "молоко"], ["książka", "книга"], ["szkoła", "школа"], ["miasto", "город"],
    ["samochód", "машина"], ["okno", "окно"], ["drzwi", "дверь"], ["ulica", "улица"],
    ["sklep", "магазин"], ["praca", "работа"], ["przyjaciel", "друг"], ["rodzina", "семья"],
    ["jabłko", "яблоко"], ["ser", "сыр"], ["pogoda", "погода"]
  ],
  phrases: [
    ["Dzień dobry", "Здравствуйте"], ["Do widzenia", "До свидания"], ["Dziękuję", "Спасибо"],
    ["Proszę", "Пожалуйста"], ["Przepraszam", "Извините"], ["Jak się masz?", "Как дела?"],
    ["Nie rozumiem", "Я не понимаю"], ["Ile to kosztuje?", "Сколько это стоит?"],
    ["Gdzie jest toaleta?", "Где туалет?"], ["Smacznego", "Приятного аппетита"],
    ["Na zdrowie", "Будем здоровы"], ["Dobranoc", "Спокойной ночи"], ["Cześć", "Привет"],
    ["Mówisz po polsku?", "Ты говоришь по-польски?"]
  ],
  numbers: [
    ["jeden", "1"], ["dwa", "2"], ["trzy", "3"], ["cztery", "4"], ["pięć", "5"], ["sześć", "6"],
    ["siedem", "7"], ["osiem", "8"], ["dziewięć", "9"], ["dziesięć", "10"],
    ["dwadzieścia", "20"], ["pięćdziesiąt", "50"], ["sto", "100"]
  ]
};

// [вопрос, [варианты], правильный, пояснение]
window.CHOICES = {
  grammar: [
    ["Ja ___ studentem.", ["jestem", "jesteś", "jest", "jesteśmy"], "jestem", "być: ja jestem, ty jesteś, on jest."],
    ["Ty ___ w domu.", ["jestem", "jesteś", "jest", "są"], "jesteś", "być: ty jesteś."],
    ["My ___ do Polski.", ["jadę", "jedziesz", "jedziemy", "jadą"], "jedziemy", "jechać: my jedziemy."],
    ["Oni ___ po polsku.", ["mówi", "mówią", "mówisz", "mówimy"], "mówią", "mówić: oni mówią."],
    ["Ja ___ kawę.", ["piję", "pijesz", "pije", "piją"], "piję", "pić: ja piję."],
    ["Widzę ___. (кот)", ["kot", "kota", "kotu", "kotem"], "kota", "Вин. падеж одушевлённых м. р. совпадает с родительным."],
    ["Mieszkam w ___. (Варшава)", ["Warszawa", "Warszawę", "Warszawie", "Warszawą"], "Warszawie", "Местный падеж (w + Msc.): Warszawie."],
    ["Idę do ___. (школа)", ["szkoła", "szkoły", "szkołę", "szkole"], "szkoły", "do + родительный: szkoły."],
    ["Jadę ___. (автобус)", ["autobus", "autobusa", "autobusem", "autobusie"], "autobusem", "Творительный падеж — средство передвижения."],
    ["Mam ___. (сестра)", ["siostra", "siostry", "siostrę", "siostrze"], "siostrę", "Винительный ж. р.: -a → -ę."],
    ["Wczoraj ja ___ w kinie. (женщина говорит)", ["byłam", "byłem", "była", "byli"], "byłam", "Прошедшее время ж. р., 1 л. ед. ч.: byłam."],
    ["Wczoraj on ___ w pracy.", ["była", "było", "był", "byli"], "był", "Прошедшее время м. р.: był."],
    ["Nie mam ___. (время)", ["czas", "czasu", "czasem", "czasie"], "czasu", "После отрицания — родительный: czasu."],
    ["Rozmawiam z ___. (брат)", ["brat", "brata", "bratem", "bratu"], "bratem", "z + творительный: bratem."],
    ["To jest ___ książka. (моя)", ["mój", "moja", "moje", "moją"], "moja", "Ж. р. им. п.: moja."],
    ["Lubię ___ . (чтение: czytać)", ["czytam", "czytać", "czyta", "czytasz"], "czytać", "После lubić — инфинитив."]
  ],
  time: [
    ["Какой день недели — «poniedziałek»?", ["Понедельник", "Вторник", "Среда", "Воскресенье"], "Понедельник", ""],
    ["Какой день недели — «środa»?", ["Вторник", "Среда", "Четверг", "Пятница"], "Среда", ""],
    ["Какой день недели — «piątek»?", ["Четверг", "Пятница", "Суббота", "Среда"], "Пятница", ""],
    ["Какой день недели — «niedziela»?", ["Суббота", "Понедельник", "Воскресенье", "Вторник"], "Воскресенье", ""],
    ["Как по-польски «вторник»?", ["wtorek", "czwartek", "sobota", "środa"], "wtorek", ""],
    ["Как по-польски «суббота»?", ["sobota", "niedziela", "piątek", "wtorek"], "sobota", ""],
    ["Какой месяц — «styczeń»?", ["Январь", "Июнь", "Июль", "Март"], "Январь", ""],
    ["Какой месяц — «wrzesień»?", ["Август", "Сентябрь", "Октябрь", "Ноябрь"], "Сентябрь", ""],
    ["Какое время года — «zima»?", ["Лето", "Весна", "Зима", "Осень"], "Зима", ""],
    ["Как по-польски «осень»?", ["wiosna", "lato", "jesień", "zima"], "jesień", ""],
    ["Что значит «dzisiaj»?", ["Вчера", "Сегодня", "Завтра", "Сейчас"], "Сегодня", ""],
    ["Что значит «jutro»?", ["Вчера", "Сегодня", "Завтра", "Утром"], "Завтра", ""]
  ]
};

window.CATEGORIES = [
  { id: "vocab",   title: "Слова",           icon: "📚", desc: "Повседневная лексика" },
  { id: "phrases", title: "Фразы",           icon: "💬", desc: "Приветствия и вежливость" },
  { id: "numbers", title: "Числа",           icon: "🔢", desc: "От 1 до 100" },
  { id: "grammar", title: "Грамматика",      icon: "✏️", desc: "Падежи, глаголы, время" },
  { id: "time",    title: "Дни и время",     icon: "📅", desc: "Дни недели, месяцы, сезоны" },
  { id: "mixed",   title: "Всё вперемешку",  icon: "🎲", desc: "Случайные вопросы из всех тем" }
];

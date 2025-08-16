import Database from 'better-sqlite3';

// Используем переменную окружения DB_PATH, иначе events.db в текущей папке
const path = process.env.DB_PATH || 'events.db';
const db = new Database(path);
db.pragma('journal_mode = WAL');

// Создаём таблицы, если их ещё нет
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL,   -- ISO datetime
  capacity INTEGER NOT NULL DEFAULT 20,
  taken INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER UNIQUE NOT NULL,
  name TEXT,
  username TEXT
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, slot_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(slot_id) REFERENCES slots(id)
);
`);

// Демо-данные
export function seedDemo() {
  const count = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
  if (count > 0) return;

  const insEvent = db.prepare('INSERT INTO events (title, description, location) VALUES (?, ?, ?)');
  const e1 = insEvent.run(
    'Лекторий: Дизайн без боли',
    'Маленькие практики для больших задач',
    'Технопарк, зал А'
  ).lastInsertRowid;

  const e2 = insEvent.run(
    'Воркшоп: AI в рабочем процессе',
    'Промпт-инженерия для дизайнеров',
    'Коворкинг «Станция»'
  ).lastInsertRowid;

  const insSlot = db.prepare('INSERT INTO slots (event_id, starts_at, capacity) VALUES (?, ?, ?)');
  const nowISO = new Date();
  const addHours = (h) => new Date(nowISO.getTime() + h * 3600_000).toISOString();

  insSlot.run(e1, addHours(24), 30);
  insSlot.run(e1, addHours(48), 30);
  insSlot.run(e2, addHours(24), 15);
  insSlot.run(e2, addHours(72), 15);
}

export default db;

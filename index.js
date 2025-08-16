import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import dayjs from 'dayjs';
import utc from 'dayjs-plugin-utc';
import tz from 'dayjs-plugin-timezone';
import db, { seedDemo } from './db.js';

dayjs.extend(utc);
dayjs.extend(tz);
const ZONE = process.env.TZ || 'Europe/Moscow';

const bot = new Telegraf(process.env.BOT_TOKEN);

// --- helpers ---
const qEvents = db.prepare('SELECT id, title FROM events ORDER BY id DESC');
const qSlotsByEvent = db.prepare('SELECT id, starts_at, capacity, taken FROM slots WHERE event_id = ? ORDER BY starts_at ASC');
const getOrCreateUser = db.prepare(`
  INSERT INTO users (tg_id, name, username)
  VALUES (@tg_id, @name, @username)
  ON CONFLICT(tg_id) DO UPDATE SET name=excluded.name, username=excluded.username
  RETURNING id
`);
const insReg = db.prepare('INSERT INTO registrations (user_id, slot_id, created_at) VALUES (?, ?, ?)');
const incTaken = db.prepare('UPDATE slots SET taken = taken + 1 WHERE id = ? AND taken < capacity');
const slotById = db.prepare(`
  SELECT s.id, s.starts_at, s.capacity, s.taken, e.title, e.location 
  FROM slots s 
  JOIN events e ON e.id = s.event_id 
  WHERE s.id = ?
`);

// безопасный callback-data: "act:param"
const actions = {
  LIST_EVENTS: 'list',
  PICK_EVENT: 'event',     // event:ID
  PICK_SLOT:  'slot',      // slot:ID
  CONFIRM:    'confirm'    // confirm:SLOTID
};

// --- commands ---
bot.start(async (ctx) => {
  const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
  ctx.reply(
    `Привет, ${name || 'друг'}!\nЯ помогу выбрать мероприятие и записаться.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📅 Показать события', actions.LIST_EVENTS)]
    ])
  );
});

// Список событий
bot.action(actions.LIST_EVENTS, async (ctx) => {
  const rows = qEvents.all();
  if (!rows.length) return ctx.answerCbQuery('Пока событий нет');
  const buttons = rows.map(r => [Markup.button.callback(`• ${r.title}`, `${actions.PICK_EVENT}:${r.id}`)]);
  await ctx.editMessageText('Выбери событие:', Markup.inlineKeyboard(buttons));
});

// Выбор события → слоты
bot.action(new RegExp(`^${actions.PICK_EVENT}:(\\d+)$`), async (ctx) => {
  const eventId = Number(ctx.match[1]);
  const slots = qSlotsByEvent.all(eventId);
  if (!slots.length) return ctx.answerCbQuery('Нет доступных слотов');
  const buttons = slots.map(s => {
    const dt = dayjs(s.starts_at).tz(ZONE).format('DD.MM HH:mm');
    const left = s.capacity - s.taken;
    return [Markup.button.callback(`${dt} (${left} мест)`, `${actions.PICK_SLOT}:${s.id}`)];
  });
  await ctx.editMessageText('Выбери время:', Markup.inlineKeyboard(buttons));
});

// Выбор слота → подтверждение
bot.action(new RegExp(`^${actions.PICK_SLOT}:(\\d+)$`), async (ctx) => {
  const slotId = Number(ctx.match[1]);
  const s = slotById.get(slotId);
  if (!s) return ctx.answerCbQuery('Слот не найден');
  const when = dayjs(s.starts_at).tz(ZONE).format('DD MMM, HH:mm');
  const left = s.capacity - s.taken;
  await ctx.editMessageText(
    `Мероприятие: ${s.title}\nГде: ${s.location}\nКогда: ${when}\nСвободно: ${left} мест\n\nЗаписываем тебя?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, записаться', `${actions.CONFIRM}:${slotId}`)],
      [Markup.button.callback('↩️ Назад к слотам', `${actions.PICK_EVENT}:${s.event_id || 0}`)]
    ])
  );
});

// Подтверждение → регистрация
bot.action(new RegExp(`^${actions.CONFIRM}:(\\d+)$`), async (ctx) => {
  const slotId = Number(ctx.match[1]);
  const s = slotById.get(slotId);
  if (!s) return ctx.answerCbQuery('Слот не найден');

  // создаём/обновляем пользователя
  const u = getOrCreateUser.get({
    tg_id: ctx.from.id,
    name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || null,
    username: ctx.from.username || null
  });

  // пытаемся «занять» место
  const updated = incTaken.run(slotId);
 

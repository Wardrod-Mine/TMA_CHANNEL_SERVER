// bot/index.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL   = process.env.APP_URL;

// поддержка одного или нескольких админ-чатов
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || process.env.ADMIN_CHAT_ID || '')
  .split(/[,\s]+/)          // через запятую или пробел
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const ADMIN_THREAD_ID = process.env.ADMIN_THREAD_ID ? Number(process.env.ADMIN_THREAD_ID) : null;

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в .env');
if (!APP_URL)   console.warn('APP_URL не задан: кнопка web_app не откроет ТМА');

const bot = new Telegraf(BOT_TOKEN);

bot.command('test_admin', async (ctx) => {
  const ok = await notifyAdmins(ctx, '<b>Тест сообщения администратору</b>',);
  ctx.reply(ok ? 'Ок — администратору отправлено ✅' : 'Не удалось отправить администратору ❗️', { parse_mode:'HTML' });
});

// /start с пейлоадом -> открываем ТМА на нужной карточке
bot.start(async (ctx) => {
  const payload = (ctx.startPayload || 'tma').trim();
  const url = `${APP_URL}?tgWebAppStartParam=${encodeURIComponent(payload)}`;
  await ctx.reply(
    'Откройте мини-приложение:',
    Markup.inlineKeyboard([[Markup.button.webApp('Открыть ТМА', url)]])
  );
});

// сервис: быстро получить chat.id
bot.command('id', (ctx) => ctx.reply(
  `chat.id: <code>${ctx.chat.id}</code>\nuser.id: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' }
));
bot.command('ping', (ctx) => ctx.reply('pong'));

// утилиты форматирования
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt = (v) => v ? esc(v) : '—';
const who = (u) => {
  if (!u) return '—';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const un = u.username ? ` @${u.username}` : '';
  return `${esc(name)}${un} (id: <code>${u.id}</code>)`;
};

async function notifyAdmins(ctx, html) {
  const targets = ADMIN_CHAT_IDS.length ? ADMIN_CHAT_IDS : [ctx.chat.id]; // фоллбэк в текущий чат
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (ADMIN_THREAD_ID) extra.message_thread_id = ADMIN_THREAD_ID;

  let delivered = 0;
  for (const chatId of targets) {
    try {
      await ctx.telegram.sendMessage(chatId, html, extra);
      console.log('[notifyAdmins] sent to', chatId);
      delivered++;
    } catch (err) {
      console.error('[notifyAdmins] error to', chatId, err.message);
    }
  }
  return delivered;
}

// === приём данных из WebApp (sendData) ===
bot.on(message('web_app_data'), async (ctx) => {
  const raw = ctx.message.web_app_data?.data || '';
  console.log('\n====[web_app_data received]====');
  console.log('From user:', ctx.from?.id, ctx.from?.username);
  console.log('Raw payload:', raw);

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('❌ Failed to parse JSON:', e.message);
  }

  if (!data) {
    console.log('⚠️ No data received or failed to parse JSON');
    return ctx.reply('Данные не распознаны.');
  }
  console.log('Parsed data:', data);

  const stamp = new Date().toLocaleString('ru-RU');
  if (!data || typeof data !== 'object') {
    await notifyAdmins(ctx, `<b>📥 web_app_data (raw)</b>\n<pre>${esc(raw)}</pre>\n\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}`);
    return ctx.reply('Данные получены.');
  }

  // ---- единая "Заявка" (новая кнопка) ----
  if (data.action === 'send_request') {
    const p = data.product || {};
    const html =
      `<b>📝 Заявка</b>\n` +
      `<b>Продукт:</b> ${fmt(p.title)} (id: <code>${esc(p.id)}</code>)\n` +
      `\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}\n` +
      `\n<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    const ok = await notifyAdmins(ctx, html);
    return ctx.reply(ok ? `Заявка передана администратору ✅\nОтправлено в: ${ADMIN_CHAT_IDS.join(', ') || ctx.chat.id}` : 'Не удалось доставить администратору ❗️');
  }

  if (data.action === 'send_request_form') {
    const p = data.product?.title || '—';
    const html =
      `<b>📝 Заявка (форма)</b>\n` +
      `<b>Продукт:</b> ${fmt(p)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Username (по желанию):</b> ${data.include_username && data.username ? '@' + esc(data.username) : '—'}\n` +
      `\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(new Date().toLocaleString('ru-RU'))}`;
    const ok = await notifyAdmins(ctx, html);
    return ctx.reply(ok ? `Заявка передана администратору ✅\nОтправлено в: ${ADMIN_CHAT_IDS.join(', ') || ctx.chat.id}` : 'Не удалось доставить администратору ❗️');
  }

  // === заявки в формате DEN-TMA ===
  if (data.type === 'lead') {
    const html =
      `<b>📝 Заявка</b>\n` +
      `<b>Услуга:</b> ${fmt(data.service)}\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      `<b>Город:</b> ${fmt(data.city)}\n` +
      `<b>Комментарий:</b>\n${fmt(data.comment)}\n` +
      `\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${new Date(data.ts || Date.now()).toLocaleString('ru-RU')}`;

    const ok = await notifyAdmins(ctx, html);
    return ctx.reply(ok ? 'Заявка передана администратору ✅' : 'Не удалось доставить администратору ❗️');
  }

  // ---- консультация (оставляем как есть) ----
  if (data.action === 'consult') {
    const p = data.product?.title || 'Общая консультация';
    const html =
      `<b>💬 Консультация</b>\n` +
      `<b>Продукт:</b> ${esc(p)}\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Контакт:</b> ${fmt(data.contact)}\n` +
      `<b>Сообщение:</b>\n${fmt(data.message)}\n` +
      `\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}\n` +
      `\n<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    const ok = await notifyAdmins(ctx, html);
    return ctx.reply(ok ? `Сообщение передано администратору ✅\nОтправлено в: ${ADMIN_CHAT_IDS.join(', ') || ctx.chat.id}` : 'Не удалось доставить администратору ❗️');
  }

  // ---- бэкап для старой корзины ----
  if (data.action === 'send_cart') {
    const list = (data.items || []).map(i => `• ${esc(i.title)} (<code>${esc(i.id)}</code>)`).join('\n') || '—';
    const html =
      `<b>🧺 Заявка (корзина)</b>\n${list}\n\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}\n` +
      `\n<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    const ok = await notifyAdmins(ctx, html);
    return ctx.reply(ok ? `Заявка (корзина) отправлена ✅\nОтправлено в: ${ADMIN_CHAT_IDS.join(', ') || ctx.chat.id}` : 'Не удалось доставить администратору ❗️');
  }

  // всё остальное — как есть
  const html = `<b>📥 Данные из ТМА</b>\n<pre>${esc(JSON.stringify(data, null, 2))}</pre>\n\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}`;
  const ok = await notifyAdmins(ctx, html);
  return ctx.reply(ok ? `Данные переданы администратору ✅\nОтправлено в: ${ADMIN_CHAT_IDS.join(', ') || ctx.chat.id}` : 'Не удалось доставить администратору ❗️');
});

// на всякий случай оставим общий приём message (если кто-то отправит не web_app_data)
bot.on('message', async (ctx) => {
  if (ctx.message?.web_app_data) return; // уже обработали выше
  if ('text' in ctx.message) return;     // игнор обычных сообщений
});

app.get('/debug', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.use(express.json());

app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  const webhookUrl = `${process.env.APP_URL}/bot`;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Webhook set to ${webhookUrl}`);

    const me = await bot.telegram.getMe();
    console.log('[bot] logged in as @' + me.username, 'id=', me.id);
    console.log('[bot] ADMIN_CHAT_IDS =', ADMIN_CHAT_IDS);
  } catch (e) {
    console.error('❌ Failed to set webhook or get bot info:', e.message);
  }
});



process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

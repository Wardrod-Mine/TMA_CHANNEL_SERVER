// bot/index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const app = express();

const BOT_TOKEN     = process.env.BOT_TOKEN;
const APP_URL       = process.env.APP_URL;        // backend (Render server)
const FRONTEND_URL  = process.env.FRONTEND_URL;   // frontend (Static site)

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в .env');
if (!APP_URL)   console.warn('⚠️ APP_URL не задан — вебхук не установится');

// поддержка одного или нескольких админ-чатов
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const ADMIN_THREAD_ID = process.env.ADMIN_THREAD_ID ? Number(process.env.ADMIN_THREAD_ID) : null;

const bot = new Telegraf(BOT_TOKEN);

// === комманды(/start, /publish) ===
bot.start((ctx) => {
  return ctx.reply('📂 Добро пожаловать! Нажмите кнопку ниже, чтобы открыть каталог услуг:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Магазин решений',
            web_app: { url: FRONTEND_URL } 
          }
        ]
      ]
    }
  });
});

bot.command('publish', async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(String(ctx.from.id))) {
    return ctx.reply('⛔ Недостаточно прав для публикации.');
  }

  const channel = process.env.CHANNEL_ID;      
  const frontUrl = process.env.FRONTEND_URL;   
  const me = await ctx.telegram.getMe();     
  const botUsername = me.username;         

  const postText = `<b>🔥Мы запустили мини-приложение прямо в Telegram🔥 </b>
Больше не нужно писать вручную или искать куда написать — просто выбирай услугу в каталоге и оставляй заявку! 👇`;

  const inlineKeyboardForChannel = [
    [{ text: 'Каталог', url: `https://t.me/${botUsername}/${frontUrl ? `?startapp=catalog` : ''}` }]
  ];

  try {
    await ctx.telegram.sendMessage(channel, postText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineKeyboardForChannel }
    });
    await ctx.reply('✅ Пост с кнопкой «Каталог» опубликован в канал.');
  } catch (e) {
    await ctx.reply('❌ Не удалось отправить пост: ' + (e.description || e.message));
  }
});

// === утилиты ===
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt = (v) => v ? esc(v) : '—';
const who = (u) => {
  if (!u) return '—';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const un = u.username ? ` @${u.username}` : '';
  return `${esc(name)}${un} (id: <code>${u.id}</code>)`;
};

// === рассылка админам ===
async function notifyAdmins(ctx, html) {
  const targets = ADMIN_CHAT_IDS.length ? ADMIN_CHAT_IDS : [ctx.chat.id];
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

// === приём данных из WebApp ===
bot.on(message('web_app_data'), async (ctx) => {
  console.log('\n==== [web_app_data received] ====');
  console.log('[raw payload]:', ctx.message.web_app_data?.data);

  let data = null;
  try {
    data = JSON.parse(ctx.message.web_app_data.data);
    console.log('[parsed payload]:', data);
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
    return ctx.reply('⚠️ Ошибка: не удалось разобрать данные формы.');
  }

  const stamp = new Date().toLocaleString('ru-RU');

  const html =
    `📩 <b>Новая заявка из Mini App</b>\n\n` +
    `<b>Имя:</b> ${data.name || '—'}\n` +
    `<b>Телефон:</b> ${data.phone || '—'}\n` +
    (data.service ? `<b>Услуга:</b> ${data.service}\n` : '') +
    (data.comment ? `<b>Комментарий:</b> ${data.comment}\n` : '') +
    `\n<b>Отправитель:</b> ${ctx.from.first_name || ''} ${ctx.from.last_name || ''} ${ctx.from.username ? `(@${ctx.from.username})` : ''}` +
    `\n<b>Время:</b> ${stamp}`;

  console.log('[notifyAdmins] trying to send to:', ADMIN_CHAT_IDS);

  const ok = await notifyAdmins(ctx, html);

  console.log('[notifyAdmins] delivered count =', ok);

  if (ok > 0) {
    await ctx.reply('✅ Заявка успешно передана администратору!');
  } else {
    await ctx.reply('⚠️ Ошибка: не удалось доставить администратору.');
  }
});

async function notifyAdmins(ctx, html) {
  if (!ADMIN_CHAT_IDS.length) {
    console.warn('[notifyAdmins] ADMIN_CHAT_IDS is empty, fallback to ctx.chat.id');
  }

  const targets = ADMIN_CHAT_IDS.length ? ADMIN_CHAT_IDS : [ctx.chat.id];
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (ADMIN_THREAD_ID) extra.message_thread_id = ADMIN_THREAD_ID;

  let delivered = 0;
  for (const chatId of targets) {
    try {
      console.log(`[notifyAdmins] sending to ${chatId}...`);
      await ctx.telegram.sendMessage(chatId, html, extra);
      console.log(`[notifyAdmins] success -> ${chatId}`);
      delivered++;
    } catch (err) {
      console.error(`[notifyAdmins] failed -> ${chatId}`, err.message);
    }
  }
  return delivered;
}

// === Express + webhook ===
app.use(express.json());
app.use(bot.webhookCallback('/bot'));

app.get('/', (req, res) => res.send('Bot is running'));
app.get('/debug', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === запуск сервера ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (APP_URL) {
    const webhookUrl = `${APP_URL}/bot`;
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`✅ Webhook set to ${webhookUrl}`);

      const me = await bot.telegram.getMe();
      console.log(`[bot] logged in as @${me.username}, id=${me.id}`);
      console.log(`[bot] ADMIN_CHAT_IDS =`, ADMIN_CHAT_IDS);
    } catch (e) {
      console.error('❌ Failed to set webhook automatically:', e.message);
    }
  }
});

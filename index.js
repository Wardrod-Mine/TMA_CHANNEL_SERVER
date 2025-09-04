// index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в .env');
if (!APP_URL) console.warn('⚠️ APP_URL не задан — вебхук не установится');

const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const ADMIN_THREAD_ID = process.env.ADMIN_THREAD_ID ? Number(process.env.ADMIN_THREAD_ID) : null;

const bot = new Telegraf(BOT_TOKEN);

// === утилиты ===
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (v) => v ? esc(v) : '—';
const who = (u) => {
  if (!u) return '—';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const un = u.username ? ` @${u.username}` : '';
  return `${esc(name)}${un}`;
};

// === рассылка админам ===
async function notifyAdmins(ctx, html) {
  const targets = ADMIN_CHAT_IDS.length ? ADMIN_CHAT_IDS : [ctx.chat.id];
  const extra = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (ADMIN_THREAD_ID) extra.message_thread_id = ADMIN_THREAD_ID;

  let delivered = 0;
  for (const chatId of targets) {
    try {
      console.log(`[notifyAdmins] sending → ${chatId}`);
      await ctx.telegram.sendMessage(chatId, html, extra);
      console.log(`[notifyAdmins] success → ${chatId}`);
      delivered++;
    } catch (err) {
      console.error(`[notifyAdmins] failed → ${chatId}`, err.message);
    }
  }
  return delivered;
}

// === /start ===
bot.start((ctx) => {
  return ctx.reply('📂 Добро пожаловать! Нажмите кнопку ниже, чтобы открыть каталог услуг:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Каталог', web_app: { url: FRONTEND_URL } }]
      ]
    }
  });
});

// === test_admin ===
bot.command('test_admin', async (ctx) => {
  const html = `<b>🔔 Тестовое сообщение</b>\n\nОт: ${who(ctx.from)}`;
  const ok = await notifyAdmins(ctx, html);
  return ctx.reply(ok > 0 ? `✅ Доставлено ${ok} админу(ам)` : '❌ Не удалось доставить');
});

// === приём данных из WebApp ===
bot.on(message('web_app_data'), async (ctx) => {
  console.log('\n==== [web_app_data received] ====');
  console.log('[from.id]:', ctx.from?.id, 'username:', ctx.from?.username);
  console.log('[raw payload]:', ctx.message.web_app_data?.data);
  console.log('[ctx.message]:', JSON.stringify(ctx.message, null, 2));
  let data = null;
  try {

    data = JSON.parse(ctx.message.web_app_data.data);
    console.log('[parsed payload]:', data);
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
  }

  if (!data) {
    console.warn('[handler] payload empty → reply to user');
    return ctx.reply('⚠️ Ошибка: данные не распознаны.');
  }

  const stamp = new Date().toLocaleString('ru-RU');
  let html = '';

  // === разные типы заявок ===
  if (data.action === 'send_request' || data.action === 'send_request_form') {
    html =
      `📄 <b>Заявка (форма)</b>\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '') +
      (data.selected || data.product?.title ? `<b>Выбранный продукт:</b> ${fmt(data.selected || data.product.title)}\n` : '');
  }
  else if (data.type === 'lead' || data.action === 'consult') {
    html =
      `💬 <b>Запрос консультации</b>\n` +
      `<b>Имя:</b> ${fmt(data.name)}\n` +
      `<b>Телефон:</b> ${fmt(data.phone)}\n` +
      (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '');
  } 

 
  else {
    html =
      `📥 <b>Данные из ТМА</b>\n` +
      `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
  }

  html += `\n\n<b>От:</b> ${who(ctx.from)}\n<b>Время:</b> ${esc(stamp)}`;

  const ok = await notifyAdmins(ctx, html);

  console.log('[notifyAdmins] delivered =', ok);

  return ctx.reply(ok > 0
    ? '✅ Заявка успешно передана администратору!'
    : '❌ Не удалось доставить администратору.');
});

// === Express + webhook ===
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (APP_URL) {
    const webhookUrl = `${APP_URL}/bot`;
    try {
      const info = await bot.telegram.getWebhookInfo();

      if (info.url !== webhookUrl) {
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook установлен: ${webhookUrl}`);
      } else {
        console.log(`ℹ️ Webhook уже актуален: ${webhookUrl}`);
      }

      const me = await bot.telegram.getMe();
      console.log(`[bot] logged in as @${me.username}, id=${me.id}`);
      console.log(`[bot] ADMIN_CHAT_IDS =`, ADMIN_CHAT_IDS);
    } catch (e) {
      console.error('❌ Failed to set webhook automatically:', e.message);
    }
  }
});


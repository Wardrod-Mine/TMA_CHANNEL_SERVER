require('dotenv').config();
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const express = require('express');
const cors = require('cors'); // ← реально используем
const app = express();

const CHANNEL_ID = process.env.CHANNEL_ID || null;
const CHANNEL_THREAD_ID = process.env.CHANNEL_THREAD_ID ? Number(process.env.CHANNEL_THREAD_ID) : null;
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;


const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);

const ADMIN_THREAD_ID = process.env.ADMIN_THREAD_ID ? Number(process.env.ADMIN_THREAD_ID) : null;

if (!BOT_TOKEN) throw new Error('Нет BOT_TOKEN в .env');
if (!APP_URL) console.warn('⚠️ APP_URL не задан — вебхук не установится');
if (!ADMIN_CHAT_IDS.length) console.warn('⚠️ ADMIN_CHAT_IDS пуст — /lead не сможет доставить заявку.');

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

function isAdmin(id) {
  return ADMIN_CHAT_IDS.includes(Number(id));
}

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
bot.start(async (ctx) => {
  // общий привет + кнопка на TMA
  await ctx.reply('📂 Добро пожаловать! Нажмите кнопку ниже, чтобы открыть каталог услуг:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Каталог', web_app: { url: FRONTEND_URL } }]]
    }
  });

  // если это ЛС с админом — пришлём инструкцию по публикации
  if (ctx.chat?.type === 'private' && isAdmin(ctx.from?.id)) {
    const info = [
      '🛠 <b>Инструкция по публикации поста</b>',
      '',
      '1) Подготовьте текст поста <i>(можно прямо в Телеграм)</i>.',
      '2) Если нужен пост с фото — отправьте фото и напишите подпись (это будет текст поста).',
      '3) Ответьте командой на текст/фото:',
      '<code>/post Текст кнопки | https://example.com</code>',
      '',
      '👉 Куда уйдёт пост:',
      CHANNEL_ID
        ? `• По умолчанию в канал/чат: <code>${CHANNEL_ID}</code>${CHANNEL_THREAD_ID ? ` (топик ${CHANNEL_THREAD_ID})` : ''}`
        : '• В тот чат, где вы вызвали команду',
      '',
      'Примеры:',
      '• <code>/post Открыть каталог | https://t.me/PromouteBot?startapp=catalog</code> (ответом на сообщение с текстом)',
      '• <code>/post Записаться | https://site.ru</code> (ответом на фото с подписью)',
    ].join('\n');
    await ctx.reply(info, { parse_mode: 'HTML', disable_web_page_preview: true });
  }
});


// === test_admin ===
bot.command('test_admin', async (ctx) => {
  const html = `<b>🔔 Тестовое сообщение</b>\n\nОт: ${who(ctx.from)}`;
  const ok = await notifyAdmins(ctx, html);
  return ctx.reply(ok > 0 ? `✅ Доставлено ${ok} админу(ам)` : '❌ Не удалось доставить');
});

let RUNTIME_CHANNEL_ID = CHANNEL_ID;

bot.command('where', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  ctx.reply(
    [
      `ENV CHANNEL_ID: ${CHANNEL_ID || '—'}`,
      `RUNTIME_CHANNEL_ID: ${RUNTIME_CHANNEL_ID || '—'}`,
      `THREAD_ID: ${CHANNEL_THREAD_ID || '—'}`
    ].join('\n')
  );
});

// Быстрый тест отправки в канал
bot.command('post_test', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const target = RUNTIME_CHANNEL_ID || ctx.chat.id;
  try {
    await sendPost(
      {
        chatId: target,
        threadId: CHANNEL_THREAD_ID || undefined,
        text: 'Тестовый пост ✅\nЕсли вы это видите в канале — всё ок.',
        buttonText: 'Открыть',
        buttonUrl: 'https://example.com'
      },
      ctx.telegram
    );
    ctx.reply(`✅ Ушло в ${target}${CHANNEL_THREAD_ID ? ` (топик ${CHANNEL_THREAD_ID})` : ''}`);
  } catch (e) {
    // покажем точную причину Телеграма
    ctx.reply(`❌ Не отправилось: ${e.description || e.message}`);
  }
});

bot.command('bind', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const fwd = ctx.message.reply_to_message?.forward_from_chat;
  if (!fwd) return ctx.reply('Сделайте /bind ответом на ПЕРЕСЛАННОЕ из канала сообщение.');
  RUNTIME_CHANNEL_ID = fwd.id; // например -100xxxxxxxxxx
  ctx.reply(`✅ Привязал канал: ${RUNTIME_CHANNEL_ID}`);
});

// Ручная установка: /set_channel -100123.. или /set_channel @username
bot.command('set_channel', (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫');
  const arg = ctx.message.text.replace(/^\/set_channel(@\w+)?\s+/, '').trim();
  if (!arg) return ctx.reply('Укажи id канала (-100…) или @username.');
  RUNTIME_CHANNEL_ID = arg.startsWith('@') ? arg : Number(arg);
  ctx.reply(`✔️ Теперь публикуем в: ${RUNTIME_CHANNEL_ID}`);
});

bot.command('post', async (ctx) => {
  try {
    if (!isAdmin(ctx.from?.id)) {
      return ctx.reply('🚫 Недостаточно прав для публикации');
    }

    const raw = ctx.message.text.replace(/^\/post(@\w+)?\s*/i, '');
    const [firstLine, ...restLines] = raw.split('\n');
    const { text: btnText, url: btnUrl } = parseBtn(firstLine);

    // текст поста: из хвоста сообщения или из реплая (text/caption)
    let postText = restLines.join('\n').trim();
    const reply = ctx.message.reply_to_message;

    // если не ввели пост текстом в этой команде — забираем из реплая
    if (!postText && reply) {
      postText = (reply.caption || reply.text || '').trim();
    }

    // есть ли фото в реплае
    let photoFileId = null;
    if (reply?.photo?.length) {
      const p = pickLargestPhoto(reply.photo);
      photoFileId = p?.file_id || null;
    }

    if (!btnText || !btnUrl || !postText) {
      return ctx.reply(
        'Формат:\n' +
        '/post Текст кнопки | https://example.com\\nТекст поста\n' +
        'ИЛИ ответьте командой /post на сообщение с готовым текстом/фото+подписью.',
        { disable_web_page_preview: true }
      );
    }

    // куда публиковать
    const targetChatId = (typeof RUNTIME_CHANNEL_ID !== 'undefined' && RUNTIME_CHANNEL_ID) || CHANNEL_ID || ctx.chat.id;
    const threadId = CHANNEL_THREAD_ID || undefined;

    await sendPost(
      { chatId: targetChatId, threadId, text: postText, buttonText: btnText, buttonUrl: btnUrl, photoFileId },
      ctx.telegram
    );

    return ctx.reply(`✅ Пост отправлен в ${targetChatId}${threadId ? ` (топик ${threadId})` : ''}`);
  } catch (e) {
    console.error('post error:', e);
    return ctx.reply('❌ Ошибка отправки: ' + (e.description || e.message));
  }
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
app.use(express.json());
app.use(bot.webhookCallback('/bot'));
app.use(cors({
  origin: FRONTEND_URL ? [FRONTEND_URL] : true,
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type'],
}));

function parseBtn(line) {
  const [t, u] = (line || '').split('|');
  const text = (t || '').trim();
  const url = (u || '').trim();
  return { text, url };
}

function pickLargestPhoto(sizes) {
  if (!Array.isArray(sizes) || !sizes.length) return null;
  return sizes.reduce((a, b) => (a.file_size || 0) > (b.file_size || 0) ? a : b);
}

app.post('/lead', async (req, res) => {
  try {
    const data = req.body;
    console.log('\n==== [lead received] ====');
    console.log('[payload]:', data);

    if (!ADMIN_CHAT_IDS.length) {
      return res.status(400).json({ ok: false, error: 'ADMIN_CHAT_IDS is empty' });
    }

    const stamp = new Date().toLocaleString('ru-RU');
    let html = '';

    if (data.action === 'send_request_form') {
      html =
        `📄 <b>Заявка (форма)</b>\n` +
        `<b>Имя:</b> ${fmt(data.name)}\n` +
        `<b>Телефон:</b> ${fmt(data.phone)}\n` +
        (data.comment ? `<b>Комментарий:</b> ${fmt(data.comment)}\n` : '') +
        (data.service ? `<b>Услуга:</b> ${fmt(data.service)}\n` : '');
    } 
    else if (data.action === 'consult') {
      html =
        `💬 <b>Запрос консультации</b>\n` +
        `<b>Имя:</b> ${fmt(data.name)}\n` +
        `<b>Контакт:</b> ${fmt(data.contact)}\n` +
        (data.message ? `<b>Комментарий:</b> ${fmt(data.message)}\n` : '');
    }
    else {
      html =
        `📥 <b>Данные из ТМА</b>\n` +
        `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
    }

    html += `\n\n<b>Время:</b> ${esc(stamp)}`;

    const ok = await notifyAdmins({ telegram: bot.telegram, chat: { id: ADMIN_CHAT_IDS[0] } }, html);
    console.log('[notifyAdmins] delivered =', ok);
    res.json({ ok: true, delivered: ok });
  } catch (err) {
    console.error('❌ /lead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function sendPost({ chatId, threadId, text, buttonText, buttonUrl, photoFileId }, tg) {
  if (!buttonText || !buttonUrl) throw new Error('Не заполнены текст кнопки или URL');
  if (!/^https?:\/\//i.test(buttonUrl)) throw new Error('URL кнопки должен начинаться с http(s)://');

  const baseExtra = {
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    reply_markup: { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
  };

  const tryOnce = async (withThread) => {
    const extra = withThread && threadId ? { ...baseExtra, message_thread_id: threadId } : baseExtra;
    if (photoFileId) {
      return tg.sendPhoto(chatId, photoFileId, { caption: text, ...extra });
    }
    return tg.sendMessage(chatId, text, extra);
  };

  try {
    return await tryOnce(true);      // пробуем с threadId (если задан)
  } catch (e) {
    const msg = String(e.description || e.message || '').toLowerCase();
    const threadProblem =
      msg.includes('message_thread_id') ||
      msg.includes('topic') ||
      msg.includes('forum') ||
      msg.includes('thread');

    if (threadId && threadProblem) {
      // повтор без threadId — нужно для каналов
      return await tryOnce(false);
    }
    throw e;
  }
}

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


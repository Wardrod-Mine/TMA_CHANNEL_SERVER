// ====== УТИЛИТЫ/DOM ===========================================================
const $ = (sel, root = document) => root.querySelector(sel);

const listView = $('#listView');
const detailView = $('#detailView');
const cardsRoot = $('#cards');
const detailImg = $('#detailImg');
const detailTitle = $('#detailTitle');
const detailShort = $('#detailShort');
const detailBullets = $('#detailBullets');
const detailLong = $('#detailLong');
const usernameSlot = $('#usernameSlot');
const backBtn = $('#backBtn');          // <-- правильное имя
const consultBtn = $('#consultBtn');
const buyBtn = $('#buyBtn');
const cartBtn = $('#cartBtn');
const cartCount = $('#cartCount');
const toastEl = $('#toast');

// Модалка консультации
const consultModal = $('#consultModal');
const consultForm = $('#consultForm');
const consultCancel = $('#consultCancel');
const consultProductTitle = $('#consultProductTitle');
const cName = $('#cName');
const cContact = $('#cContact');
const cMsg = $('#cMsg');

// ====== TELEGRAM WEBAPP =======================================================
const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg && typeof tg.initData !== 'undefined');

// Новая модалка заявки
const requestModal = $('#requestModal');
const requestForm = $('#requestForm');
const requestCancel = $('#requestCancel');
const requestProductTitle = $('#requestProductTitle');
const rPhone = $('#rPhone');
const rName = $('#rName');
const rUseUsername = $('#rUseUsername');
const rUsernamePreview = $('#rUsernamePreview');
const rCity = $('#rCity');
const rComment = $('#rComment');

// Кнопка консультации на главном экране
const consultBtnMain = $('#consultBtnMain');

let requestContext = null;

function closeRequest(){
  requestModal?.classList.add('hidden');
  requestContext = null;
}

// Утилиты для плавных модалок
function modalShow(el){
  el.classList.remove('hidden');
  requestAnimationFrame(()=> el.classList.add('show'));
}
function modalHide(el){
  el.classList.remove('show');
  setTimeout(()=> el.classList.add('hidden'), 200);
}

function openRequest(product){
  requestContext = product || null;

  if (requestProductTitle) {
    requestProductTitle.textContent = product ? product.title : '';
  }

  const tUser = tg?.initDataUnsafe?.user;
  if (tUser && rName && !rName.value.trim()) {
    rName.value = [tUser.first_name, tUser.last_name].filter(Boolean).join(' ');
  }

  if (rPhone) rPhone.value = '';
  if (rCity && !rCity.value) rCity.value = 'Санкт-Петербург';
  if (rComment) rComment.value = '';

  if (requestModal) modalShow(requestModal);
}



requestCancel.addEventListener('click', closeRequest);
// Закрытие по клику на фон
requestModal.addEventListener('click', (e)=>{
  if (e.target === requestModal) closeRequest();
});

requestForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const name  = rName?.value?.trim()  || '';
  const phone = rPhone?.value?.trim() || '';
  const city  = (window.rCity?.value || '').trim();
  const comment = (window.rComment?.value || '').trim();

  // простая валидация «как в примере»
  const okName  = name.length >= 2;
  const okPhone = /^[+0-9()\-\s]{6,}$/.test(phone);
  if (!okName || !okPhone) { toast('Заполните имя и корректный телефон'); return; }

  // берём название услуги из карточки (если есть)
  const serviceTitle = requestContext ? requestContext.title : 'Заявка';

  const payload = {
    type: 'lead',
    action: 'send_request_form',
    ts: Date.now(),
    service: serviceTitle,
    name,
    phone,
    city,
    comment,
    include_username: Boolean(tg?.initDataUnsafe?.user?.username),
    username: tg?.initDataUnsafe?.user?.username || null,
    from: tg?.initDataUnsafe?.user || null
  };

  try {
    if (window.Telegram?.WebApp?.sendData) {
      console.log('[Request Form] Sending data via sendData...');
      window.Telegram.WebApp.sendData(JSON.stringify(payload));
      console.log('[Request Form] sendData called');
    } else {
      console.warn('[Request Form] sendData not available');
    }

    tg?.HapticFeedback?.notificationOccurred?.('success');
    toast('Заявка отправлена');
    closeRequest();
  } catch (err) {
    console.error('[Request Form] sendData error:', err);
    tg?.HapticFeedback?.notificationOccurred?.('error');
    tg?.showAlert?.('Не удалось отправить заявку');
  }
});


if (inTelegram) {
  tg.ready();
  tg.expand();
  if (tg?.BackButton?.onClick) {
    tg.BackButton.onClick(() => { if (location.hash.startsWith('#/product/')) location.hash = '#/'; })};
  tg.onEvent('themeChanged', applyThemeFromTelegram);
  const username = tg.initDataUnsafe?.user?.username;
  if (username) usernameSlot.textContent = `@${username}`;
  backBtn.addEventListener('click', () => { if (location.hash.startsWith('#/product/')) location.hash = '#/'; });
} else {
  usernameSlot.textContent = 'Откройте через Telegram для полного функционала';
}

function applyThemeFromTelegram() {
  if (!inTelegram) return;
  const tp = tg.themeParams || {};
  const root = document.documentElement;
  const set = (v, val, fb) => root.style.setProperty(v, val || fb);
  set('--bg', tp.bg_color, '#0e1117');
  set('--text', tp.text_color, '#e6edf3');
  set('--hint', tp.hint_color, '#8b949e');
  set('--link', tp.link_color, '#4495ff');
  set('--btn', tp.button_color, '#2ea043');
  set('--btn-text', tp.button_text_color, '#ffffff');
  set('--card', tp.secondary_bg_color, '#161b22');
  set('--sep', tp.section_separator_color, 'rgba(255,255,255,.08)');
}
applyThemeFromTelegram();

// ====== СОСТОЯНИЕ КОРЗИНЫ/ЗАЯВКИ =============================================
let CART = loadCart();
function loadCart(){ try{ return JSON.parse(sessionStorage.getItem('cart') || '{"items":[]}'); }catch(e){ return {items:[]}; } }
function saveCart(){ sessionStorage.setItem('cart', JSON.stringify(CART)); }
function inCart(id){ return CART.items.some(x => x.id === id); }

// ====== ДАННЫЕ ТОВАРОВ ========================================================
const PRODUCTS = [
  { id:'tma', title:'Telegram Mini App (ТМА)', img:'https://placehold.co/800x500/png?text=Telegram+Mini+App',
    short:'Готовое мини-приложение в Telegram: быстрый старт, нативные кнопки, светлая/тёмная тема.',
    long:[
      'Идеально для витрин, форм заявок и мини-сервисов внутри Telegram.',
      'Поддержка MainButton/BackButton, themeParams, sendData для связи с ботом.',
      'Быстрый деплой на любой статический хостинг и готовность к модерации.'
    ],
    bullets:[
      'Поддержка Telegram.WebApp API (MainButton, BackButton, theme)',
      'Готовая структура для каталога/форм/оплаты',
      'Быстрый деплой на любой статический хостинг'
    ]},
  { id:'tg-bot', title:'TG-бот (классический бот)', img:'https://placehold.co/800x500/png?text=Telegram+Bot',
    short:'Бот с командами, меню и кнопками — для поддержки, продаж, заявок и автоматизации.',
    long:[
      'Подходит для рассылок, обработки заявок, FAQ и интеграций.',
      'Варианты подключения: webhook или long polling.',
      'Готовые сценарии для быстрых запусков.'
    ],
    bullets:[
      'Inline-кнопки, меню, webhooks/long-polling',
      'Интеграции (CRM, таблицы, платежи)',
      'Готовые шаблоны сценариев'
    ]},
  { id:'tma-chatbot', title:'ТМА с чат-ботом', img:'https://placehold.co/800x500/png?text=TMA+%2B+Chatbot',
    short:'Комбо: мини-приложение + диалоговый ассистент. Витрина + умные ответы в одном окне.',
    long:[
      'Показывайте товары/услуги во фронте ТМА и отвечайте на вопросы диалогом в чате.',
      'Сбор лидов через sendData, аналитика источников, масштабирование сценариев.',
      'Удобно для продаж и поддержки внутри одного UX.'
    ],
    bullets:[
      'UI на WebApp + диалог в чате',
      'Отправка заявок из ТМА в бота',
      'Готово к масштабированию'
    ]},
];

// ====== UI ВСПОМОГАТЕЛЬНЫЕ ====================================================
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = '1';
  setTimeout(()=>{ toastEl.style.opacity='0'; setTimeout(()=>toastEl.classList.add('hidden'),200); },1600);
}

function updateCartUI(){
  const n = CART.items.length;
  cartCount.textContent = n;
  if (n>0) {
    cartBtn.classList.remove('hidden');
    if (inTelegram) {
      tg.MainButton.setParams({ text: `Отправить заявку (${n})` });
      tg.MainButton.show();
      tg.offEvent?.('mainButtonClicked');
      tg.onEvent('mainButtonClicked', sendCart);
    }
  } else {
    cartBtn.classList.add('hidden');
    if (!location.hash.startsWith('#/product/') && inTelegram) {
      tg.MainButton.hide();
      tg.offEvent?.('mainButtonClicked');
    }
  }
}

// ====== КАРТОЧКИ ==============================================================
function renderCards() {
  cardsRoot.innerHTML = '';
  PRODUCTS.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'card rounded-xl overflow-hidden transition hover:scale-[1.01] card-appear';
    card.style.setProperty('--delay', `${i * 60}ms`);

    const link = document.createElement('a');
    link.href = `#/product/${p.id}`;
    link.setAttribute('aria-label', `Подробнее: ${p.title}`);
    link.className = 'block';

    const img = document.createElement('img');
    img.src = p.img;
    img.alt = p.title;
    img.loading = 'lazy';
    img.className = 'w-full img-cover';
    link.appendChild(img);

    const body = document.createElement('div');
    body.className = 'p-4 space-y-2';

    const h3 = document.createElement('h3');
    h3.textContent = p.title;
    h3.className = 'font-semibold';

    const small = document.createElement('p');
    small.textContent = p.short;
    small.className = 'text-sm muted';

    const more = document.createElement('a');
    more.href = `#/product/${p.id}`;
    more.className = 'link text-sm';
    more.textContent = 'Подробнее →';

    body.append(h3, small, more);
    card.append(link, body);
    cardsRoot.appendChild(card);
  });
}

function switchViews(hideEl, showEl) {
  if (hideEl && !hideEl.classList.contains('hidden')) {
    hideEl.classList.remove('view-enter'); hideEl.classList.add('view-leave');
    setTimeout(() => {
      hideEl.classList.add('hidden'); hideEl.classList.remove('view-leave');
      showEl.classList.remove('hidden'); showEl.classList.add('view-enter');
      setTimeout(() => showEl.classList.remove('view-enter'), 220);
    }, 180);
  } else {
    showEl.classList.remove('hidden'); showEl.classList.add('view-enter');
    setTimeout(() => showEl.classList.remove('view-enter'), 220);
  }
}

// ====== ОТПРАВКА ==============================================================
function prepareSend(product, action, viaMainButton = false) {
  const payload = {
    v: 1,
    type: 'lead',
    action, // 'send_request'
    product: { id: product.id, title: product.title },
    at: new Date().toISOString()
  };

  console.log('[buyBtn] click. payload ->', payload);

  if (!inTelegram) {
    alert('Откройте через Telegram, чтобы отправить заявку.\n\n' + JSON.stringify(payload, null, 2));
    return;
  }

  try {
    const tgwa = window.Telegram?.WebApp;
    if (tg?.sendData) tg.sendData(JSON.stringify(payload));
    else if (tgwa?.sendData) tgwa.sendData(JSON.stringify(payload));
    else throw new Error('Telegram.WebApp.sendData недоступен');

    tg?.HapticFeedback?.notificationOccurred?.('success');
    toast('Заявка отправлена');
    if (viaMainButton) {
      tg.MainButton.setParams({ text: 'Заявка отправлена ✅' });
      setTimeout(() => tg.MainButton.setParams({ text: `Отправить заявку: ${product.title}` }), 1500);
    }
  } catch (err) {
    console.error('[sendData] error:', err);
    tg?.HapticFeedback?.notificationOccurred?.('error');
    // системное окно Telegram (если доступно)
    try { window.Telegram?.WebApp?.showAlert?.('Ошибка отправки: ' + err.message); } catch {}
    toast('Ошибка отправки: ' + (err?.message || 'неизвестно'));
  }
}



// Корзина
function addToCart(product){
  if (inCart(product.id)) { toast('Уже в заявке'); return; }
  CART.items.push({ id: product.id, title: product.title });
  saveCart(); toast('Добавлено в заявку'); tg?.HapticFeedback?.notificationOccurred?.('success'); updateCartUI();
}
function sendCart(){
  if (CART.items.length === 0) return;
  const payload = { v:1, type:'lead', action:'send_cart', items:CART.items, at:new Date().toISOString() };
  if (inTelegram) {
    window.Telegram.WebApp.sendData(JSON.stringify(payload));
    tg.MainButton.setParams({ text:'Заявка отправлена ✅' });
    setTimeout(()=> updateCartUI(), 1500);
  } else alert('Demo sendData:\n'+JSON.stringify(payload,null,2));
  CART = { items:[] }; saveCart(); updateCartUI();
}
cartBtn.addEventListener('click', ()=>{ if (CART.items.length) sendCart(); });

// Консультация
let consultContext = null;
function openConsult(product){
  consultContext = product || null;
  consultProductTitle.textContent = product ? product.title : 'Общая консультация';
  cName.value = ''; cContact.value = ''; cMsg.value = '';
  modalShow(consultModal);
}
function closeConsult(){ modalHide(consultModal); consultContext = null; }

consultCancel.addEventListener('click', closeConsult);
// Клик по фону — закрыть
consultModal.addEventListener('click', (e)=>{
  if (e.target === consultModal) closeConsult();
});

// Кнопка на главном экране
if (consultBtnMain) {
  consultBtnMain.addEventListener('click', () => openConsult(null));
}

// Отправка консультации
consultForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const contact = cContact.value.trim();
  if (!contact) { toast('Укажите контакт'); return; }

  const payload = {
    v: 1,
    type: 'lead',
    action: 'consult',
    product: consultContext ? { id: consultContext.id, title: consultContext.title } : null,
    name: cName.value.trim() || null,
    contact,
    message: cMsg.value.trim() || null,
    at: new Date().toISOString()
  };

  if (inTelegram) {
    window.Telegram.WebApp.sendData(JSON.stringify(payload));
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } else {
    alert('Demo sendData:\n' + JSON.stringify(payload, null, 2));
  }

  closeConsult();
  toast('Запрос отправлен');
});


// ====== ЭКРАНЫ ================================================================
function showDetail(productId){
  const p = PRODUCTS.find(x => x.id === productId);
  if (!p) return showList();

  detailImg.src = p.img; detailImg.alt = p.title;
  detailTitle.textContent = p.title; detailShort.textContent = p.short;

  detailBullets.innerHTML = '';
  const ul = document.createElement('ul'); ul.className = 'list-disc ml-5';
  p.bullets.forEach(b => { const li=document.createElement('li'); li.textContent=b; ul.appendChild(li); });
  detailBullets.appendChild(ul);

  detailLong.innerHTML = '';
  (p.long||[]).forEach(par => { const el=document.createElement('p'); el.textContent=par; detailLong.appendChild(el); });

  // кнопки
  backBtn.classList.remove('hidden');

  if (consultBtn) consultBtn.onclick = () => openConsult(p);

  // Оставляем только «Отправить заявку»
  buyBtn.textContent = 'Отправить заявку';
  buyBtn.onclick = () => openRequest(p);


  switchViews(listView, detailView);

  if (inTelegram) {
    tg.MainButton.hide();
    tg.offEvent?.('mainButtonClicked');
  }
}

function showList(){
  backBtn.classList.add('hidden');
  switchViews(detailView, listView);
  if (inTelegram) {
    tg.BackButton.hide();
    tg.MainButton.hide();
    tg.offEvent?.('mainButtonClicked');
  }
  updateCartUI();
}

// ====== РОУТЕР/СТАРТ ==========================================================
function router(){
  const hash = location.hash || '#/';
  if (hash.startsWith('#/product/')) showDetail(hash.replace('#/product/',''));
  else showList();
}

function getStartParam(){
  const fromInit = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const sp = new URLSearchParams(location.search);
  return (fromInit || sp.get('tgWebAppStartParam') || sp.get('s') || '').trim();
}
function handleStartParam(raw){
  if (!raw) return;
  const v = String(raw).toLowerCase();
  const alias = { tgbot:'tg-bot', 'tma+chatbot':'tma-chatbot', tma_chatbot:'tma-chatbot' };
  let id = v.startsWith('product:') ? v.split(':')[1] : v; id = alias[id] || id;
  if (['tma','tg-bot','tma-chatbot'].includes(id)) location.hash = `#/product/${id}`;
}

renderCards();
updateCartUI();
handleStartParam(getStartParam());
window.addEventListener('hashchange', router);
router();

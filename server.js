const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN = process.env.ADMIN_ID;
const PORT = process.env.PORT || 3000;
const ORIGIN = 'https://axror08.github.io';
const SELF = process.env.RENDER_EXTERNAL_URL || 'https://hamusta-server.onrender.com';
const SECRET = crypto.createHash('sha256').update(TOKEN || '').digest('hex').slice(0, 32);

// Ustalar ro'yxati: ustalar.json faylidan o'qiladi
const ustalar = () => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'ustalar.json'), 'utf8')); }
  catch (e) { return []; }
};

async function tg(method, data) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return r.ok;
  } catch (e) { return false; }
}
const send = (chat, text, extra) => tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...extra });
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';

// Buyurtmalar ombori: Upstash Redis (UPSTASH_URL, UPSTASH_TOKEN) bo'lsa o'sha, bo'lmasa xotira
const UP = process.env.UPSTASH_URL, UT = process.env.UPSTASH_TOKEN;
const mem = { o: new Map(), u: new Map() };
async function redis(cmd) {
  const r = await fetch(UP, { method: 'POST', headers: { Authorization: 'Bearer ' + UT }, body: JSON.stringify(cmd) });
  return (await r.json()).result;
}
async function saveOrder(o) {
  if (UP) await redis(['SET', 'o:' + o.id, JSON.stringify(o), 'EX', 2592000]); else mem.o.set(o.id, o);
  logSheet(o);
}

// Google Sheets hisobi (Apps Script veb-ilova): har o'zgarishda qatorni yangilaydi
const HOLAT = ['Yuborildi', 'Qabul qilindi', 'Yo‘lda', 'Ish tugadi'];
async function logSheet(o) {
  if (!process.env.SHEETS_URL) return;
  try {
    await fetch(process.env.SHEETS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ secret: process.env.SHEETS_SECRET, order: { id: o.id, ts: o.ts, mijoz: o.mijoz, usta: o.usta, kasb: o.kasb, item: o.item, price: o.price, holat: o.rej ? 'Rad etildi' : HOLAT[o.step], pay: o.pay, rate: o.rate } })
    });
  } catch (e) {}
}
async function getOrder(id) { if (UP) { const v = await redis(['GET', 'o:' + id]); return v ? JSON.parse(v) : null; } return mem.o.get(id) || null; }
async function addUserOrder(c, id) {
  if (UP) { await redis(['LPUSH', 'u:' + c, id]); await redis(['LTRIM', 'u:' + c, 0, 19]); }
  else mem.u.set(String(c), [id, ...(mem.u.get(String(c)) || [])].slice(0, 20));
}
async function userOrders(c) {
  const ids = UP ? await redis(['LRANGE', 'u:' + c, 0, 19]) : (mem.u.get(String(c)) || []);
  return (await Promise.all((ids || []).map(getOrder))).filter(Boolean);
}
const pub = r => ({ id: r.id, cat: r.cat, item: r.item, price: r.price, usta: r.usta, kasb: r.kasb, time: r.time, addr: r.addr, step: r.step, rej: r.rej, pay: r.pay, rate: r.rate });

// Telegram Mini App initData imzosini tekshiradi
function checkInitData(initData) {
  const p = new URLSearchParams(initData || '');
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  if (crypto.createHmac('sha256', key).update(str).digest('hex') !== hash) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const btn = (text, act, a, b, c) => ({ text, callback_data: [act, a, b, c].filter(v => v !== undefined).join(':') });
const NEXT = {
  acc: { status: '✅ Qabul qilindi', kb: (c, o, p) => [[btn('🚗 Yo‘ldaman', 'way', c, o, p)]], cust: (u, o) => `✅ <b>${esc(u.ism)}</b> buyurtmangizni (№${o}) qabul qildi.` },
  way: { status: '🚗 Yo‘lda', kb: (c, o, p) => [[btn('🏁 Ish tugadi', 'done', c, o, p)]], cust: () => '🚗 Usta yo‘lga chiqdi.' },
  done: {
    status: '🏁 Ish tugadi', kb: () => [],
    cust: (u, o, p) => `🏁 <b>Ish tugadi.</b>\n\n💰 To‘lov: ${money(p)}\nTo‘lov usulini tanlang:`,
    extra: (u, o, p) => ({ reply_markup: { inline_keyboard: [[btn('💵 Naqd to‘ladim', 'pc', u.id, o, p), btn('💳 Karta orqali', 'pk', u.id, o, p)]] } })
  },
  rej: { status: '❌ Rad etildi', kb: () => [], cust: () => '😔 Afsuski, usta hozir band. Boshqa usta tanlab, qayta buyurtma bering.' }
};

// Mijoz tugma bosganda: to'lov usuli va baho
async function onCustomer(cq, act, ustaId, ord, x) {
  const usta = ustalar().find(u => String(u.id) === String(ustaId));
  const edit = (text, kb) => tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text, reply_markup: { inline_keyboard: kb } });
  await tg('answerCallbackQuery', { callback_query_id: cq.id });
  if (!usta) return;
  const rec = await getOrder(ord);
  if (rec) { if (act === 'rt') rec.rate = Number(x) || 0; else rec.pay = act === 'pc' ? 'naqd' : 'karta'; await saveOrder(rec); }
  if (act === 'rt') {
    await edit(`⭐ Bahoyingiz: ${x}/5. Rahmat!`, []);
    return send(ADMIN, `⭐ №${ord}: ${esc(usta.ism)} — ${x}/5`);
  }
  const how = act === 'pc' ? 'naqd' : 'karta orqali';
  const sum = money(Number(x) || 0);
  let txt = `✅ To‘lov usuli: ${how} (${sum})`;
  if (act === 'pk') txt += usta.karta ? `\n\n💳 Karta: ${usta.karta}\nUsta: ${usta.ism}\nShu kartaga ${sum} o‘tkazing.` : '\n\nUsta kartasi hozircha kiritilmagan, ustadan so‘rang.';
  await edit(txt + '\n\nUstani baholang:', [[1, 2, 3, 4, 5].map(n => btn(`${n} ⭐`, 'rt', usta.id, ord, n))]);
  const info = `💰 №${ord}: mijoz ${how} to‘lashini tanladi (${sum}).`;
  await send(usta.id, info);
  await send(ADMIN, `${info}\n👷 Usta: ${esc(usta.ism)}`);
}

// Tugma bosilganda (Telegram webhook)
async function onCallback(cq) {
  const [act, cust, ord, price] = (cq.data || '').split(':');
  if (['pc', 'pk', 'rt'].includes(act)) return onCustomer(cq, act, cust, ord, price);
  const usta = ustalar().find(x => String(x.id) === String(cq.from.id));
  const step = NEXT[act];
  if (!usta || !step) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const p = Number(price) || 0;
  const rec = await getOrder(ord);
  if (rec) { if (act === 'rej') rec.rej = true; else rec.step = { acc: 1, way: 2, done: 3 }[act]; await saveOrder(rec); }
  const base = (cq.message.text || '').split('\n\n— ')[0];
  await tg('editMessageText', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
    text: `${base}\n\n— ${step.status}`, reply_markup: { inline_keyboard: step.kb(cust, ord, p) }
  });
  await tg('answerCallbackQuery', { callback_query_id: cq.id });
  await send(cust, step.cust(usta, ord, p), step.extra && step.extra(usta, ord, p));
  await send(ADMIN, `ℹ️ №${ord}: ${esc(usta.ism)} — ${step.status}`);
}

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  const reply = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET' && req.url === '/ustalar') {
    return reply(200, ustalar().map((u, i) => ({ i, ism: u.ism, kasb: u.kasb })));
  }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Hamusta server ishlayapti'); }
  if (req.method !== 'POST' || !['/order', '/webhook', '/myorders'].includes(req.url)) { res.writeHead(404, cors); return res.end(); }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', async () => {
    try {
      if (req.url === '/webhook') {
        if (req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return reply(403, {});
        reply(200, {});
        const up = JSON.parse(body);
        if (up.callback_query) await onCallback(up.callback_query);
        return;
      }
      if (req.url === '/myorders') {
        const u = checkInitData(JSON.parse(body).initData);
        if (!u) return reply(401, {});
        return reply(200, { orders: (await userOrders(u.id)).map(pub) });
      }
      const { initData, order: o } = JSON.parse(body);
      const user = checkInitData(initData);
      if (!user) return reply(401, { ok: false, error: 'initData noto‘g‘ri' });
      const usta = ustalar()[o.ustaIdx];
      if (!usta) return reply(400, { ok: false, error: 'usta topilmadi' });

      const ord = Date.now().toString(36).slice(-5).toUpperCase();
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
      const link = user.username ? '@' + user.username : `<a href="tg://user?id=${user.id}">profil</a>`;
      const text =
        `🆕 <b>Yangi buyurtma №${ord}</b>\n\n` +
        `🛠 <b>${esc(o.item)}</b> (${esc(o.cat)})\n` +
        `💰 ${money(Number(o.price) || 0)}\n` +
        `🕒 Vaqt: ${esc(o.time)}\n` +
        `📍 Manzil: ${esc(o.addr)}\n` +
        (o.note ? `📝 Izoh: ${esc(o.note)}\n` : '') +
        `\n👤 Mijoz: ${esc(name)} ${link}`;

      const toUsta = await send(usta.id, text, {
        reply_markup: { inline_keyboard: [[btn('✅ Qabul qilaman', 'acc', user.id, ord, Number(o.price) || 0), btn('❌ Rad etaman', 'rej', user.id, ord, Number(o.price) || 0)]] }
      });
      if (!toUsta) {
        await send(ADMIN, `⚠️ №${ord}: usta ${esc(usta.ism)} ga xabar yetmadi (usta botga Start bosmagan bo‘lishi mumkin).`);
        return reply(502, { ok: false });
      }
      const rec = { id: ord, ts: new Date().toISOString(), mijoz: name + (user.username ? ' @' + user.username : ''), cust: user.id, cat: o.cat, item: o.item, price: Number(o.price) || 0, usta: usta.ism, kasb: usta.kasb, time: o.time, addr: o.addr, step: 0, rej: false, pay: null, rate: 0 };
      await saveOrder(rec);
      await addUserOrder(user.id, ord);
      await send(ADMIN, `${text}\n\n👷 Usta: ${esc(usta.ism)}`);
      await send(user.id, `✅ <b>Buyurtmangiz (№${ord}) ustaga yuborildi</b>\n\n🛠 ${esc(o.item)}\n💰 ${money(Number(o.price) || 0)}\n📍 ${esc(o.addr)}\n\nUsta tasdiqlashi bilan sizga xabar beramiz.`);
      reply(200, { ok: true, order: pub(rec) });
    } catch (e) {
      reply(400, { ok: false });
    }
  });
});

server.listen(PORT, () => {
  console.log('Hamusta server ' + PORT + ' portda ishlayapti');
  if (TOKEN) tg('setWebhook', { url: SELF + '/webhook', secret_token: SECRET, allowed_updates: ['callback_query'] });
});

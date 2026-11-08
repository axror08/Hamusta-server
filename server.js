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

const btn = (text, act, cust, ord) => ({ text, callback_data: `${act}:${cust}:${ord}` });
const NEXT = {
  acc: { status: '✅ Qabul qilindi', kb: (c, o) => [[btn('🚗 Yo‘ldaman', 'way', c, o)]], cust: (u, o) => `✅ <b>${esc(u.ism)}</b> buyurtmangizni (№${o}) qabul qildi.` },
  way: { status: '🚗 Yo‘lda', kb: (c, o) => [[btn('🏁 Ish tugadi', 'done', c, o)]], cust: () => '🚗 Usta yo‘lga chiqdi.' },
  done: { status: '🏁 Ish tugadi', kb: () => [], cust: () => '🏁 Ish tugadi. Hamusta’dan foydalanganingiz uchun rahmat!' },
  rej: { status: '❌ Rad etildi', kb: () => [], cust: () => '😔 Afsuski, usta hozir band. Boshqa usta tanlab, qayta buyurtma bering.' }
};

// Usta tugma bosganda (Telegram webhook)
async function onCallback(cq) {
  const usta = ustalar().find(x => String(x.id) === String(cq.from.id));
  const [act, cust, ord] = (cq.data || '').split(':');
  const step = NEXT[act];
  if (!usta || !step) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const base = (cq.message.text || '').split('\n\n— ')[0];
  await tg('editMessageText', {
    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
    text: `${base}\n\n— ${step.status}`, reply_markup: { inline_keyboard: step.kb(cust, ord) }
  });
  await tg('answerCallbackQuery', { callback_query_id: cq.id });
  await send(cust, step.cust(usta, ord));
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
  if (req.method !== 'POST' || !['/order', '/webhook'].includes(req.url)) { res.writeHead(404, cors); return res.end(); }

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
        reply_markup: { inline_keyboard: [[btn('✅ Qabul qilaman', 'acc', user.id, ord), btn('❌ Rad etaman', 'rej', user.id, ord)]] }
      });
      if (!toUsta) {
        await send(ADMIN, `⚠️ №${ord}: usta ${esc(usta.ism)} ga xabar yetmadi (usta botga Start bosmagan bo‘lishi mumkin).`);
        return reply(502, { ok: false });
      }
      await send(ADMIN, `${text}\n\n👷 Usta: ${esc(usta.ism)}`);
      await send(user.id, `✅ <b>Buyurtmangiz (№${ord}) ustaga yuborildi</b>\n\n🛠 ${esc(o.item)}\n💰 ${money(Number(o.price) || 0)}\n📍 ${esc(o.addr)}\n\nUsta tasdiqlashi bilan sizga xabar beramiz.`);
      reply(200, { ok: true });
    } catch (e) {
      reply(400, { ok: false });
    }
  });
});

server.listen(PORT, () => {
  console.log('Hamusta server ' + PORT + ' portda ishlayapti');
  if (TOKEN) tg('setWebhook', { url: SELF + '/webhook', secret_token: SECRET, allowed_updates: ['callback_query'] });
});

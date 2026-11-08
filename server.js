const http = require('http');
const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN = process.env.ADMIN_ID;
const PORT = process.env.PORT || 3000;
const ORIGIN = 'https://axror08.github.io';

// Telegram Mini App initData imzosini tekshiradi (soxta buyurtmalardan himoya)
function checkInitData(initData) {
  const p = new URLSearchParams(initData || '');
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const h = crypto.createHmac('sha256', key).update(str).digest('hex');
  if (h !== hash) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const money = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' so‘m';

async function sendToAdmin(text) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN, text, parse_mode: 'HTML' })
  });
  return r.ok;
}

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Hamusta server ishlayapti'); }
  if (req.method !== 'POST' || req.url !== '/order') { res.writeHead(404, cors); return res.end(); }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
  req.on('end', async () => {
    const reply = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      const { initData, order: o } = JSON.parse(body);
      const user = checkInitData(initData);
      if (!user) return reply(401, { ok: false, error: 'initData noto‘g‘ri' });
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
      const link = user.username ? '@' + user.username : `<a href="tg://user?id=${user.id}">profil</a>`;
      const text =
        `🆕 <b>Yangi buyurtma</b>\n\n` +
        `🛠 <b>${esc(o.item)}</b> (${esc(o.cat)})\n` +
        `💰 ${money(Number(o.price) || 0)}\n` +
        `👷 Usta: ${esc(o.usta)}\n` +
        `🕒 Vaqt: ${esc(o.time)}\n` +
        `📍 Manzil: ${esc(o.addr)}\n` +
        (o.note ? `📝 Izoh: ${esc(o.note)}\n` : '') +
        `\n👤 Mijoz: ${esc(name)} ${link}`;
      const ok = await sendToAdmin(text);
      reply(ok ? 200 : 502, { ok });
    } catch (e) {
      reply(400, { ok: false });
    }
  });
});

server.listen(PORT, () => console.log('Hamusta server ' + PORT + ' portda ishlayapti'));

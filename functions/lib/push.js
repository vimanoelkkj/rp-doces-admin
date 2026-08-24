import { logEvent } from "./logger.js";

const enc = new TextEncoder();

function b64urlToBytes(value) {
  const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function bytesToB64url(bytes) {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function concat(...parts) {
  const len = parts.reduce((n,p)=>n+p.length,0), out = new Uint8Array(len);
  let off=0; for (const p of parts){out.set(p,off);off+=p.length} return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdfExpand(prk, info, length) {
  let t = new Uint8Array(0), out = new Uint8Array(0), counter = 1;
  while (out.length < length) {
    t = await hmac(prk, concat(t, info, new Uint8Array([counter++])));
    out = concat(out, t);
  }
  return out.slice(0,length);
}
async function vapidAuthorization(endpoint, publicKey, privateKey, subject='mailto:contato@rp-doces.pages.dev') {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida');
  const x=bytesToB64url(pub.slice(1,33)), y=bytesToB64url(pub.slice(33,65));
  const key = await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x,y,d:privateKey,ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const payload = bytesToB64url(enc.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+12*60*60,sub:subject})));
  const input = `${header}.${payload}`;
  const sig = new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(input)));
  return `vapid t=${input}.${bytesToB64url(sig)}, k=${publicKey}`;
}
async function encryptPayload(subscription, payload) {
  const uaPub=b64urlToBytes(subscription.p256dh), auth=b64urlToBytes(subscription.auth);
  const uaKey=await crypto.subtle.importKey('raw',uaPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const asPair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const asPub=new Uint8Array(await crypto.subtle.exportKey('raw',asPair.publicKey));
  const secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},asPair.privateKey,256));
  const prkKey=await hmac(auth,secret);
  const ikm=await hkdfExpand(prkKey,concat(enc.encode('WebPush: info\0'),uaPub,asPub),32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const prk=await hmac(salt,ikm);
  const cek=await hkdfExpand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdfExpand(prk,enc.encode('Content-Encoding: nonce\0'),12);
  const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const plaintext=concat(enc.encode(JSON.stringify(payload)),new Uint8Array([2]));
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,plaintext));
  const rs=new Uint8Array(4); new DataView(rs.buffer).setUint32(0,4096,false);
  return concat(salt,rs,new Uint8Array([asPub.length]),asPub,ciphertext);
}
export async function sendWebPush(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID não configurado');
  const body=await encryptPayload(subscription,payload);
  const authorization=await vapidAuthorization(subscription.endpoint,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY,env.VAPID_SUBJECT||'mailto:contato@rp-doces.pages.dev');
  return fetch(subscription.endpoint,{method:'POST',headers:{TTL:'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',Authorization:authorization},body});
}
export async function notifyPaidOrder(env, pedidoId) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return {ok:false,reason:'not_configured'};
  const subs=(await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_inscricoes').all()).results||[];
  if (!subs.length) return {ok:false,reason:'no_subscriptions'};
  const pedido=await env.DB.prepare(`SELECT id, cliente_nome, produto_nome, quantidade, valor_total_centavos, tipo_entrega, status_pagamento FROM pedidos WHERE id=? LIMIT 1`).bind(pedidoId).first();
  if (!pedido || pedido.status_pagamento!=='PAGO') return {ok:false,reason:'not_paid'};
  const claim=await env.DB.prepare('INSERT OR IGNORE INTO push_eventos (pedido_id) VALUES (?)').bind(pedidoId).run();
  if (!claim.meta?.changes) return {ok:true,reason:'already_sent'};
  const payload={title:'🍰 Novo pedido pago!',body:`Pedido #${pedido.id} • ${pedido.cliente_nome || 'Cliente'} • R$ ${(Number(pedido.valor_total_centavos||0)/100).toFixed(2).replace('.',',')}`,url:'/admin/?tab=pedidos',tag:`pedido-${pedido.id}`,pedidoId:pedido.id};
  let delivered=0;
  for (const sub of subs) {
    try {
      const r=await sendWebPush(env,sub,payload);
      if (r.ok) delivered++;
      else if (r.status===404 || r.status===410) await env.DB.prepare('DELETE FROM push_inscricoes WHERE id=?').bind(sub.id).run();
      else logEvent("warn", "push.failed", { pedido_id: pedidoId, http_status: r.status, reason: "PUSH_FAILED" });
    } catch(e){
      logEvent("warn", "push.failed", { pedido_id: pedidoId, reason: "PUSH_FAILED" });
    }
  }
  if (!delivered) await env.DB.prepare('DELETE FROM push_eventos WHERE pedido_id=?').bind(pedidoId).run();
  return {ok:delivered>0,delivered};
}

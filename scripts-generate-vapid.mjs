import { createECDH } from 'node:crypto';
const ecdh=createECDH('prime256v1'); ecdh.generateKeys();
const b64u=b=>Buffer.from(b).toString('base64url');
console.log('VAPID_PUBLIC_KEY='+b64u(ecdh.getPublicKey(null,'uncompressed')));
console.log('VAPID_PRIVATE_KEY='+b64u(ecdh.getPrivateKey()));

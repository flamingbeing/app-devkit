// Test-only RSA keys made fresh each run (nothing secret is stored): a service-account-style PEM and a JWKS signer.
import { b64url, json64 } from '../custom-token.js';

const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

export async function makeKeys(kid = 'k1') {
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  // an ID token as Google would sign it, with whatever payload a test wants
  const idToken = async (payload, head = { alg: 'RS256', kid, typ: 'JWT' }) => {
    const unsigned = `${json64(head)}.${json64(payload)}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
    return `${unsigned}.${b64url(sig)}`;
  };
  return { pem, publicKey: pair.publicKey, keys: async () => ({ [kid]: pair.publicKey }), idToken };
}

export const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));

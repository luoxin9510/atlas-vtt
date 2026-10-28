import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLAYER_ID_PATTERN } from '../../../../src/app/online/protocol/identity.ts';
import { TABLE_CODE_PATTERN } from '../../../../src/app/online/protocol/relay.ts';

/** How long a minted ticket is good for. */
export const TICKET_TTL_MS = 120_000;

function macOf(key: Buffer, code: string, player: string, hash: string, expiry: number): Buffer {
  return createHmac('sha256', key).update([code, player, hash, String(expiry)].join('\n')).digest();
}

/** The `t` value of a download URL: `code.player.expiry.mac`, the MAC being base64url HMAC-SHA-256 over code, player, hash and expiry joined by newlines. */
export function mintTicket(key: Buffer, code: string, player: string, hash: string, expiry: number): string {
  return `${code}.${player}.${expiry}.${macOf(key, code, player, hash, expiry).toString('base64url')}`;
}

/** Who a ticket is for, or null when it is malformed, expired (checked before the MAC), or its MAC does not match this key and hash. */
export function readTicket(key: Buffer, t: string, hash: string, now: number): { code: string; player: string } | null {
  const parts = t.split('.');
  if (parts.length !== 4) return null;
  const [code = '', player = '', expiryText = '', mac = ''] = parts;
  if (!TABLE_CODE_PATTERN.test(code) || !PLAYER_ID_PATTERN.test(player) || !/^[0-9]{1,15}$/.test(expiryText)) return null;
  const expiry = Number(expiryText);
  if (!Number.isSafeInteger(expiry) || expiry <= now) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(mac)) return null;
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== 32 || given.toString('base64url') !== mac) return null;
  return timingSafeEqual(given, macOf(key, code, player, hash, expiry)) ? { code, player } : null;
}

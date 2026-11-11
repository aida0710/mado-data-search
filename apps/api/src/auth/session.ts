/**
 * ログインの状態を暗号化したcookieに持つ。この製品はClickHouseのほかに自分のDBを持たず、
 * 権限はログインの可否だけなので、サーバー側のセッションの表を作らない。
 */
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

/** mado familyの決まりで、ログインは7日間有効にする。 */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_ATTEMPT_LIFETIME_SECONDS = 10 * 60;

export interface SessionUser {
  name: string;
  email: string;
}

export interface LoginAttempt {
  codeVerifier: string;
  state: string;
  nonce: string;
}

function keyFrom(secret: string): Uint8Array {
  return createHash('sha256').update(secret).digest();
}

export async function sealValue(args: { value: object; secret: string; lifetimeSeconds: number; purpose: string }): Promise<string> {
  return new EncryptJWT({ value: args.value })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setAudience(args.purpose)
    .setExpirationTime(`${args.lifetimeSeconds}s`)
    .encrypt(keyFrom(args.secret));
}

export async function openValue<T>(args: { sealed: string; secret: string; purpose: string }): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(args.sealed, keyFrom(args.secret), { audience: args.purpose });
    return payload.value as T;
  } catch {
    return null;
  }
}

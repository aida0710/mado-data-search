import { describe, expect, it } from 'vitest';
import { receivedCallbackUrl } from '../src/auth/oidc.js';

describe('receivedCallbackUrl', () => {
  it('リバースプロキシの後ろでhttpで届いても、公開URLの戻り先にクエリを載せて返す', () => {
    const received = receivedCallbackUrl(
      'https://search.example.internal',
      new URL('http://search.example.internal/api/auth/callback?code=abc&state=xyz'),
    );
    expect(received.toString()).toBe('https://search.example.internal/api/auth/callback?code=abc&state=xyz');
  });
});

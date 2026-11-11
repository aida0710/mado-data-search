/** AuthentikでのOIDCログイン。ログインの可否はグループだけで決める。 */
import * as client from 'openid-client';
import type { ApplicationConfig } from '../config.js';
import type { LoginAttempt, SessionUser } from './session.js';

export class LoginNotAllowedError extends Error {}

export function callbackUrl(publicUrl: string): string {
  return new URL('/api/auth/callback', publicUrl).toString();
}

export function createOidcClient(config: ApplicationConfig['auth'], publicUrl: string) {
  let discovered: Promise<client.Configuration> | null = null;
  const configuration = () => {
    discovered ??= client.discovery(new URL(config.issuer), config.clientId, config.clientSecret).catch((failure) => {
      // 失敗を覚え続けると、Authentikが戻っても再起動するまで入れなくなる。
      discovered = null;
      throw failure;
    });
    return discovered;
  };

  return {
    async begin(): Promise<{ redirectUrl: string; attempt: LoginAttempt }> {
      const attempt: LoginAttempt = {
        codeVerifier: client.randomPKCECodeVerifier(),
        state: client.randomState(),
        nonce: client.randomNonce(),
      };
      const url = client.buildAuthorizationUrl(await configuration(), {
        redirect_uri: callbackUrl(publicUrl),
        scope: config.scopes,
        code_challenge: await client.calculatePKCECodeChallenge(attempt.codeVerifier),
        code_challenge_method: 'S256',
        state: attempt.state,
        nonce: attempt.nonce,
      });
      return { redirectUrl: url.toString(), attempt };
    },

    async finish(currentUrl: URL, attempt: LoginAttempt): Promise<SessionUser> {
      const tokens = await client.authorizationCodeGrant(await configuration(), currentUrl, {
        pkceCodeVerifier: attempt.codeVerifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
      });
      const claims = tokens.claims();
      const groups = Array.isArray(claims?.groups) ? claims.groups.map(String) : [];
      if (!groups.includes(config.allowedGroup)) {
        throw new LoginNotAllowedError(`グループ ${config.allowedGroup} に入っていないのでログインできません`);
      }
      return {
        name: String(claims?.preferred_username ?? claims?.name ?? claims?.sub ?? ''),
        email: String(claims?.email ?? ''),
      };
    },
  };
}

export type OidcClient = ReturnType<typeof createOidcClient>;

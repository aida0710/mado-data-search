import type { SessionResponse } from '@mds/contracts';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ApplicationConfig } from '../config.js';
import { LoginNotAllowedError, type OidcClient } from '../auth/oidc.js';
import {
  LOGIN_ATTEMPT_LIFETIME_SECONDS,
  openValue,
  sealValue,
  SESSION_LIFETIME_SECONDS,
  type LoginAttempt,
  type SessionUser,
} from '../auth/session.js';

export const SESSION_COOKIE = 'mds_session';
const LOGIN_ATTEMPT_COOKIE = 'mds_login_attempt';
const SESSION_PURPOSE = 'mds-session';
const LOGIN_ATTEMPT_PURPOSE = 'mds-login-attempt';

/** 認証を切った開発環境で画面に出す名前。 */
const DEVELOPMENT_USER: SessionUser = { name: 'development', email: '' };

export function createSessionReader(config: ApplicationConfig['auth']) {
  return async (cookieValue: string | undefined): Promise<SessionUser | null> => {
    if (config.mode === 'disabled') return DEVELOPMENT_USER;
    if (!cookieValue) return null;
    return openValue<SessionUser>({ sealed: cookieValue, secret: config.sessionSecret, purpose: SESSION_PURPOSE });
  };
}

export function createAuthRoutes(config: ApplicationConfig['auth'], oidc: OidcClient | null) {
  const readSession = createSessionReader(config);
  const cookieOptions = { httpOnly: true, secure: config.cookieSecure, sameSite: 'Lax', path: '/' } as const;
  const routes = new Hono();

  routes.get('/session', async (context) => {
    const user = await readSession(getCookie(context, SESSION_COOKIE));
    return context.json<SessionResponse>({ authMode: config.mode, user });
  });

  routes.get('/login', async (context) => {
    if (!oidc) return context.redirect('/');
    const { redirectUrl, attempt } = await oidc.begin();
    setCookie(context, LOGIN_ATTEMPT_COOKIE, await sealValue({
      value: attempt,
      secret: config.sessionSecret,
      lifetimeSeconds: LOGIN_ATTEMPT_LIFETIME_SECONDS,
      purpose: LOGIN_ATTEMPT_PURPOSE,
    }), { ...cookieOptions, maxAge: LOGIN_ATTEMPT_LIFETIME_SECONDS });
    return context.redirect(redirectUrl);
  });

  routes.get('/callback', async (context) => {
    if (!oidc) return context.redirect('/');
    const sealed = getCookie(context, LOGIN_ATTEMPT_COOKIE);
    const attempt = sealed
      ? await openValue<LoginAttempt>({ sealed, secret: config.sessionSecret, purpose: LOGIN_ATTEMPT_PURPOSE })
      : null;
    deleteCookie(context, LOGIN_ATTEMPT_COOKIE, cookieOptions);
    if (!attempt) return context.redirect('/?loginError=expired');
    try {
      const user = await oidc.finish(new URL(context.req.url), attempt);
      setCookie(context, SESSION_COOKIE, await sealValue({
        value: user,
        secret: config.sessionSecret,
        lifetimeSeconds: SESSION_LIFETIME_SECONDS,
        purpose: SESSION_PURPOSE,
      }), { ...cookieOptions, maxAge: SESSION_LIFETIME_SECONDS });
      return context.redirect('/');
    } catch (failure) {
      const reason = failure instanceof LoginNotAllowedError ? 'group' : 'failed';
      console.error('oidc login failed', failure);
      return context.redirect(`/?loginError=${reason}`);
    }
  });

  routes.post('/logout', (context) => {
    deleteCookie(context, SESSION_COOKIE, cookieOptions);
    return context.json({ ok: true });
  });

  return routes;
}

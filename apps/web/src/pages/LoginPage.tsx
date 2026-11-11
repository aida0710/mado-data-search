import { ErrorNotice, LanguagePicker, LoginHeader } from '@mado/design-system/react';
import { ProductLogo } from '../components/ProductLogo';
import { text } from '../i18n/catalog';
import { localeStore } from '../i18n/locale';
import { useLocale } from '../i18n/useLocale';

function loginErrorMessage(reason: string | null): string | null {
  if (!reason) return null;
  return reason === 'group' ? text.loginNotAllowed : text.loginFailed;
}

export function LoginPage() {
  useLocale();
  const reason = new URLSearchParams(window.location.search).get('loginError');
  return (
    <div className="login-page">
      <div className="login-card">
        <LoginHeader
          logo={<ProductLogo />}
          languagePicker={<LanguagePicker store={localeStore} label={text.language} />}
        />
        <p className="muted">{text.appDescription}</p>
        <ErrorNotice message={loginErrorMessage(reason)} />
        <a className="button primary" href="/api/auth/login">
          {text.login}
        </a>
      </div>
    </div>
  );
}

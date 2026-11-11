import { narrowerThan } from '@mado/design-system/layout';
import {
  LanguagePicker,
  NavigationDrawer,
  UserMenu,
  useMediaQuery,
  useTheme,
  type NavigationLayout,
} from '@mado/design-system/react';
import type { SessionResponse } from '@mds/contracts';
import { Moon, Sun } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ProductLogo } from '../components/ProductLogo';
import { text } from '../i18n/catalog';
import { localeStore } from '../i18n/locale';
import { useLocale } from '../i18n/useLocale';
import { NavigationLinks } from './NavigationLinks';

export const THEME_STORAGE_KEY = 'mds.theme';

export function TopBar({ layout, session }: { layout: NavigationLayout; session: SessionResponse }) {
  useLocale();
  const theme = useTheme({ storageKey: THEME_STORAGE_KEY });
  const isAppNameVisuallyHidden = useMediaQuery(narrowerThan('sm'));
  const logout = async () => {
    await api.logout();
    window.location.reload();
  };
  return (
    <>
      <a className="skip-link" href="#content">
        {text.skipContent}
      </a>
      <header className="topbar">
        {layout.mode === 'drawer' && (
          <NavigationDrawer
            labels={{ open: text.openNavigation, close: text.closeNavigation, navigation: text.navigation }}
            header={<ProductLogo />}
          >
            <NavigationLinks />
          </NavigationDrawer>
        )}
        <Link to="/" className="brand">
          <ProductLogo compact={isAppNameVisuallyHidden} />
        </Link>
        <div className="topbar-actions">
          <LanguagePicker store={localeStore} label={text.language} />
          <button
            className="icon-button"
            onClick={theme.toggle}
            aria-label={theme.theme === 'light' ? text.darkTheme : text.lightTheme}
          >
            {theme.theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          {session.user && (
            <UserMenu
              displayName={session.user.name}
              email={session.user.email}
              label={text.userMenu}
              items={session.authMode === 'oidc' ? [{ label: text.logout, onSelect: () => void logout() }] : []}
            />
          )}
        </div>
      </header>
    </>
  );
}

import { NavigationSidebar, useNavigationLayout } from '@mado/design-system/react';
import type { SessionResponse } from '@mds/contracts';
import type { CSSProperties } from 'react';
import { Outlet } from 'react-router-dom';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { NavigationLinks } from './NavigationLinks';
import { TopBar } from './TopBar';

export function AppShell({ session }: { session: SessionResponse }) {
  useLocale();
  const layout = useNavigationLayout({ storageKeyPrefix: 'mds.navigation' });
  return (
    <div
      className="app-shell"
      data-navigation={layout.mode}
      style={{ '--navigation-width': `${layout.width}px` } as CSSProperties}
    >
      <TopBar layout={layout} session={session} />
      <div className="app-body">
        {layout.mode !== 'drawer' && (
          <NavigationSidebar
            layout={layout}
            labels={{
              sidebar: text.navigationSidebar,
              expand: text.expandNavigation,
              collapse: text.collapseNavigation,
              width: text.resizeNavigation,
            }}
            renderLinks={({ showsTitles }) => <NavigationLinks showsTitles={showsTitles} />}
          />
        )}
        <div className="app-content">
          <main id="content" className="workspace">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

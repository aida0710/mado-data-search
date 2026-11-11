import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initialTheme } from '@mado/design-system/theme';
import '@fontsource/noto-sans-jp/japanese-400.css';
import '@fontsource/noto-sans-jp/japanese-500.css';
import '@fontsource/noto-sans-jp/japanese-700.css';
import '@mado/design-system/fonts.css';
import '@mado/design-system/tokens.css';
import '@mado/design-system/base.css';
import '@mado/design-system/components.css';
import '@mado/design-system/shell.css';
import './styles/app.css';
import { App } from './App';
import { localeStore } from './i18n/locale';
import { THEME_STORAGE_KEY } from './layout/TopBar';

localeStore.applyToDocument();
document.documentElement.dataset.theme = initialTheme(THEME_STORAGE_KEY);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

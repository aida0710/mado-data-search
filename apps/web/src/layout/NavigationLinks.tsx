import { DatabaseZap, Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';

export function NavigationLinks({ showsTitles = false }: { showsTitles?: boolean }) {
  useLocale();
  const links = [
    { to: '/', label: text.search, Icon: Search, end: true },
    { to: '/ingest', label: text.ingest, Icon: DatabaseZap, end: false },
  ];
  return (
    <nav aria-label={text.navigation}>
      <div className="navigation-group">
        {links.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="navigation-link" title={showsTitles ? label : undefined}>
            <Icon aria-hidden="true" />
            <span className="navigation-label">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

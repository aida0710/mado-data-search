import type { OverviewResponse } from '@mds/contracts';
import { localeStore } from '../i18n/locale';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { formatCount } from '../lib/format';

/** 検索の前に出す、検索できるものの一覧。 */
export function ServiceOverview({ overview, onSelect }: { overview: OverviewResponse; onSelect: (service: string) => void }) {
  useLocale();
  const intlLocale = localeStore.getIntlLocale();
  return (
    <section>
      <div className="section-heading">
        <h2>{text.overviewHeading}</h2>
      </div>
      <p className="muted">{text.overviewNote}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{text.service}</th>
              <th className="numeric">{text.entries}</th>
            </tr>
          </thead>
          <tbody>
            {overview.services.map((service) => (
              <tr key={service.value}>
                <td>
                  <button type="button" className="link-button" onClick={() => onSelect(service.value)}>
                    {service.value}
                  </button>
                </td>
                <td className="mono numeric">{formatCount(service.count, intlLocale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

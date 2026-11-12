import {
  ATTRIBUTE_OPERATORS_BY_TYPE,
  parseCondition,
  type AttributeDefinition,
  type AttributeOperator,
} from '@mds/contracts';
import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { localeStore } from '../i18n/locale';
import { text } from '../i18n/catalog';
import { useLocale } from '../i18n/useLocale';
import { attributesForServices } from '../lib/attributeFilters';
import {
  conditionOfDraft,
  draftOfCondition,
  EMPTY_DRAFT,
  type Combinator,
  type ConditionDraft,
  type DraftGroup,
  type DraftRow,
} from '../lib/conditionDraft';
import { withParameter } from '../lib/searchUrl';

export const CONDITION_PARAMETER = 'condition';

const OPERATOR_LABEL: Record<AttributeOperator, () => string> = {
  equals: () => text.operatorEquals,
  notEquals: () => text.operatorNotEquals,
  contains: () => text.operatorContains,
  atLeast: () => text.operatorAtLeast,
  atMost: () => text.operatorAtMost,
};

function CombinatorSelect({ value, label, onChange }: { value: Combinator; label: string; onChange: (next: Combinator) => void }) {
  return (
    <select className="condition-combinator" aria-label={label} value={value} onChange={(event) => onChange(event.target.value as Combinator)}>
      <option value="all">{text.combinatorAll}</option>
      <option value="any">{text.combinatorAny}</option>
    </select>
  );
}

function ValueInput({ field, row, onChange }: { field: AttributeDefinition; row: DraftRow; onChange: (value: string) => void }) {
  const locale = localeStore.getLocale();
  if (field.values.length > 0 || field.type === 'boolean') {
    const choices = field.type === 'boolean' ? ['true', 'false'].map((value) => ({ value, label: { ja: value, en: value } })) : field.values;
    return (
      <select aria-label={text.conditionValue} value={row.value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{text.chooseValue}</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label[locale]}
          </option>
        ))}
      </select>
    );
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'datetime' ? 'date' : 'text';
  return (
    <input
      type={inputType}
      className="condition-value"
      aria-label={text.conditionValue}
      value={row.value}
      maxLength={200}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ConditionRow({
  row,
  fields,
  onChange,
  onRemove,
}: {
  row: DraftRow;
  fields: AttributeDefinition[];
  onChange: (next: DraftRow) => void;
  onRemove: () => void;
}) {
  const locale = localeStore.getLocale();
  const field = fields.find((item) => item.name === row.name);
  const selectField = (name: string) => {
    const next = fields.find((item) => item.name === name);
    // 項目を変えたら、その型で使える比べ方に直し、値は入れ直してもらう。
    onChange({ name, operator: next ? (ATTRIBUTE_OPERATORS_BY_TYPE[next.type][0] ?? 'equals') : 'equals', value: '' });
  };
  return (
    <div className="condition-row">
      <select aria-label={text.conditionField} value={row.name} onChange={(event) => selectField(event.target.value)}>
        <option value="">{text.chooseField}</option>
        {fields.map((item) => (
          <option key={item.name} value={item.name}>
            {item.label[locale]}
          </option>
        ))}
      </select>
      {field && (
        <>
          <select
            aria-label={text.conditionOperator}
            value={row.operator}
            onChange={(event) => onChange({ ...row, operator: event.target.value as AttributeOperator })}
          >
            {ATTRIBUTE_OPERATORS_BY_TYPE[field.type].map((operator) => (
              <option key={operator} value={operator}>
                {OPERATOR_LABEL[operator]()}
              </option>
            ))}
          </select>
          <ValueInput field={field} row={row} onChange={(value) => onChange({ ...row, value })} />
        </>
      )}
      <button type="button" className="icon-button" aria-label={text.removeCondition} title={text.removeCondition} onClick={onRemove}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

const NEW_ROW: DraftRow = { name: '', operator: 'equals', value: '' };

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

/**
 * ANDとORで条件を組む欄。行を並べたまとまりを作り、まとまりどうしもANDかORでつなぐ。
 * 選べる項目は設定の定義から来るので、画面は項目の名前を知らない。
 */
export function ConditionBuilder({
  fields,
  parameters,
  onChange,
}: {
  fields: AttributeDefinition[];
  parameters: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}) {
  useLocale();
  const urlText = parameters.get(CONDITION_PARAMETER) ?? '';
  const [lastUrlText, setLastUrlText] = useState(urlText);
  const [draft, setDraft] = useState<ConditionDraft | null>(() => draftOfCondition(urlText ? parseCondition(urlText) : null));
  // 戻る・進むや共有されたURLで条件が変わったら、下書きを合わせる。
  if (urlText !== lastUrlText) {
    setLastUrlText(urlText);
    setDraft(draftOfCondition(urlText ? parseCondition(urlText) : null));
  }
  const selectableFields = attributesForServices(fields, parameters.getAll('service')).concat(
    fields.filter((field) => field.services.length === 0),
  );
  const uniqueFields = [...new Map(selectableFields.map((field) => [field.name, field])).values()].sort(
    (left, right) => fields.indexOf(left) - fields.indexOf(right),
  );

  if (draft === null) {
    return (
      <p className="muted condition-note">
        {text.conditionTooDeep}{' '}
        <button type="button" className="link-button" onClick={() => onChange(withParameter(parameters, CONDITION_PARAMETER, ''))}>
          {text.clearCondition}
        </button>
      </p>
    );
  }

  const apply = (next: ConditionDraft) => {
    const condition = conditionOfDraft(next);
    onChange(withParameter(parameters, CONDITION_PARAMETER, condition ? JSON.stringify(condition) : ''));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply(draft);
  };
  const setGroup = (index: number, group: DraftGroup) => setDraft({ ...draft, groups: replaceAt(draft.groups, index, group) });
  const addGroup = () => setDraft({ ...draft, groups: [...draft.groups, { combinator: 'all', rows: [NEW_ROW] }] });
  const clear = () => {
    setDraft(EMPTY_DRAFT);
    apply(EMPTY_DRAFT);
  };

  return (
    <form className="condition-builder" onSubmit={submit} aria-label={text.conditionBuilder}>
      <div className="condition-header">
        <span className="filter-label">{text.conditionBuilder}</span>
        {draft.groups.length > 1 && (
          <CombinatorSelect value={draft.combinator} label={text.combinatorOfGroups} onChange={(combinator) => setDraft({ ...draft, combinator })} />
        )}
        <button type="button" className="link-button" onClick={addGroup}>
          <Plus size={14} aria-hidden="true" /> {draft.groups.length === 0 ? text.addCondition : text.addConditionGroup}
        </button>
      </div>
      {draft.groups.map((group, groupIndex) => (
        <div key={groupIndex} className="condition-group" role="group" aria-label={`${text.conditionGroup} ${groupIndex + 1}`}>
          {group.rows.length > 1 && (
            <CombinatorSelect value={group.combinator} label={text.combinatorOfRows} onChange={(combinator) => setGroup(groupIndex, { ...group, combinator })} />
          )}
          {group.rows.map((row, rowIndex) => (
            <ConditionRow
              key={rowIndex}
              row={row}
              fields={uniqueFields}
              onChange={(next) => setGroup(groupIndex, { ...group, rows: replaceAt(group.rows, rowIndex, next) })}
              onRemove={() => {
                const rows = removeAt(group.rows, rowIndex);
                setDraft({ ...draft, groups: rows.length > 0 ? replaceAt(draft.groups, groupIndex, { ...group, rows }) : removeAt(draft.groups, groupIndex) });
              }}
            />
          ))}
          <button type="button" className="link-button" onClick={() => setGroup(groupIndex, { ...group, rows: [...group.rows, NEW_ROW] })}>
            <Plus size={14} aria-hidden="true" /> {text.addConditionRow}
          </button>
        </div>
      ))}
      {(draft.groups.length > 0 || urlText) && (
        <div className="condition-actions">
          <button className="button primary">{text.applyCondition}</button>
          <button type="button" className="link-button" onClick={clear}>
            {text.clearCondition}
          </button>
        </div>
      )}
    </form>
  );
}

/** 取り込む内容を決める設定の指紋。変わったら、そのsourceを全件読み直す。 */
import { createHash } from 'node:crypto';
import type { AttributeDefinition, SourceConfig } from './sourceConfig.js';

/** 読む行と列の中身を変える設定だけを入れる。読み直す間隔や詳細の画面の設定は入れない。 */
export function sourceDefinitionHash(source: SourceConfig, attributes: AttributeDefinition[]): string {
  const typeByName = new Map(attributes.map((attribute) => [attribute.name, attribute.type]));
  const definition = {
    service: source.service,
    kind: source.kind,
    database: source.database,
    table: source.table,
    key: source.key,
    join: source.join,
    identity: source.identity,
    fields: Object.entries(source.fields).sort(),
    attributes: Object.entries(source.attributes)
      .sort()
      .map(([name, expression]) => [name, typeByName.get(name), expression]),
  };
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex').slice(0, 16);
}

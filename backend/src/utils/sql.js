/**
 * Güvenli dinamik WHERE oluşturucu. Koşullardaki "?" yer tutucuları sırayla $1, $2...
 * parametrelerine çevrilir; kullanıcı girdisi asla SQL metnine eklenmez.
 *
 *   const w = new Where();
 *   w.add('a.status = ?', 'ACTIVE');
 *   w.add('(a.brand ILIKE ? OR a.model ILIKE ?)', like, like);
 *   pool.query(`SELECT ... ${w.sql()} LIMIT ${w.param(limit)}`, w.params)
 */
export class Where {
  constructor() {
    this.conditions = [];
    this.params = [];
  }

  add(condition, ...values) {
    let i = 0;
    const text = condition.replace(/\?/g, () => this.param(values[i++]));
    this.conditions.push(text);
    return this;
  }

  /** Değeri parametre listesine ekler ve "$n" döner. */
  param(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  sql() {
    return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : '';
  }
}

/** ILIKE aramalarında % ve _ karakterlerini kaçırır, kullanıcının yazdığı metin aynen aranır. */
export function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Sayfalı liste yanıtı (docs/API.md §0). */
export function paginated(rows, total, page, limit) {
  return {
    data: rows,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

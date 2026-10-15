import { query as poolQuery } from '../db.js';

const SECRET_KEYS = /pass|hash|token|secret/i;

/** details içinden gizli olabilecek alanları (parola, hash, token) özyinelemeli olarak atar. */
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEYS.test(key))
        .map(([key, v]) => [key, sanitize(v)]),
    );
  }
  return value;
}

/**
 * İşlem geçmişine kayıt ekler. Transaction içinde çağrılırsa client verilmelidir;
 * böylece asıl işlem geri alınırsa log da geri alınır.
 */
export async function writeAudit(
  { userId = null, action, entityType, entityId = null, details = {} },
  client = null,
) {
  const run = client ? client.query.bind(client) : poolQuery;
  await run(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entityType, entityId, sanitize(details)],
  );
}

/** İki nesne arasındaki değişen alanları { alan: { from, to } } olarak döner. */
export function diff(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (String(from) !== String(to)) changes[field] = { from, to };
  }
  return changes;
}

import { z } from 'zod';
import { badRequest } from '../utils/errors.js';
import { isKnownWeakPassword, PASSWORD_MIN_LENGTH } from '../utils/passwords.js';

/**
 * İstek doğrulama. Doğrulanmış ve dönüştürülmüş değerler req.valid.{body,query,params}
 * altına yazılır (Express 5'te req.query salt-okunurdur).
 * Şemada olmayan alanlar atılır → mass-assignment koruması.
 */
export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    const parts = [
      ['params', params, req.params],
      ['query', query, req.query],
      ['body', body, req.body ?? {}],
    ];
    for (const [key, schema, value] of parts) {
      if (!schema) continue;
      const result = schema.safeParse(value ?? {});
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || key,
          message: issue.message,
        }));
        return next(badRequest(details[0]?.message || 'Geçersiz istek', details));
      }
      req.valid[key] = result.data;
    }
    next();
  };
}

// ---------- Ortak şema parçaları ----------

const msg = (m) => ({ message: m });

export const idParam = z.object({
  id: z.coerce.number({ invalid_type_error: 'Geçersiz kimlik' }).int().positive('Geçersiz kimlik'),
});

export const optionalId = z
  .union([z.coerce.number().int().positive(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : v));

export const trimmed = (label, min, max) =>
  z
    .string({ required_error: `${label} zorunludur`, invalid_type_error: `${label} metin olmalıdır` })
    .trim()
    .min(min, min <= 1 ? `${label} zorunludur` : `${label} en az ${min} karakter olmalıdır`)
    .max(max, `${label} en fazla ${max} karakter olabilir`);

export const optionalText = (label, max) =>
  z
    .union([z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir`), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

export const email = z
  .string({ required_error: 'E-posta zorunludur' })
  .trim()
  .toLowerCase()
  .max(255, 'E-posta çok uzun')
  .email('Geçerli bir e-posta adresi girin');

export const password = z
  .string({ required_error: 'Parola zorunludur', invalid_type_error: 'Parola metin olmalıdır' })
  .min(PASSWORD_MIN_LENGTH, `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır`)
  .max(72, 'Parola en fazla 72 karakter olabilir')
  .regex(/[A-Za-zÇĞİÖŞÜçğıöşü]/, 'Parola en az bir harf içermelidir')
  .regex(/\d/, 'Parola en az bir rakam içermelidir')
  .refine((v) => !isKnownWeakPassword(v), { message: 'Bu parola çok yaygın veya örnek belgelerde geçiyor; başka bir parola seçin' });

/** YYYY-MM-DD biçimli, gerçekten var olan tarih (boş → null). */
export const isoDate = (label) =>
  z
    .union([z.string().trim(), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v))
    .refine(
      (v) => v == null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v)),
      msg(`${label} geçerli bir tarih olmalıdır (YYYY-AA-GG)`),
    );

export const boolFilter = z.enum(['true', 'false', 'all']).optional();

/** Sayfalama + arama + beyaz listeli sıralama. */
export function listQuery(sortFields, defaultSort, extra = {}) {
  return z.object({
    page: z.coerce.number().int().min(1, 'Sayfa 1 veya daha büyük olmalıdır').default(1),
    limit: z.coerce.number().int().min(1).max(100, 'Sayfa boyutu en fazla 100 olabilir').default(20),
    search: z.string().trim().max(100, 'Arama metni çok uzun').optional(),
    sort: z.enum(sortFields, { errorMap: () => msg(`Sıralama alanı şunlardan biri olmalıdır: ${sortFields.join(', ')}`) }).default(defaultSort),
    order: z.enum(['asc', 'desc']).default('desc'),
    ...extra,
  });
}

/** from/to tarih aralığı verilmişse başlangıç bitişten sonra olamaz. */
export const dateRangeRule = [
  (v) => !v.from || !v.to || v.from <= v.to,
  { message: 'Başlangıç tarihi bitiş tarihinden sonra olamaz', path: ['from'] },
];

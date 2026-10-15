import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ALERT_TYPES, listAlerts, thresholds } from '../services/alerts.js';

const router = Router();
router.use(authenticate, requireAdmin);

const schema = z.object({
  type: z.enum(Object.keys(ALERT_TYPES)).optional(),
  severity: z.enum(['critical', 'warning', 'info']).optional(),
});

// GET /api/alerts — veritabanından anlık üretilen uyarılar (garanti, uzun süre depoda/arızalı, çelişkili/eksik kayıt)
router.get('/', validate({ query: schema }), async (req, res) => {
  const { type, severity } = req.valid.query;
  const all = await listAlerts();
  const summary = Object.fromEntries(Object.keys(ALERT_TYPES).map((k) => [k, { ...ALERT_TYPES[k], count: 0 }]));
  for (const a of all) summary[a.type].count += 1;
  const data = all.filter((a) => (!type || a.type === type) && (!severity || a.severity === severity));
  res.set('Cache-Control', 'no-store');
  res.json({ data, summary, total: all.length, thresholds });
});

export default router;

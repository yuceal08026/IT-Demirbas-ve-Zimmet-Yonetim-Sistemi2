import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { assignmentListSchema, listAssignments } from './assignments.js';

const router = Router();
router.use(authenticate);

// GET /api/me/assignments — giriş yapan kullanıcının kendi zimmetleri.
// user_id parametresi gönderilse bile yok sayılır; sorgu her zaman req.user.id'ye sabitlenir.
router.get('/assignments', validate({ query: assignmentListSchema }), async (req, res) => {
  res.json(await listAssignments(req.valid.query, { forceUserId: req.user.id, defaultActive: 'true' }));
});

export default router;

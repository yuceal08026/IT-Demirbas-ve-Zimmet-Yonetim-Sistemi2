import { Router } from 'express';
import { pingDatabase } from '../db.js';

const router = Router();

// GET /health — yük dengeleyici / Docker healthcheck için. Kimlik gerektirmez.
router.get('/', async (req, res) => {
  try {
    await pingDatabase();
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

export default router;

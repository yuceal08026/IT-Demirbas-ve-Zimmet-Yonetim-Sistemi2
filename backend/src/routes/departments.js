import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate, idParam, trimmed } from '../middleware/validate.js';
import { conflict, notFound } from '../utils/errors.js';
import { writeAudit } from '../utils/audit.js';

const router = Router();
router.use(authenticate, requireAdmin);

const bodySchema = z.object({ name: trimmed('Departman adı', 2, 100) });

const SELECT = `
  SELECT d.id, d.name, d.created_at,
         (SELECT count(*) FROM users u WHERE u.department_id = d.id) AS user_count
    FROM departments d`;

// GET /api/departments — küçük liste, sayfasız
router.get('/', async (req, res) => {
  const { rows } = await query(`${SELECT} ORDER BY d.name`);
  res.json({ data: rows });
});

// POST /api/departments
router.post('/', validate({ body: bodySchema }), async (req, res) => {
  const { name } = req.valid.body;
  const dept = await withTransaction(async (client) => {
    const { rows } = await client.query('INSERT INTO departments (name) VALUES ($1) RETURNING id', [name]);
    await writeAudit(
      { userId: req.user.id, action: 'DEPARTMENT_CREATE', entityType: 'DEPARTMENT', entityId: rows[0].id, details: { name } },
      client,
    );
    return (await client.query(`${SELECT} WHERE d.id = $1`, [rows[0].id])).rows[0];
  });
  res.status(201).json(dept);
});

// PATCH /api/departments/:id
router.patch('/:id', validate({ params: idParam, body: bodySchema }), async (req, res) => {
  const { id } = req.valid.params;
  const { name } = req.valid.body;
  const dept = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT name FROM departments WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Departman bulunamadı');
    await client.query('UPDATE departments SET name = $1 WHERE id = $2', [name, id]);
    await writeAudit(
      { userId: req.user.id, action: 'DEPARTMENT_UPDATE', entityType: 'DEPARTMENT', entityId: id, details: { changes: { name: { from: rows[0].name, to: name } } } },
      client,
    );
    return (await client.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
  });
  res.json(dept);
});

// DELETE /api/departments/:id — personeli olan departman silinemez
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const { id } = req.valid.params;
  await withTransaction(async (client) => {
    const { rows } = await client.query(`${SELECT} WHERE d.id = $1 FOR UPDATE OF d`, [id]);
    const dept = rows[0];
    if (!dept) throw notFound('Departman bulunamadı');
    if (dept.user_count > 0) {
      throw conflict('HAS_USERS', `Bu departmanda ${dept.user_count} kullanıcı var; önce kullanıcıları başka departmana taşıyın`);
    }
    await client.query('DELETE FROM departments WHERE id = $1', [id]);
    await writeAudit(
      { userId: req.user.id, action: 'DEPARTMENT_DELETE', entityType: 'DEPARTMENT', entityId: id, details: { name: dept.name } },
      client,
    );
  });
  res.status(204).end();
});

export default router;

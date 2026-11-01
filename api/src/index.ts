import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Create a home
app.post('/api/homes', async (c) => {
  let body: { name?: unknown }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// Add a member
app.post('/api/homes/:homeId/members', async (c) => {
  let body: { name?: unknown }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Create a bill and split it equally
app.post('/api/homes/:homeId/bills', async (c) => {
  let body: { title?: unknown; totalCents?: unknown }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { title, totalCents } = body
  const homeId = c.req.param('homeId')

  if (typeof title !== 'string' || !title.trim()) {
    return c.json({ error: 'Bill title is required' }, 400)
  }

  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'Total must be a positive integer' }, 422)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY created_at, rowid',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const billId = crypto.randomUUID()
  const count = members.results.length
  const baseAmount = Math.floor(totalCents / count)
  const remainder = totalCents % count

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents),
    ...members.results.map((member, index) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), billId, member.id, baseAmount + (index < remainder ? 1 : 0)),
    ),
  ]

  await c.env.DB.batch(statements)

  const shares = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at FROM shares WHERE bill_id = ? ORDER BY rowid',
  )
    .bind(billId)
    .all<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
    }>()

  return c.json(
    {
      id: billId,
      homeId,
      title: title.trim(),
      totalCents,
      shares: shares.results.map((share) => ({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })),
    },
    201,
  )
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')

  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paid_at) {
    if (share.idempotency_key === key) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }

    return c.json({ error: 'Share has already been paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  const result = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  if (result.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      'SELECT paid_at, idempotency_key FROM shares WHERE id = ?',
    )
      .bind(shareId)
      .first<{
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (current?.paid_at && current.idempotency_key === key) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: current.paid_at,
      })
    }

    return c.json({ error: 'Share has already been paid' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt,
  })
})

// Undo a payment
app.post('/api/bills/:billId/shares/:shareId/unpay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    `SELECT id, member_id, amount_cents, paid_at
     FROM shares
     WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (!share.paid_at) {
    return c.json({ error: 'Share is not paid yet' }, 409)
  }

  await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = NULL, idempotency_key = NULL
     WHERE id = ? AND bill_id = ? AND paid_at IS NOT NULL`,
  )
    .bind(shareId, billId)
    .run()

  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt: null,
  })
})

// Get outstanding balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(
         CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END
       ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s
       ON s.member_id = m.id
     LEFT JOIN bills b
       ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.created_at
     ORDER BY m.created_at, m.rowid`,
  )
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()

  return c.json({ balances: result.results })
})

export default app

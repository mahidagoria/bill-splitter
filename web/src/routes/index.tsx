import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: HomePage,
})

type Home = {
  id: string
  name: string
}

type Member = {
  id: string
  homeId: string
  name: string
}

type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type Theme = 'light' | 'dark'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }

  return data as T
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(cents / 100)
}

function HomePage() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('bill-splitter-theme') as Theme) || 'light'
  })

  const [home, setHome] = useState<Home | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    localStorage.setItem('bill-splitter-theme', theme)
    document.body.style.background = theme === 'dark' ? '#111827' : '#f6f7fb'
  }, [theme])

  // Refresh balances whenever the current home changes.
  useEffect(() => {
    if (!home) {
      setBalances([])
      return
    }

    api<{ balances: Balance[] }>(`/api/homes/${home.id}/balances`)
      .then((data) => setBalances(data.balances))
      .catch((err: Error) => setError(err.message))
  }, [home])

  async function refreshBalances(homeId: string) {
    const data = await api<{ balances: Balance[] }>(`/api/homes/${homeId}/balances`)
    setBalances(data.balances)
  }

  async function createHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!homeName.trim()) {
      setError('Please enter a home name.')
      return
    }

    setLoading(true)

    try {
      const newHome = await api<Home>('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName.trim() }),
      })

      setHome(newHome)
      setHomeName('')
      setMessage('Your home was created successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create home.')
    } finally {
      setLoading(false)
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!home || !memberName.trim()) {
      setError('Please enter a member name.')
      return
    }

    setError('')
    setMessage('')
    setLoading(true)

    try {
      const member = await api<Member>(`/api/homes/${home.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName.trim() }),
      })

      setMembers((previous) => [...previous, member])
      setMemberName('')
      await refreshBalances(home.id)
      setMessage('Member added successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.')
    } finally {
      setLoading(false)
    }
  }

  async function createBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!home) return

    const totalCents = Math.round(Number(billAmount) * 100)

    if (!billTitle.trim()) {
      setError('Please enter a bill title.')
      return
    }

    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      setError('Please enter a valid bill amount.')
      return
    }

    if (members.length === 0) {
      setError('Add at least one member before creating a bill.')
      return
    }

    setError('')
    setMessage('')
    setLoading(true)

    try {
      const bill = await api<Bill>(`/api/homes/${home.id}/bills`, {
        method: 'POST',
        body: JSON.stringify({
          title: billTitle.trim(),
          totalCents,
        }),
      })

      setBills((previous) => [bill, ...previous])
      setBillTitle('')
      setBillAmount('')
      await refreshBalances(home.id)
      setMessage('Bill created and split successfully!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create bill.')
    } finally {
      setLoading(false)
    }
  }

  async function payShare(bill: Bill, share: Share) {
    const confirmed = window.confirm(
      `Mark ${share.memberName}'s share of ${formatMoney(share.amountCents)} as paid?`,
    )

    if (!confirmed) return

    setError('')
    setMessage('')

    try {
      const result = await api<{ paidAt: string }>(`/api/bills/${bill.id}/shares/${share.id}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      setBills((previous) =>
        previous.map((item) =>
          item.id === bill.id
            ? {
                ...item,
                shares: item.shares.map((s) =>
                  s.id === share.id ? { ...s, paidAt: result.paidAt } : s,
                ),
              }
            : item,
        ),
      )

      if (home) await refreshBalances(home.id)
      setMessage(`${share.memberName}'s payment was recorded.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment could not be recorded.')
    }
  }

  async function undoPayment(bill: Bill, share: Share) {
    const confirmed = window.confirm(
      `Undo the payment for ${share.memberName}? Their share will become unpaid again.`,
    )

    if (!confirmed) return

    setError('')
    setMessage('')

    try {
      await api(`/api/bills/${bill.id}/shares/${share.id}/unpay`, {
        method: 'POST',
      })

      setBills((previous) =>
        previous.map((item) =>
          item.id === bill.id
            ? {
                ...item,
                shares: item.shares.map((s) => (s.id === share.id ? { ...s, paidAt: null } : s)),
              }
            : item,
        ),
      )

      if (home) await refreshBalances(home.id)
      setMessage(`Payment for ${share.memberName} was undone.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo payment.')
    }
  }

  const totalSpent = bills.reduce((sum, bill) => sum + bill.totalCents, 0)

  const totalUnpaid = balances.reduce((sum, balance) => sum + balance.outstandingCents, 0)

  const paidShares = bills.reduce(
    (sum, bill) => sum + bill.shares.filter((share) => share.paidAt).length,
    0,
  )

  const totalShares = bills.reduce((sum, bill) => sum + bill.shares.length, 0)

  const dark = theme === 'dark'

  const colors = {
    background: dark ? '#111827' : '#f6f7fb',
    panel: dark ? '#1f2937' : '#ffffff',
    text: dark ? '#f9fafb' : '#172033',
    muted: dark ? '#9ca3af' : '#687386',
    border: dark ? '#374151' : '#e5e7eb',
    input: dark ? '#111827' : '#ffffff',
    primary: '#7257e8',
    success: dark ? '#86efac' : '#15803d',
    danger: dark ? '#fca5a5' : '#dc2626',
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: colors.background,
        color: colors.text,
        padding: '32px 18px',
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        button, input { font: inherit; }
        button { cursor: pointer; }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        input:focus { outline: 2px solid #7257e8; outline-offset: 1px; }
        .primary-button { background: #7257e8; color: white; border: 0; border-radius: 9px; padding: 11px 16px; font-weight: 600; }
        .secondary-button { background: transparent; border: 1px solid ${colors.border}; color: ${colors.text}; border-radius: 9px; padding: 9px 13px; font-weight: 600; }
        .form-input { width: 100%; padding: 11px 12px; border: 1px solid ${colors.border}; border-radius: 9px; background: ${colors.input}; color: ${colors.text}; }
        .panel { background: ${colors.panel}; border: 1px solid ${colors.border}; border-radius: 16px; padding: 22px; }
        .muted { color: ${colors.muted}; }
        .form { display: flex; flex-direction: column; gap: 12px; }
        .stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .dashboard-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
        .share-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 0; border-bottom: 1px solid ${colors.border}; }
        .share-row:last-child { border-bottom: 0; }
        @media (max-width: 650px) {
          .dashboard-grid { grid-template-columns: 1fr; }
          .stat-grid { grid-template-columns: 1fr; }
          .share-row { align-items: flex-start; flex-direction: column; }
        }
      `}</style>

      <div style={{ maxWidth: 1050, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            marginBottom: 30,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '-1px' }}>
              Split<span style={{ color: colors.primary }}>Mate</span>
            </h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Shared expenses, made simple.
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setTheme((previous) => (previous === 'light' ? 'dark' : 'light'))}
          >
            {dark ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        </header>

        {error && (
          <div
            role="alert"
            style={{
              background: dark ? '#451a1a' : '#fef2f2',
              color: colors.danger,
              padding: 14,
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            {error}
            <button
              type="button"
              onClick={() => setError('')}
              style={{
                float: 'right',
                border: 0,
                background: 'transparent',
                color: 'inherit',
              }}
            >
              ✕
            </button>
          </div>
        )}

        {message && (
          <div
            role="status"
            style={{
              background: dark ? '#123524' : '#f0fdf4',
              color: colors.success,
              padding: 14,
              borderRadius: 10,
              marginBottom: 16,
            }}
          >
            {message}
            <button
              type="button"
              onClick={() => setMessage('')}
              style={{
                float: 'right',
                border: 0,
                background: 'transparent',
                color: 'inherit',
              }}
            >
              ✕
            </button>
          </div>
        )}

        {!home ? (
          <section className="panel" style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>Create your home</h2>
            <p className="muted">Give your shared space a name to get started.</p>

            <form className="form" onSubmit={createHome}>
              <input
                className="form-input"
                placeholder="Example: Flat 302"
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                required
              />

              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? 'Creating...' : 'Create home'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section style={{ marginBottom: 22 }}>
              <p className="muted" style={{ marginBottom: 5 }}>
                YOUR SHARED SPACE
              </p>
              <h2 style={{ margin: 0, fontSize: 25 }}>{home.name}</h2>
            </section>

            <section className="stat-grid" style={{ marginBottom: 22 }}>
              <div className="panel">
                <p className="muted" style={{ margin: 0 }}>
                  Total expenses
                </p>
                <h2 style={{ margin: '10px 0 0' }}>{formatMoney(totalSpent)}</h2>
              </div>

              <div className="panel">
                <p className="muted" style={{ margin: 0 }}>
                  Outstanding balance
                </p>
                <h2 style={{ margin: '10px 0 0', color: colors.danger }}>
                  {formatMoney(totalUnpaid)}
                </h2>
              </div>

              <div className="panel">
                <p className="muted" style={{ margin: 0 }}>
                  Payments completed
                </p>
                <h2 style={{ margin: '10px 0 0', color: colors.success }}>
                  {paidShares}/{totalShares}
                </h2>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="panel">
                <h2 style={{ marginTop: 0 }}>Members</h2>

                {members.length === 0 ? (
                  <p className="muted">No members added yet.</p>
                ) : (
                  members.map((member) => (
                    <div
                      key={member.id}
                      style={{
                        padding: '10px 0',
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      👤 {member.name}
                    </div>
                  ))
                )}

                <form className="form" onSubmit={addMember} style={{ marginTop: 18 }}>
                  <input
                    className="form-input"
                    placeholder="Enter member name"
                    value={memberName}
                    onChange={(event) => setMemberName(event.target.value)}
                    required
                  />

                  <button type="submit" className="primary-button" disabled={loading}>
                    {loading ? 'Adding...' : '+ Add member'}
                  </button>
                </form>
              </div>

              <div className="panel">
                <h2 style={{ marginTop: 0 }}>Create a bill</h2>
                <p className="muted">The bill will be divided equally among all members.</p>

                <form className="form" onSubmit={createBill}>
                  <input
                    className="form-input"
                    placeholder="Bill title (e.g. Electricity)"
                    value={billTitle}
                    onChange={(event) => setBillTitle(event.target.value)}
                    required
                  />

                  <input
                    className="form-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Total amount in ₹"
                    value={billAmount}
                    onChange={(event) => setBillAmount(event.target.value)}
                    required
                  />

                  <button
                    type="submit"
                    className="primary-button"
                    disabled={loading || members.length === 0}
                  >
                    {loading ? 'Creating...' : 'Split bill equally'}
                  </button>
                </form>

                {members.length === 0 && (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Add members before creating a bill.
                  </p>
                )}
              </div>
            </section>

            <section className="panel" style={{ marginTop: 20 }}>
              <h2 style={{ marginTop: 0 }}>Outstanding balances</h2>

              {balances.length === 0 ? (
                <p className="muted">Add members to see their balances.</p>
              ) : (
                balances.map((balance) => (
                  <div key={balance.memberId} className="share-row">
                    <strong>{balance.name}</strong>
                    <strong
                      style={{
                        color: balance.outstandingCents > 0 ? colors.danger : colors.success,
                      }}
                    >
                      {formatMoney(balance.outstandingCents)}
                    </strong>
                  </div>
                ))
              )}
            </section>

            <section className="panel" style={{ marginTop: 20 }}>
              <h2 style={{ marginTop: 0 }}>Recent bills</h2>

              {bills.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 25 }}>
                  <div style={{ fontSize: 35 }}>🧾</div>
                  <h3>No bills yet</h3>
                  <p className="muted">Create your first shared bill to get started.</p>
                </div>
              ) : (
                bills.map((bill) => (
                  <div
                    key={bill.id}
                    style={{
                      borderTop: `1px solid ${colors.border}`,
                      padding: '18px 0',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                      }}
                    >
                      <div>
                        <h3 style={{ margin: 0 }}>{bill.title}</h3>
                        <p className="muted" style={{ margin: '5px 0 0' }}>
                          {bill.shares.length} members
                        </p>
                      </div>

                      <strong style={{ fontSize: 19 }}>{formatMoney(bill.totalCents)}</strong>
                    </div>

                    <div style={{ marginTop: 14 }}>
                      {bill.shares.map((share) => (
                        <div key={share.id} className="share-row">
                          <div>
                            <strong>{share.memberName}</strong>
                            <div className="muted" style={{ marginTop: 5 }}>
                              {formatMoney(share.amountCents)}
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{
                                color: share.paidAt ? colors.success : colors.danger,
                                fontSize: 13,
                                fontWeight: 600,
                              }}
                            >
                              {share.paidAt ? '✓ Paid' : '● Unpaid'}
                            </span>

                            {share.paidAt ? (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => undoPayment(bill, share)}
                              >
                                Undo payment
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => payShare(bill, share)}
                              >
                                Mark paid
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        <footer
          className="muted"
          style={{
            textAlign: 'center',
            padding: '30px 0 10px',
            fontSize: 13,
          }}
        >
          SplitMate · Manage shared expenses simply
        </footer>
      </div>
    </main>
  )
}

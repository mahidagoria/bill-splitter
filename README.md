# Shared Bill Splitter

A full-stack application for managing shared household expenses. Create a home, add members, split bills equally, track outstanding balances, and record or undo payments.

## Features

- Create a home and add household members.
- Create bills and automatically split the amount between all members.
- Distribute extra cents in member creation order so every share adds up to the exact bill total.
- Track paid and unpaid shares.
- View each member's outstanding balance.
- Prevent duplicate payments using idempotency keys.
- Undo an accidental payment.
- Switch between light and dark themes.
- Handle invalid input and API errors.

## Tech Stack

**Frontend**
- React
- TypeScript
- Vite
- TanStack Router

**Backend**
- Hono
- Cloudflare Workers
- TypeScript

**Database and Testing**
- Cloudflare D1 (SQLite)
- Vitest
- Biome

## Project Structure

```text
bill-splitter/
├── api/
│   ├── migrations/
│   ├── src/
│   │   └── index.ts
│   ├── test/
│   └── wrangler.jsonc
├── web/
│   └── src/
│       └── routes/
│           └── index.tsx
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js
- pnpm

### Installation

Clone the repository:

```bash
git clone https://github.com/mahidagoria/bill-splitter.git
cd bill-splitter
```

Install dependencies:

```bash
pnpm install
```

Start the application:

```bash
pnpm dev
```

The application runs at:

- Frontend: http://localhost:5173
- API: http://localhost:8787

The local D1 database migrations are applied when the API starts.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/homes` | Create a home |
| POST | `/api/homes/:homeId/members` | Add a member |
| POST | `/api/homes/:homeId/bills` | Create and split a bill |
| POST | `/api/bills/:billId/shares/:shareId/pay` | Mark a share as paid |
| POST | `/api/bills/:billId/shares/:shareId/unpay` | Undo a payment |
| GET | `/api/homes/:homeId/balances` | Get outstanding balances |

### Payment Safety

Payment requests require an `Idempotency-Key` header. Repeating a request with the same key returns the original payment result instead of recording another payment.

A share already paid with a different key returns a conflict response.

## Bill Splitting Example

For a bill of ₹1,000 shared between three members:

| Member | Share |
|---|---:|
| Member 1 | ₹333.34 |
| Member 2 | ₹333.33 |
| Member 3 | ₹333.33 |
| **Total** | **₹1,000.00** |

All monetary values are stored and calculated as integer cents (or the smallest currency unit), avoiding floating-point money calculations.

## Quality Checks

Run these commands from the project root:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

## Decisions

1. **Integer-based money calculations:** All bill amounts are stored as integers in the smallest currency unit. This avoids floating-point precision errors and ensures shares always add up to the original bill amount.

2. **Idempotent payments:** Payment requests use an `Idempotency-Key` and conditional database updates. This helps prevent duplicate payments when requests are repeated or sent concurrently.

3. **Equal splitting with deterministic remainders:** Bills are divided equally among members. Any remaining cents are distributed in member creation order, ensuring predictable and fair results.

## AI Usage Disclosure

ChatGPT was used as an AI assistance tool during development for implementation guidance, debugging, code explanations, and documentation preparation. The implementation was tested using the project's automated test suite and quality-check commands.


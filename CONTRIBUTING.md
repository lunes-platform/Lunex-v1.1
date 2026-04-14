# Contributing to Lunex DEX

> Internal development guide. Code standards, conventions, and workflow.

---

## Development Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd Lunex && yarn install

# 2. Environment
cp spot-api/.env.example spot-api/.env
# Fill: DATABASE_URL, REDIS_URL, LUNES_WS_URL

# 3. Database
cd spot-api && npx prisma migrate dev

# 4. Start all services
cd .. && docker-compose -f docker-compose.dev.yml up -d db redis
cd spot-api && yarn dev
cd lunes-dex-main && yarn dev
```

---

## Code Standards

### TypeScript

- Strict mode enabled — no `any` except documented exceptions
- Use `unknown` in catch blocks: `catch (err: unknown)`
- Prefer `type` over `interface` for plain data shapes
- Use Prisma generated types — never cast to `any` for DB results

### Error Handling

**Backend (Express routes):**
```typescript
// ✅ Correct — delegate to centralized errorHandler
router.get('/resource', async (req, res, next) => {
  try {
    const data = await service.getData()
    res.json(data)
  } catch (err) { next(err) }
})

// ❌ Wrong — inline error responses bypass logging
router.get('/resource', async (req, res) => {
  try {
    const data = await service.getData()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' }) // don't do this
  }
})
```

**Frontend:**
```typescript
// ✅ Correct
} catch (err: unknown) {
  setError((err as Error).message || 'Operation failed')
}

// ❌ Wrong
} catch (err: any) {
  setError(err.message)
}
```

### Database Queries

```typescript
// ✅ Correct — use Prisma.ModelWhereInput types
const where: Prisma.OrderWhereInput = { makerAddress }
if (status) where.status = status as OrderStatus

// ❌ Wrong — loses type safety
const where: any = { makerAddress }

// ✅ Correct — batch queries to avoid N+1
const counts = await prisma.referral.groupBy({
  by: ['referrerAddress'],
  where: { referrerAddress: { in: addresses } },
  _count: { id: true },
})

// ❌ Wrong — N+1 loop
for (const ref of referees) {
  const count = await prisma.referral.count({ where: { referrerAddress: ref } })
}
```

### Validation

All route handlers must validate input with Zod before using it:

```typescript
const schema = z.object({
  address: z.string().min(1),
  amount: z.coerce.number().positive(),
})

router.post('/', async (req, res, next) => {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues })
  }
  // use parsed.data safely from here
})
```

### Logging

```typescript
import { log } from '../utils/logger'

// ✅ Structured logging
log.info({ orderId, pairSymbol }, '[Order] Created successfully')
log.error({ err, orderId }, '[Order] Failed to create')

// Development-only console logs
if (process.env.NODE_ENV !== 'production') {
  console.log('Debug info:', data)
}
```

### Admin Routes

Admin endpoints must always use `requireAdmin` middleware and must **not** expose the `ADMIN_SECRET` in responses:

```typescript
router.post('/admin/action', requireAdmin, async (req, res, next) => {
  // ...
})
```

---

## Authentication Conventions

| Operation | Auth required | Pattern |
|-----------|--------------|---------|
| Read public data | None | — |
| Wallet-signed mutations | sr25519 sig + nonce | `verifyWalletActionSignature()` |
| Admin operations | Bearer token | `requireAdmin` middleware |
| AI agent trades | API key | `agentAuth(['TRADE_SPOT'])` |

---

## API Design Rules

1. **Use nouns, not verbs** in routes: `/orders` not `/createOrder`
2. **Use `next(err)`** in every catch block — no inline 500 responses
3. **Always include radix** in `parseInt`: `parseInt(str, 10)`
4. **Cap pagination limits**: `Math.min(parseInt(str, 10) || 50, 200)`
5. **Return 201** for POST that creates a resource
6. **Return 204** for DELETE with no body (or 200 with the deleted object)
7. **Include `{ error, code, details? }`** in all error responses

---

## SDD Workflow

Feature work in Lunex now follows a lightweight SDD flow:

1. Create `docs/features/<feature-slug>/PRD.md`
2. Create `docs/features/<feature-slug>/SPEC.md`
3. Create `docs/features/<feature-slug>/TASKS.md`
4. Implement only after scope and technical impact are explicit
5. Update `docs/prd/PROJECT_PRD.md` or `docs/specs/PROJECT_SPEC.md` if the change affects product vision or cross-cutting architecture

Use these references:

- `docs/README.md`
- `docs/sdd/README.md`
- `docs/sdd/templates/PRD_TEMPLATE.md`
- `docs/sdd/templates/SPEC_TEMPLATE.md`
- `docs/sdd/templates/TASKS_TEMPLATE.md`

Exceptions:

- Small bugfixes can skip a full PRD, but should still have a minimal spec and test plan in the PR or feature folder
- Editorial doc updates do not require a feature folder

---

## Git Workflow

```bash
# Feature branch
git checkout -b feature/TICKET-description

# Commit convention (Conventional Commits)
git commit -m "feat(affiliate): add multi-level referral tree batching"
git commit -m "fix(orders): remove redundant findUnique after update"
git commit -m "docs(api): add affiliate commission endpoint examples"
git commit -m "refactor(listing): migrate to next(err) pattern"

# Types: feat | fix | docs | refactor | test | chore | perf | security
```

---

## Testing Requirements

- New service functions must have unit tests
- New API endpoints must have at minimum a happy-path + invalid-input test
- No `any` type in test files
- Use `beforeAll` / `afterAll` for DB cleanup (never leave test data)

```typescript
describe('My Feature', () => {
  beforeAll(async () => {
    await prisma.myModel.deleteMany({ where: { isTestData: true } })
  })

  afterAll(async () => {
    await prisma.myModel.deleteMany({ where: { isTestData: true } })
    await prisma.$disconnect()
  })

  it('should do the thing', async () => {
    // Arrange
    const input = { ... }
    // Act
    const result = await myService.doThing(input)
    // Assert
    expect(result).toHaveProperty('id')
  })
})
```

---

## Prisma Schema Changes

1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name <description>`
3. Update affected service types (don't use `prisma as any`)
4. Update affected formatters/response shapes
5. Add or update tests for affected endpoints

---

## Before Opening a PR

- [ ] `yarn typecheck` → 0 errors
- [ ] `yarn lint` → 0 warnings on changed files
- [ ] `yarn test` → all tests pass
- [ ] Admin endpoints have `requireAdmin`
- [ ] All catch blocks use `next(err)` not inline responses
- [ ] New env vars added to `.env.example`
- [ ] `docs/API.md` updated if routes changed

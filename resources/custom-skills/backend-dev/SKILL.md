---
name: backend-dev
description: 'Professional backend development skill covering API design, database operations, authentication, testing, logging, deployment, and security. Supports Node.js/Python/Go/Java with mainstream frameworks.'
metadata:
  {
    "openclaw":
      {
        "emoji": "⚙️",
        "requires": { "anyBins": ["node", "python3", "go", "java", "docker", "git"] },
        "install":
          [
            {
              "id": "nodejs",
              "kind": "node",
              "package": "typescript ts-node @types/node",
              "bins": ["tsc", "ts-node"],
              "label": "Install TypeScript toolchain",
            },
          ],
      },
  }
---

# Backend Development Skill

Professional backend development covering API design, database operations, authentication, testing, logging, deployment, and security.

## 🎯 When to Use This Skill

Use this skill when:
- Building REST/GraphQL/gRPC APIs
- Designing database schemas and queries
- Implementing authentication/authorization
- Writing unit/integration tests
- Setting up logging and monitoring
- Containerizing applications (Docker/K8s)
- Reviewing backend code for security/performance
- Debugging production issues

---

## 📚 Core Competencies

### 1. API Development

#### REST API Design

```markdown
## Resource Naming
- ✅ /users, /articles, /orders (plural nouns)
- ✅ /users/123/orders (nested resources)
- ❌ /getUsers, /createOrder (verbs in paths)

## HTTP Methods
- GET    → Retrieve resource(s)
- POST   → Create new resource
- PUT    → Replace entire resource
- PATCH  → Partial update
- DELETE → Remove resource

## Status Codes
- 200 OK - Success with response
- 201 Created - Resource created
- 204 No Content - Success, no response body
- 400 Bad Request - Invalid input
- 401 Unauthorized - Missing/invalid auth
- 403 Forbidden - Auth OK, but no permission
- 404 Not Found - Resource doesn't exist
- 409 Conflict - Resource conflict (duplicate, etc.)
- 422 Unprocessable Entity - Validation failed
- 429 Too Many Requests - Rate limited
- 500 Internal Server Error - Server bug
```

#### Response Format (Standard)

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

#### GraphQL Best Practices

```graphql
# Schema Design
type User {
  id: ID!
  email: String!
  profile: Profile
  posts(limit: Int = 10, offset: Int = 0): [Post!]!
  createdAt: DateTime!
}

type Query {
  user(id: ID!): User
  users(filter: UserFilter, pagination: PaginationInput): UserConnection!
}

type Mutation {
  createUser(input: CreateUserInput!): UserPayload!
  updateUser(id: ID!, input: UpdateUserInput!): UserPayload!
}

# Avoid
- Deep nesting (> 3 levels)
- Circular references
- Over-fetching in resolvers
```

---

### 2. Database Operations

#### SQL Schema Design

```sql
-- Core Principles
-- 1. Use appropriate data types
-- 2. Add indexes on foreign keys and frequently queried columns
-- 3. Use UUID or BIGINT for IDs (avoid auto-increment in distributed systems)
-- 4. Add created_at/updated_at timestamps
-- 5. Use soft deletes when audit trail needed

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
```

#### ORM Patterns

```typescript
// TypeORM / Prisma / Sequelize patterns

// ✅ Good: Use transactions for multi-step operations
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { email } });
  await tx.profile.create({ data: { userId: user.id, bio } });
  return user;
});

// ✅ Good: Eager loading to avoid N+1
const users = await prisma.user.findMany({
  include: { posts: true, profile: true }
});

// ❌ Bad: N+1 query problem
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { userId: user.id } });
}
```

#### Query Optimization

```sql
-- Use EXPLAIN to analyze queries
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';

-- Index usage tips
-- ✅ Indexed: WHERE, JOIN, ORDER BY, GROUP BY columns
-- ❌ Not indexed: Functions on columns, LIKE '%pattern'

-- Add composite index for multi-column queries
CREATE INDEX idx_users_status_created ON users(status, created_at DESC);
```

---

### 3. Authentication & Authorization

#### JWT Implementation

```typescript
// Token Structure
{
  "sub": "user-uuid",
  "iat": 1234567890,
  "exp": 1234571490,
  "role": "admin",
  "permissions": ["users:read", "users:write"]
}

// Best Practices
// 1. Short-lived access tokens (15-60 min)
// 2. Long-lived refresh tokens (7-30 days, stored securely)
// 3. Rotate refresh tokens on use
// 4. Include minimal claims (avoid PII in token)
// 5. Use RS256 for distributed systems, HS256 for monoliths
```

#### OAuth2 Flow

```markdown
## Authorization Code Flow (Recommended)

1. User clicks "Login with Provider"
2. Redirect to provider with client_id, redirect_uri, scope, state
3. User authorizes
4. Provider redirects back with code + state
5. Exchange code for tokens (server-to-server)
6. Store tokens securely, create session

## Security Checklist
- ✅ Validate state parameter (CSRF protection)
- ✅ Use PKCE for public clients
- ✅ Store tokens server-side (never in URL/localStorage)
- ✅ Verify redirect_uri matches registered URIs
- ✅ Handle token refresh gracefully
```

#### RBAC (Role-Based Access Control)

```typescript
// Middleware pattern
function requirePermission(resource: string, action: string) {
  return (req, res, next) => {
    const { role, permissions } = req.user;
    
    if (role === 'admin') return next();
    
    const required = `${resource}:${action}`;
    if (permissions.includes(required)) return next();
    
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

// Usage
router.delete('/users/:id', 
  authenticate, 
  requirePermission('users', 'delete'), 
  deleteUser
);
```

---

### 4. Testing Strategy

#### Test Pyramid

```markdown
        /\
       /  \      E2E Tests (10%)
      /----\     - Critical user journeys
     /      \    - Slow, expensive
    /--------\   
   /  Integration \  - API tests (20%)
  /----------------\ - Database, external services
 /    Unit Tests    \ - Fast, isolated (70%)
/--------------------\
```

#### Unit Test Pattern

```typescript
// ✅ Good: Isolated, fast, deterministic
describe('UserService', () => {
  let service: UserService;
  let mockRepo: MockUserRepository;

  beforeEach(() => {
    mockRepo = new MockUserRepository();
    service = new UserService(mockRepo);
  });

  it('should create user with valid email', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({ id: '1', email: 'test@example.com' });

    const user = await service.createUser({ email: 'test@example.com' });

    expect(user.email).toBe('test@example.com');
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' })
    );
  });
});
```

#### Integration Test Pattern

```typescript
// Use test containers or test database
describe('User API', () => {
  let app: Express;
  let testDb: Database;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    app = createApp(testDb);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await testDb.clear();
  });

  it('POST /users should create user', async () => {
    const response = await request(app)
      .post('/users')
      .send({ email: 'test@example.com', password: 'secure123' })
      .expect(201);

    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data.email).toBe('test@example.com');
  });
});
```

---

### 5. Logging & Monitoring

#### Structured Logging

```typescript
// ✅ Good: JSON structured logs
logger.info('User created', {
  userId: user.id,
  email: user.email,
  requestId: req.headers['x-request-id'],
  duration: Date.now() - startTime
});

// ❌ Bad: Unstructured logs
logger.info(`User ${user.id} created with email ${user.email}`);

// Log Levels
// ERROR - Something broke, needs immediate attention
// WARN  - Something unexpected but handled (fallback used, retry succeeded)
// INFO  - Important business events (user created, order placed)
// DEBUG - Detailed technical info for debugging
// TRACE - Very detailed, usually disabled in production
```

#### Correlation IDs

```typescript
// Middleware to add request ID
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuid();
  res.setHeader('x-request-id', req.id);
  logger.setContext({ requestId: req.id });
  next();
});

// Propagate to downstream services
axios.get('/api/users', {
  headers: { 'x-request-id': req.id }
});
```

#### Metrics to Track

```markdown
## Golden Signals (SRE)
1. Latency - Time to serve requests (p50, p95, p99)
2. Traffic - Requests per second
3. Errors - Error rate (4xx, 5xx)
4. Saturation - Resource utilization (CPU, memory, disk)

## Business Metrics
- User signups/conversions
- API endpoint usage
- Database query performance
- Cache hit rates
```

---

### 6. Security Practices

#### Input Validation

```typescript
// ✅ Good: Validate all inputs
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/, 'Must contain uppercase'),
  age: z.number().min(0).max(150),
  role: z.enum(['user', 'admin']).default('user')
});

// Validate request body
const result = schema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ error: 'Validation failed', details: result.error });
}
```

#### SQL Injection Prevention

```typescript
// ✅ Good: Parameterized queries
const user = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

// ❌ Bad: String concatenation
const user = await db.query(
  `SELECT * FROM users WHERE email = '${email}'`  // VULNERABLE!
);
```

#### XSS Prevention

```typescript
// ✅ Good: Escape output, use CSP
res.setHeader('Content-Security-Policy', "default-src 'self'");

// Sanitize user input before storing/displaying
const sanitized = DOMPurify.sanitize(userInput);

// Use template engines with auto-escaping
// ✅ EJS, Pug, Handlebars (auto-escape by default)
```

#### Rate Limiting

```typescript
// Express rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to routes
app.use('/api/', limiter);
app.use('/auth/', stricterLimiter);
```

---

### 7. Deployment & DevOps

#### Docker Best Practices

```dockerfile
# ✅ Good: Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
CMD ["node", "dist/index.js"]

# ❌ Bad: Single stage, running as root
FROM node:20
COPY . .
RUN npm install
CMD ["node", "index.js"]
```

#### Environment Configuration

```markdown
## 12-Factor App Principles

1. Codebase - One codebase tracked in version control
2. Dependencies - Explicitly declare and isolate
3. Config - Store config in environment variables
4. Backing services - Treat as attached resources
5. Build, release, run - Strictly separate stages
6. Processes - Execute as stateless processes
7. Port binding - Export services via port binding
8. Concurrency - Scale out via process model
9. Disposability - Fast startup, graceful shutdown
10. Dev/prod parity - Keep environments similar
11. Logs - Treat as event streams
12. Admin processes - Run one-off tasks as processes
```

#### Health Checks

```typescript
// Kubernetes-ready health endpoints
app.get('/health/live', (req, res) => {
  // Basic liveness - is the process running?
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/ready', async (req, res) => {
  // Readiness - can we serve traffic?
  try {
    await db.ping();
    await redis.ping();
    res.json({ status: 'ok', dependencies: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});
```

---

## 🛠️ Tool Recommendations

### By Language

| Language | Framework | ORM | Testing | Auth |
|----------|-----------|-----|---------|------|
| Node.js | Express/Fastify/NestJS | Prisma/TypeORM | Jest/Vitest | Passport/Auth0 |
| Python | FastAPI/Django | SQLAlchemy/Django ORM | pytest | Flask-JWT |
| Go | Gin/Echo | GORM | testify | golang-jwt |
| Java | Spring Boot | Hibernate | JUnit | Spring Security |

### Essential Tools

```markdown
## Development
- Postman/Insomnia - API testing
- DBeaver/DataGrip - Database GUI
- Docker Desktop - Local containers

## Monitoring
- Prometheus + Grafana - Metrics
- ELK Stack - Log aggregation
- Jaeger/Zipkin - Distributed tracing

## CI/CD
- GitHub Actions / GitLab CI
- ArgoCD - GitOps deployment
- Terraform - Infrastructure as code
```

---

## 🚨 Common Pitfalls

### 1. Database

```markdown
❌ N+1 Query Problem
✅ Use eager loading or batch queries

❌ No transaction for multi-step operations
✅ Wrap in transaction with proper rollback

❌ Storing plain text passwords
✅ Use bcrypt/argon2 with proper salt rounds

❌ Connection pool exhaustion
✅ Configure pool size, use connection pooling
```

### 2. API Design

```markdown
❌ Inconsistent error responses
✅ Standardize error format across all endpoints

❌ No pagination on list endpoints
✅ Implement cursor/offset pagination

❌ Versioning in URL query params
✅ Use URL path versioning: /api/v1/users

❌ Returning internal error details
✅ Log details internally, return generic message to client
```

### 3. Security

```markdown
❌ Hardcoded secrets in code
✅ Use environment variables or secret manager

❌ No rate limiting on auth endpoints
✅ Implement rate limiting + account lockout

❌ Trusting client-side validation only
✅ Always validate on server

❌ Logging sensitive data (passwords, tokens)
✅ Redact sensitive fields in logs
```

---

## 📋 Code Review Checklist

### Architecture
- [ ] Follows separation of concerns
- [ ] No circular dependencies
- [ ] Proper error handling
- [ ] Logging at appropriate levels

### Security
- [ ] Input validation on all endpoints
- [ ] Authentication/authorization in place
- [ ] No SQL injection vulnerabilities
- [ ] Secrets not hardcoded

### Performance
- [ ] Database queries optimized (indexes, no N+1)
- [ ] Caching strategy for expensive operations
- [ ] Connection pooling configured
- [ ] No memory leaks

### Testing
- [ ] Unit tests for business logic
- [ ] Integration tests for API endpoints
- [ ] Test coverage > 80%
- [ ] Tests are deterministic and fast

---

## 🎓 Quick Reference

### HTTP Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200 | OK | Successful GET/PUT/PATCH |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Missing/invalid auth |
| 403 | Forbidden | No permission |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate, version conflict |
| 422 | Unprocessable | Validation errors |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Error | Server bug |
| 503 | Unavailable | Maintenance, overload |

### Database Indexing Rules

```markdown
1. Index foreign keys
2. Index columns in WHERE clauses
3. Index columns used in JOINs
4. Index columns in ORDER BY
5. Use composite indexes for multi-column queries
6. Avoid indexing low-cardinality columns (boolean, status)
7. Monitor index usage, remove unused indexes
```

---

## 🔗 Resources

- [12-Factor App](https://12factor.net/)
- [REST API Best Practices](https://restfulapi.net/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

---

_Last updated: 2026-04-21_

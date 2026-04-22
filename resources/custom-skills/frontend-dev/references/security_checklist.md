# 前端安全检查清单

## OWASP Top 10 前端安全

### 1. XSS (跨站脚本攻击) 防护

```typescript
// ❌ 危险 - 直接插入 HTML
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// ✅ 安全 - 使用 DOMPurify 净化
import DOMPurify from 'dompurify'

const clean = DOMPurify.sanitize(userContent, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
  ALLOWED_ATTR: ['href'],
  ALLOWED_URI_REGEXP: /^https:\/\//,
})

<div dangerouslySetInnerHTML={{ __html: clean }} />

// ✅ 更安全 - 避免使用 dangerouslySetInnerHTML
<div>{userContent}</div>  // React 自动转义
```

### 2. CSRF (跨站请求伪造) 防护

```typescript
// 使用 CSRF Token
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content

fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({ amount: 100 }),
})

// 使用 SameSite Cookie
// Set-Cookie: session=abc; SameSite=Strict; Secure; HttpOnly
```

### 3. 敏感数据保护

```typescript
// ❌ 避免在客户端存储敏感数据
localStorage.setItem('token', authToken)  // 可被 XSS 读取

// ✅ 使用 HttpOnly Cookie
// 由服务器设置，JavaScript 无法访问

// ✅ 如必须使用 localStorage，加密存储
import { encrypt, decrypt } from './crypto'

const storeToken = (token: string) => {
  const encrypted = encrypt(token, encryptionKey)
  sessionStorage.setItem('token', encrypted)
}

// ✅ 敏感信息不记录日志
// ❌
console.log('User data:', userData)

// ✅
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info...')
}
```

### 4. 输入验证

```typescript
// 客户端验证 + 服务端验证
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const validatePassword = (password: string): string[] => {
  const errors: string[] = []
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain uppercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain number')
  }
  
  return errors
}

// 使用验证库
import * as z from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  age: z.number().min(18).max(120),
})

// 验证
try {
  const validData = userSchema.parse(formData)
} catch (error) {
  console.error(error.errors)
}
```

### 5. 依赖安全

```bash
# 定期检查漏洞
npm audit
npx npm-check-updates

# 使用锁文件
package-lock.json  # npm
yarn.lock          # yarn
pnpm-lock.yaml     # pnpm

# 自动化安全检查
# .github/workflows/security.yml
name: Security Audit
on:
  push:
    paths:
      - 'package.json'
      - 'package-lock.json'
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/audit-npm@v1
```

## 认证和授权

### 6. 安全认证实现

```typescript
// JWT Token 处理
interface JWTPayload {
  sub: string      // 用户 ID
  iat: number      // 签发时间
  exp: number      // 过期时间
  role: string     // 角色
}

// Token 刷新机制
const useAuth = () => {
  const [token, setToken] = useState<string | null>(null)
  const refreshTimer = useRef<NodeJS.Timeout>()
  
  const refreshToken = useCallback(async () => {
    try {
      const response = await fetch('/api/refresh', {
        method: 'POST',
        credentials: 'include',  // 发送 HttpOnly Cookie
      })
      const data = await response.json()
      setToken(data.accessToken)
      
      // 设置下次刷新时间 (提前 5 分钟)
      const payload = decodeJWT(data.accessToken)
      const refreshTime = (payload.exp - Date.now() / 1000 - 300) * 1000
      refreshTimer.current = setTimeout(refreshToken, refreshTime)
    } catch (error) {
      // 刷新失败，跳转到登录页
      window.location.href = '/login'
    }
  }, [])
  
  useEffect(() => {
    refreshToken()
    return () => clearTimeout(refreshTimer.current)
  }, [refreshToken])
  
  return { token, refreshToken }
}

// 权限检查
const usePermission = (requiredRole: string) => {
  const { user } = useAuth()
  
  const hasPermission = useMemo(() => {
    const roleHierarchy = {
      admin: 3,
      manager: 2,
      user: 1,
    }
    return roleHierarchy[user?.role] >= roleHierarchy[requiredRole]
  }, [user, requiredRole])
  
  return hasPermission
}
```

### 7. 安全路由守卫

```typescript
// 认证守卫
const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth()
  
  if (isLoading) return <LoadingSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  
  return <>{children}</>
}

// 角色守卫
const RoleGuard: React.FC<{ 
  children: React.ReactNode
  roles: string[] 
}> = ({ children, roles }) => {
  const { user } = useAuth()
  
  if (!roles.includes(user?.role)) {
    return <Navigate to="/unauthorized" replace />
  }
  
  return <>{children}</>
}

// 使用
<Routes>
  <Route path="/dashboard" element={
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  } />
  <Route path="/admin" element={
    <AuthGuard>
      <RoleGuard roles={['admin']}>
        <AdminPanel />
      </RoleGuard>
    </AuthGuard>
  } />
</Routes>
```

## 内容安全

### 8. CSP (内容安全策略)

```html
<!-- HTML meta 标签 -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://cdn.example.com; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https:; 
               connect-src 'self' https://api.example.com;
               frame-ancestors 'none';
               base-uri 'self';
               form-action 'self';">

<!-- 或通过 HTTP 头 -->
Content-Security-Policy: default-src 'self'; script-src 'self' ...
```

### 9. iframe 安全

```typescript
// 限制 iframe 权限
<iframe 
  src="https://external.com"
  sandbox="allow-scripts allow-same-origin"
  title="External Content"
/>

// 使用 X-Frame-Options 防止点击劫持
// 服务器设置:
// X-Frame-Options: DENY
// 或
// X-Frame-Options: SAMEORIGIN
```

## API 安全

### 10. API 请求安全

```typescript
// 请求拦截器 - 添加认证头
axios.interceptors.request.use(config => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // 添加请求 ID 用于追踪
  config.headers['X-Request-ID'] = generateUUID()
  return config
})

// 响应拦截器 - 处理错误
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      // 未授权，清除 token 并跳转登录
      clearAuth()
      window.location.href = '/login'
    }
    if (error.response?.status === 403) {
      // 禁止访问
      window.location.href = '/unauthorized'
    }
    // 不暴露详细错误信息给用户
    return Promise.reject(new Error('Request failed'))
  }
)

// 请求速率限制
const createRateLimiter = (maxRequests: number, windowMs: number) => {
  const requests: number[] = []
  
  return async (request: () => Promise<any>) => {
    const now = Date.now()
    // 移除窗口外的请求
    while (requests.length && requests[0] < now - windowMs) {
      requests.shift()
    }
    
    if (requests.length >= maxRequests) {
      throw new Error('Rate limit exceeded')
    }
    
    requests.push(now)
    return request()
  }
}

const apiRequest = createRateLimiter(10, 60000) // 10 次/分钟
```

## 安全配置检查清单

### 服务器配置
- [ ] 启用 HTTPS (TLS 1.3)
- [ ] 设置 HSTS 头
- [ ] 配置 CSP 策略
- [ ] 设置安全 Cookie (HttpOnly, Secure, SameSite)
- [ ] 禁用目录列表
- [ ] 隐藏服务器版本信息

### 代码安全
- [ ] 所有输入都验证
- [ ] 所有输出都转义
- [ ] 不使用 eval()
- [ ] 不使用 innerHTML (除非净化)
- [ ] 敏感数据不存 localStorage
- [ ] 实现 CSRF 保护

### 依赖管理
- [ ] 定期更新依赖
- [ ] 运行 npm audit
- [ ] 使用锁文件
- [ ] 审查第三方代码
- [ ] 最小化依赖数量

### 监控和响应
- [ ] 记录安全事件
- [ ] 实现异常监控
- [ ] 设置告警机制
- [ ] 制定应急响应流程
- [ ] 定期安全审计

## 安全测试

```typescript
// 自动化安全测试
describe('Security Tests', () => {
  it('should sanitize user input', () => {
    const maliciousInput = '<script>alert("xss")</script>'
    const sanitized = sanitizeInput(maliciousInput)
    expect(sanitized).not.toContain('<script>')
  })
  
  it('should require authentication', async () => {
    const response = await fetch('/api/protected')
    expect(response.status).toBe(401)
  })
  
  it('should validate authorization', async () => {
    const userToken = getUserToken('user')
    const response = await fetch('/api/admin', {
      headers: { Authorization: `Bearer ${userToken}` }
    })
    expect(response.status).toBe(403)
  })
})
```

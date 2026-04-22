# 前端测试指南

## 测试金字塔

```
        /\
       /  \
      / E2E \     少量 - 模拟用户行为
     /______\
    /        \
   / Integration \  中量 - 组件集成
  /______________\
 /                \
/    Unit Tests    \ 大量 - 单个函数/组件
--------------------
```

## 单元测试 (Vitest + Testing Library)

### 1. 基础测试配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      threshold: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
})

// src/test/setup.ts
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 每个测试后清理
afterEach(() => {
  cleanup()
})
```

### 2. 组件测试

```typescript
// Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })
  
  it('handles click events', async () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click</Button>)
    
    await fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
  
  it('shows loading state', () => {
    render(<Button loading>Loading</Button>)
    
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
  
  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Test</Button>)
    
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
```

### 3. 异步测试

```typescript
// UserProfile.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserProfile } from './UserProfile'
import * as api from '@/api/user'

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('UserProfile', () => {
  it('fetches and displays user data', async () => {
    vi.spyOn(api, 'fetchUser').mockResolvedValue({
      id: '1',
      name: 'John Doe',
      email: 'john@example.com',
    })
    
    render(<UserProfile userId="1" />, { wrapper: createWrapper() })
    
    // 等待数据加载
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    
    const nameElement = await screen.findByText(/john doe/i)
    expect(nameElement).toBeInTheDocument()
    expect(screen.getByText(/john@example.com/i)).toBeInTheDocument()
  })
  
  it('handles error state', async () => {
    vi.spyOn(api, 'fetchUser').mockRejectedValue(new Error('Not found'))
    
    render(<UserProfile userId="999" />, { wrapper: createWrapper() })
    
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })
  
  it('allows editing user info', async () => {
    const user = userEvent.setup()
    const mockUpdate = vi.fn()
    vi.spyOn(api, 'fetchUser').mockResolvedValue({ id: '1', name: 'John', email: 'john@example.com' })
    vi.spyOn(api, 'updateUser').mockImplementation(mockUpdate)
    
    render(<UserProfile userId="1" editable />, { wrapper: createWrapper() })
    
    await screen.findByText(/john/i)
    
    // 点击编辑
    await user.click(screen.getByRole('button', { name: /edit/i }))
    
    // 修改名字
    const nameInput = screen.getByLabelText(/name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Jane')
    
    // 保存
    await user.click(screen.getByRole('button', { name: /save/i }))
    
    expect(mockUpdate).toHaveBeenCalledWith({ id: '1', name: 'Jane', email: 'john@example.com' })
  })
})
```

### 4. Hooks 测试

```typescript
// useCounter.test.ts
import { renderHook, act } from '@testing-library/react'
import { useCounter } from './useCounter'

describe('useCounter', () => {
  it('initializes with default value', () => {
    const { result } = renderHook(() => useCounter())
    expect(result.current.count).toBe(0)
  })
  
  it('initializes with provided value', () => {
    const { result } = renderHook(() => useCounter(10))
    expect(result.current.count).toBe(10)
  })
  
  it('increments count', () => {
    const { result } = renderHook(() => useCounter())
    
    act(() => {
      result.current.increment()
    })
    
    expect(result.current.count).toBe(1)
    
    act(() => {
      result.current.increment()
    })
    
    expect(result.current.count).toBe(2)
  })
  
  it('decrements count', () => {
    const { result } = renderHook(() => useCounter(5))
    
    act(() => {
      result.current.decrement()
    })
    
    expect(result.current.count).toBe(4)
  })
  
  it('respects min/max limits', () => {
    const { result } = renderHook(() => useCounter(0, { min: 0, max: 5 }))
    
    act(() => {
      result.current.decrement()
    })
    expect(result.current.count).toBe(0) // 不会低于最小值
    
    act(() => {
      result.current.increment()
      result.current.increment()
      result.current.increment()
      result.current.increment()
      result.current.increment()
      result.current.increment()
    })
    expect(result.current.count).toBe(5) // 不会超过最大值
  })
})
```

### 5. 自定义渲染器

```typescript
// test-utils.tsx
import { render, RenderOptions } from '@testing-library/react'
import { Provider } from 'react-redux'
import { ThemeProvider } from '@emotion/react'
import { BrowserRouter } from 'react-router-dom'
import { store } from '@/store'
import { theme } from '@/theme'

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  store?: typeof store
  theme?: typeof theme
  route?: string
}

const AllTheProviders = ({ 
  children, 
  store, 
  theme,
  route = '/' 
}: { 
  children: React.ReactNode
  store: typeof store
  theme: typeof theme
  route: string
}) => {
  window.history.pushState({}, 'Test page', route)
  
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  )
}

const customRender = (
  ui: React.ReactElement,
  options?: CustomRenderOptions
) => {
  return render(ui, {
    wrapper: (props) => (
      <AllTheProviders 
        {...props} 
        store={options?.store || store}
        theme={options?.theme || theme}
        route={options?.route || '/'}
      />
    ),
    ...options,
  })
}

// 重新导出 everything
export * from '@testing-library/react'
export { customRender as render }
```

## 集成测试

### 6. 组件集成测试

```typescript
// LoginForm.integration.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { LoginForm } from './LoginForm'
import { server } from '@/mocks/server'
import { rest } from 'msw'

describe('LoginForm Integration', () => {
  beforeAll(() => server.listen())
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  
  it('completes login flow', async () => {
    const user = userEvent.setup()
    const onLoginSuccess = vi.fn()
    
    // Mock API
    server.use(
      rest.post('/api/login', (req, res, ctx) => {
        return res(ctx.json({ token: 'fake-token', user: { id: '1', name: 'Test' } }))
      })
    )
    
    render(<LoginForm onSuccess={onLoginSuccess} />)
    
    // 填写表单
    await user.type(screen.getByLabelText(/email/i), 'test@example.com')
    await user.type(screen.getByLabelText(/password/i), 'password123')
    
    // 提交
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    // 验证加载状态
    expect(screen.getByRole('button')).toBeDisabled()
    
    // 验证成功
    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalledWith({
        token: 'fake-token',
        user: { id: '1', name: 'Test' }
      })
    })
  })
  
  it('shows validation errors', async () => {
    const user = userEvent.setup()
    render(<LoginForm onSuccess={vi.fn()} />)
    
    // 尝试提交空表单
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument()
    expect(await screen.findByText(/password is required/i)).toBeInTheDocument()
  })
})
```

## E2E 测试 (Playwright)

### 7. Playwright 配置

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### 8. E2E 测试示例

```typescript
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test('completes registration and login', async ({ page }) => {
    // 访问注册页面
    await page.goto('/register')
    
    // 填写注册表单
    await page.fill('[name="name"]', 'Test User')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.fill('[name="confirmPassword"]', 'password123')
    
    // 提交
    await page.click('button[type="submit"]')
    
    // 验证跳转到登录页
    await expect(page).toHaveURL('/login')
    await expect(page.locator('text=Registration successful')).toBeVisible()
    
    // 登录
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')
    
    // 验证登录成功
    await expect(page).toHaveURL('/dashboard')
    await expect(page.locator('text=Welcome')).toBeVisible()
  })
  
  test('handles authentication errors', async ({ page }) => {
    await page.goto('/login')
    
    // 使用错误密码
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    
    // 验证错误消息
    await expect(page.locator('text=Invalid credentials')).toBeVisible()
  })
})

// e2e/dashboard.spec.ts
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('/login')
    await page.fill('[name="email"]', 'test@example.com')
    await page.fill('[name="password"]', 'password123')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL('/dashboard')
  })
  
  test('displays user statistics', async ({ page }) => {
    await expect(page.locator('[data-testid="stats-card"]')).toBeVisible()
    await expect(page.locator('text=Total Users')).toBeVisible()
  })
  
  test('allows creating new item', async ({ page }) => {
    await page.click('[data-testid="create-button"]')
    await page.fill('[name="title"]', 'New Item')
    await page.click('[data-testid="save-button"]')
    
    await expect(page.locator('text=Item created')).toBeVisible()
    await expect(page.locator('text=New Item')).toBeVisible()
  })
})
```

## Mock 数据

### 9. MSW (Mock Service Worker)

```typescript
// mocks/handlers.ts
import { rest } from 'msw'
import { faker } from '@faker-js/faker'

export const handlers = [
  // 用户 API
  rest.get('/api/users/:id', (req, res, ctx) => {
    const { id } = req.params
    return res(
      ctx.json({
        id,
        name: faker.person.fullName(),
        email: faker.internet.email(),
      })
    )
  }),
  
  rest.post('/api/login', async (req, res, ctx) => {
    const { email, password } = await req.json()
    
    if (email === 'test@example.com' && password === 'password123') {
      return res(
        ctx.json({
          token: 'fake-jwt-token',
          user: { id: '1', name: 'Test User', email }
        })
      )
    }
    
    return res(
      ctx.status(401),
      ctx.json({ message: 'Invalid credentials' })
    )
  }),
  
  // 网络错误模拟
  rest.get('/api/error', (req, res, ctx) => {
    return res(ctx.status(500), ctx.json({ message: 'Server error' }))
  }),
  
  // 延迟模拟
  rest.get('/api/slow', async (req, res, ctx) => {
    await new Promise(resolve => setTimeout(resolve, 2000))
    return res(ctx.json({ data: 'slow response' }))
  }),
]

// mocks/server.ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

## 测试最佳实践

### 10. 测试原则

```typescript
// ✅ 好的测试
describe('UserProfile', () => {
  it('displays user name when loaded', async () => {
    // Arrange
    render(<UserProfile userId="1" />)
    
    // Act & Assert
    expect(await screen.findByText('John Doe')).toBeInTheDocument()
  })
})

// ❌ 避免的测试
test('works correctly', () => {
  // 太模糊，不知道测试什么
})

test('component renders and clicks and fetches data and...', () => {
  // 测试太多内容，应该拆分
})
```

### 测试检查清单
- [ ] 测试覆盖核心功能
- [ ] 测试边界条件
- [ ] 测试错误场景
- [ ] 测试异步操作
- [ ] 测试用户交互
- [ ] 保持测试独立性
- [ ] 使用有意义的测试名称
- [ ] 避免测试实现细节
- [ ] 定期运行测试套件
- [ ] 在 CI 中集成测试

# 前端编码规范

## 命名约定

### 文件和目录
- **组件文件**: PascalCase，如 `UserProfile.tsx`
- **工具函数**: camelCase，如 `formatDate.ts`
- **常量文件**: UPPER_SNAKE_CASE，如 `API_ENDPOINTS.ts`
- **样式文件**: 与组件同名，如 `UserProfile.module.css`
- **目录**: 小写 + 连字符，如 `user-profile/`

### 代码命名
```typescript
// 组件 - PascalCase
const UserProfile: React.FC<Props> = () => {}

// 函数/变量 - camelCase
const getUserData = () => {}
const userData = {}

// 常量 - UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3
const API_BASE_URL = 'https://api.example.com'

// 类型/接口 - PascalCase
interface UserData {}
type UserStatus = 'active' | 'inactive'

// CSS 类 - kebab-case (HTML) / camelCase (JS)
<div className="user-profile-card">
```

## TypeScript 规范

### 类型定义优先级
1. 优先使用 `interface` 定义对象类型
2. 使用 `type` 定义联合类型、元组
3. 避免使用 `any`，使用 `unknown` 代替

```typescript
// ✅ 好的做法
interface User {
  id: string
  name: string
  email?: string  // 可选属性
}

type Status = 'pending' | 'success' | 'error'

// ❌ 避免
const user: any = {}
```

### 泛型使用
```typescript
// 有意义的泛型名称
interface ApiResponse<T> {
  data: T
  status: number
}

// 泛型约束
function identity<T extends object>(arg: T): T {
  return arg
}
```

## React 规范

### 组件结构
```typescript
import React, { useState, useEffect } from 'react'
import { SomeComponent } from './SomeComponent'
import styles from './MyComponent.module.css'
import type { MyComponentProps } from './MyComponent.types'

// 类型定义
export interface MyComponentProps {
  title: string
  onAction?: () => void
}

// 组件
export const MyComponent: React.FC<MyComponentProps> = ({ 
  title, 
  onAction 
}) => {
  // 1. Hooks
  const [state, setState] = useState('')
  
  // 2. Effects
  useEffect(() => {
    // side effects
  }, [])
  
  // 3. Event handlers
  const handleClick = () => {
    onAction?.()
  }
  
  // 4. Render
  return (
    <div className={styles.container}>
      <h1>{title}</h1>
    </div>
  )
}
```

### Hooks 规则
- 只在组件顶层调用 Hooks
- 只在 React 函数中调用 Hooks
- 自定义 Hooks 以 `use` 开头

### Props 传递
```typescript
// ✅ 使用展开运算符
<MyComponent {...props} />

// ✅ 明确解构
const { title, onClick } = props

// ❌ 避免传递整个 props 对象
<MyComponent props={props} />
```

## CSS 规范

### CSS Modules 优先
```css
/* UserProfile.module.css */
.container {
  display: flex;
  gap: 1rem;
}

.userName {
  font-weight: 600;
}
```

```typescript
import styles from './UserProfile.module.css'

<div className={styles.container}>
  <span className={styles.userName}>John</span>
</div>
```

### 使用 CSS 变量
```css
:root {
  --color-primary: #0070f3;
  --color-text: #333;
  --spacing-unit: 8px;
}

.button {
  color: var(--color-primary);
  padding: calc(var(--spacing-unit) * 2);
}
```

## 代码组织

### 目录结构
```
src/
├── components/     # 可复用组件
│   ├── ui/        # 基础 UI 组件
│   └── features/  # 业务组件
├── hooks/         # 自定义 Hooks
├── utils/         # 工具函数
├── types/         # 类型定义
├── services/      # API 服务
├── store/         # 状态管理
├── styles/        # 全局样式
└── pages/         # 页面组件
```

### 导入顺序
```typescript
// 1. React
import React from 'react'

// 2. 第三方库
import { useState } from 'react'
import axios from 'axios'

// 3. 内部模块
import { utils } from '@/utils'

// 4. 样式
import styles from './Component.module.css'

// 5. 类型
import type { ComponentProps } from './types'
```

## 性能最佳实践

### 避免不必要的重渲染
```typescript
// 使用 useMemo
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(a, b)
}, [a, b])

// 使用 useCallback
const handleClick = useCallback(() => {
  doSomething(a, b)
}, [a, b])

// 使用 React.memo
export default React.memo(MyComponent)
```

### 代码分割
```typescript
// 懒加载组件
const LazyComponent = lazy(() => import('./LazyComponent'))

// 路由级代码分割
const Dashboard = lazy(() => import('./pages/Dashboard'))
```

## 错误处理

### 错误边界
```typescript
class ErrorBoundary extends React.Component {
  state = { hasError: false }
  
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  
  render() {
    if (this.state.hasError) {
      return <FallbackUI />
    }
    return this.props.children
  }
}
```

### Async 错误处理
```typescript
const fetchData = async () => {
  try {
    const data = await api.get()
    return data
  } catch (error) {
    logger.error('Fetch failed', error)
    throw error
  }
}
```

## Git 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

示例：
```bash
git commit -m "feat: add user profile component"
git commit -m "fix: resolve memory leak in useEffect"
```

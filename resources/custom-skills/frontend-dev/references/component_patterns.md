# 组件设计模式

## 基础模式

### 1. 容器/展示组件模式 (Container/Presentational)

```typescript
// 展示组件 - 只负责 UI
interface UserCardProps {
  user: User
  onSelect: (id: string) => void
}

export const UserCard: React.FC<UserCardProps> = ({ user, onSelect }) => (
  <div className="user-card" onClick={() => onSelect(user.id)}>
    <h3>{user.name}</h3>
    <p>{user.email}</p>
  </div>
)

// 容器组件 - 负责数据获取和状态
export const UserCardContainer: React.FC = () => {
  const { data: user, isLoading } = useUserQuery()
  const handleSelect = useCallback((id: string) => {
    // 业务逻辑
  }, [])
  
  if (isLoading) return <Skeleton />
  return <UserCard user={user} onSelect={handleSelect} />
}
```

### 2. 复合组件模式 (Compound Components)

```typescript
// 父组件提供上下文
interface SelectContextType {
  value: string
  onChange: (value: string) => void
}

const SelectContext = React.createContext<SelectContextType | null>(null)

interface SelectProps {
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}

export const Select: React.FC<SelectProps> & {
  Option: typeof SelectOption
} = ({ value, onChange, children }) => {
  return (
    <SelectContext.Provider value={{ value, onChange }}>
      <div className="select">{children}</div>
    </SelectContext.Provider>
  )
}

// 子组件消费上下文
const SelectOption: React.FC<{ value: string; children: React.ReactNode }> = ({ 
  value, 
  children 
}) => {
  const context = React.useContext(SelectContext)
  const isSelected = context?.value === value
  
  return (
    <div 
      className={`option ${isSelected ? 'selected' : ''}`}
      onClick={() => context?.onChange(value)}
    >
      {children}
    </div>
  )
}

Select.Option = SelectOption

// 使用
<Select value={selected} onChange={setSelected}>
  <Select.Option value="1">Option 1</Select.Option>
  <Select.Option value="2">Option 2</Select.Option>
</Select>
```

### 3. 受控/非受控组件

```typescript
interface InputProps {
  value?: string      // 受控
  defaultValue?: string  // 非受控
  onChange?: (value: string) => void
}

export const Input: React.FC<InputProps> = ({ 
  value, 
  defaultValue, 
  onChange 
}) => {
  const [internalValue, setInternalValue] = useState(defaultValue || '')
  
  const isControlled = value !== undefined
  const currentValue = isControlled ? value : internalValue
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (!isControlled) {
      setInternalValue(newValue)
    }
    onChange?.(newValue)
  }
  
  return <input value={currentValue} onChange={handleChange} />
}
```

### 4. 高阶组件 (HOC) - 现代替代方案：Hooks

```typescript
// ❌ 老方式：HOC
const withAuth = (WrappedComponent) => {
  return (props) => {
    const { user } = useAuth()
    if (!user) return <Login />
    return <WrappedComponent {...props} user={user} />
  }
}

// ✅ 现代方式：自定义 Hook
export const useAuthRequired = () => {
  const { user, isLoading } = useAuth()
  
  if (isLoading) return { loading: true }
  if (!user) return { redirect: '/login' }
  
  return { user, authenticated: true }
}

// 组件中使用
const Dashboard = () => {
  const auth = useAuthRequired()
  
  if (auth.loading) return <Spinner />
  if (auth.redirect) return <Navigate to={auth.redirect} />
  
  return <div>Welcome {auth.user.name}</div>
}
```

## 高级模式

### 5. 渲染 Props 模式

```typescript
interface MouseTrackerProps {
  render: (position: { x: number; y: number }) => React.ReactNode
}

export const MouseTracker: React.FC<MouseTrackerProps> = ({ render }) => {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])
  
  return <>{render(position)}</>
}

// 使用
<MouseTracker render={({ x, y }) => (
  <div>Mouse at: {x}, {y}</div>
)} />
```

### 6. 状态机模式 (使用 XState 或原生)

```typescript
type State = 'idle' | 'loading' | 'success' | 'error'

interface StateMachine {
  state: State
  transition: (event: string) => void
}

const useSubmitMachine = (): StateMachine => {
  const [state, setState] = useState<State>('idle')
  
  const transition = useCallback((event: string) => {
    setState(prev => {
      switch (prev) {
        case 'idle':
          return event === 'SUBMIT' ? 'loading' : prev
        case 'loading':
          return event === 'SUCCESS' ? 'success' : 
                 event === 'ERROR' ? 'error' : prev
        case 'success':
        case 'error':
          return event === 'RESET' ? 'idle' : prev
        default:
          return prev
      }
    })
  }, [])
  
  return { state, transition }
}

// 使用
const SubmitForm = () => {
  const { state, transition } = useSubmitMachine()
  
  const handleSubmit = async () => {
    transition('SUBMIT')
    try {
      await api.submit()
      transition('SUCCESS')
    } catch {
      transition('ERROR')
    }
  }
  
  return (
    <button onClick={handleSubmit} disabled={state === 'loading'}>
      {state === 'loading' ? 'Submitting...' : 'Submit'}
    </button>
  )
}
```

### 7. 虚拟列表模式 (大数据量)

```typescript
interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  containerHeight: number
}

export const VirtualList = <T,>({ 
  items, 
  itemHeight, 
  renderItem,
  containerHeight 
}: VirtualListProps<T>) => {
  const [scrollTop, setScrollTop] = useState(0)
  
  const visibleCount = Math.ceil(containerHeight / itemHeight)
  const startIndex = Math.floor(scrollTop / itemHeight)
  const endIndex = Math.min(startIndex + visibleCount, items.length)
  
  const visibleItems = items.slice(startIndex, endIndex)
  const totalHeight = items.length * itemHeight
  const offsetY = startIndex * itemHeight
  
  return (
    <div 
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, i) => (
            <div key={startIndex + i} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

### 8. 错误边界组件

```typescript
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null }
  
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-fallback">
          <h2>Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      )
    }
    
    return this.props.children
  }
}

// 使用
<ErrorBoundary fallback={<ErrorPage />}>
  <Dashboard />
</ErrorBoundary>
```

## 性能优化模式

### 9. 记忆化模式

```typescript
// 昂贵的计算
const ExpensiveComponent = React.memo(({ data }) => {
  const processed = useMemo(() => {
    return heavyComputation(data)
  }, [data])
  
  return <div>{processed}</div>
})

// 回调记忆化
const Parent = () => {
  const [count, setCount] = useState(0)
  
  const handleClick = useCallback(() => {
    console.log('clicked')
  }, [])
  
  return <ExpensiveComponent onClick={handleClick} data={data} />
}
```

### 10. 懒加载模式

```typescript
// 组件懒加载
const Chart = lazy(() => import('./Chart'))

// 使用 Suspense
<Suspense fallback={<Spinner />}>
  <Chart data={data} />
</Suspense>

// 图片懒加载
const LazyImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={() => setIsLoaded(true)}
      style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.3s' }}
    />
  )
}
```

## 表单模式

### 11. 表单验证模式

```typescript
interface FormErrors<T> {
  [K in keyof T]?: string
}

const useFormValidation = <T extends Record<string, any>>(
  initialValues: T,
  validate: (values: T) => FormErrors<T>
) => {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState<FormErrors<T>>({})
  const [touched, setTouched] = useState<Record<keyof T, boolean>>({} as any)
  
  const handleChange = (name: keyof T, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }))
    if (touched[name]) {
      const validation = validate({ ...values, [name]: value })
      setErrors(validation)
    }
  }
  
  const handleBlur = (name: keyof T) => {
    setTouched(prev => ({ ...prev, [name]: true }))
    const validation = validate(values)
    setErrors(validation)
  }
  
  return { values, errors, touched, handleChange, handleBlur }
}

// 使用
const LoginForm = () => {
  const { values, errors, handleChange, handleBlur } = useFormValidation(
    { email: '', password: '' },
    (v) => ({
      email: !v.email ? 'Required' : !/^\S+@\S+$/.test(v.email) ? 'Invalid' : undefined,
      password: !v.password ? 'Required' : v.password.length < 8 ? 'Too short' : undefined
    })
  )
  
  return (
    <form>
      <input
        value={values.email}
        onChange={e => handleChange('email', e.target.value)}
        onBlur={() => handleBlur('email')}
      />
      {errors.email && <span>{errors.email}</span>}
    </form>
  )
}
```

这些模式可以根据具体场景组合使用，创建灵活、可维护的组件架构。

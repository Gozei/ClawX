# 前端项目实战案例

本目录包含完整的项目案例参考，涵盖常见的前端应用场景。

---

## 案例 1: 电商后台管理系统

**技术栈**: React 18 + TypeScript + Ant Design + React Query

**项目结构**:
```
ecommerce-admin/
├── src/
│   ├── app/              # 应用配置
│   ├── features/         # 功能模块
│   │   ├── auth/        # 认证模块
│   │   ├── products/    # 商品管理
│   │   ├── orders/      # 订单管理
│   │   └── analytics/   # 数据分析
│   ├── components/       # 通用组件
│   │   ├── ui/          # 基础 UI 组件
│   │   └── layout/      # 布局组件
│   ├── hooks/           # 自定义 Hooks
│   ├── lib/             # 工具库
│   └── types/           # 类型定义
```

**核心功能实现**:

### 1.1 认证模块
```typescript
// features/auth/hooks/useAuth.ts
export const useAuth = () => {
  const { mutate: login, isLoading } = useMutation({
    mutationFn: (credentials: LoginCredentials) => 
      api.post('/auth/login', credentials),
    onSuccess: (data) => {
      localStorage.setItem('token', data.accessToken)
      queryClient.setQueryData(['user'], data.user)
    },
  })

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      localStorage.removeItem('token')
      queryClient.clear()
      navigate('/login')
    },
  })

  return { login, logout, isLoading }
}
```

### 1.2 数据表格 (带搜索、分页、排序)
```typescript
// features/products/components/ProductTable.tsx
export const ProductTable: React.FC = () => {
  const [filters, setFilters] = useState<ProductFilters>({
    page: 1,
    pageSize: 20,
    sort: 'createdAt',
    order: 'desc',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['products', filters],
    queryFn: () => api.getProducts(filters),
  })

  return (
    <Table
      dataSource={data?.items}
      loading={isLoading}
      pagination={{
        current: filters.page,
        pageSize: filters.pageSize,
        total: data?.total,
        onChange: (page, pageSize) => setFilters({ ...filters, page, pageSize }),
      }}
      onChange={(pagination, filters, sorter) => {
        setFilters({
          ...filters,
          page: pagination.current,
          sort: sorter.field as string,
          order: sorter.order,
        })
      }}
    />
  )
}
```

---

## 案例 2: SaaS 数据仪表盘

**技术栈**: Next.js 14 + TypeScript + Tailwind CSS + Recharts

**核心特性**:
- 服务端渲染 (SSR)
- 实时数据更新
- 响应式图表
- 暗色模式

### 2.1 仪表盘页面
```typescript
// app/dashboard/page.tsx
export default async function DashboardPage() {
  const metrics = await getDashboardMetrics()
  const charts = await getChartData()

  return (
    <main className="p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricCard title="总收入" value={metrics.revenue} trend={metrics.revenueTrend} />
        <MetricCard title="活跃用户" value={metrics.activeUsers} trend={metrics.userTrend} />
        <MetricCard title="订单数" value={metrics.orders} trend={metrics.orderTrend} />
        <MetricCard title="转化率" value={metrics.conversionRate} trend={metrics.conversionTrend} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart data={charts.revenue} />
        <UserActivityChart data={charts.activity} />
      </div>
    </main>
  )
}
```

### 2.2 实时数据更新
```typescript
// hooks/useRealTimeData.ts
export const useRealTimeData = (initialData: DashboardData) => {
  const [data, setData] = useState(initialData)

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL)

    ws.onmessage = (event) => {
      const update = JSON.parse(event.data)
      setData(prev => ({
        ...prev,
        [update.type]: update.value,
      }))
    }

    return () => ws.close()
  }, [])

  return data
}
```

---

## 案例 3: 移动端 H5 应用

**技术栈**: Vue 3 + Vant UI + Pinia + Vite

**核心优化**:
- 首屏加载 < 2s
- 图片懒加载
- 触摸优化
- PWA 支持

### 3.1 移动端列表 (虚拟滚动)
```vue
<!-- components/MobileList.vue -->
<template>
  <div class="mobile-list" ref="container">
    <div :style="{ height: totalHeight }">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        :style="{ transform: `translateY(${item.offset}px)` }"
        class="list-item"
      >
        <slot :item="item.data" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  items: any[]
  itemHeight: number
}>()

const container = ref<HTMLElement>()
const scrollTop = ref(0)
const visibleCount = computed(() => Math.ceil(600 / props.itemHeight))

const visibleItems = computed(() => {
  const startIndex = Math.floor(scrollTop.value / props.itemHeight)
  const endIndex = startIndex + visibleCount.value
  return props.items.slice(startIndex, endIndex).map((item, i) => ({
    id: item.id,
    data: item,
    offset: (startIndex + i) * props.itemHeight,
  }))
})

const totalHeight = props.items.length * props.itemHeight

onMounted(() => {
  container.value?.addEventListener('scroll', (e) => {
    scrollTop.value = (e.target as HTMLElement).scrollTop
  })
})
</script>
```

---

## 案例 4: 组件库开发

**技术栈**: TypeScript + Rollup + Storybook + Vitest

**项目结构**:
```
ui-library/
├── src/
│   ├── components/
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.types.ts
│   │   │   ├── Button.module.css
│   │   │   ├── Button.stories.tsx
│   │   │   └── Button.test.tsx
│   │   └── ...
│   ├── styles/
│   └── index.ts
├── .storybook/
├── rollup.config.js
└── package.json
```

### 4.1 组件开发模板
```typescript
// components/Button/Button.tsx
import React from 'react'
import classNames from 'classnames'
import { ButtonProps } from './Button.types'
import styles from './Button.module.css'

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  children,
  className,
  ...props
}) => {
  const classes = classNames(
    styles.button,
    styles[variant],
    styles[size],
    {
      [styles.disabled]: disabled,
      [styles.loading]: loading,
    },
    className
  )

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className={styles.spinner} />}
      {children}
    </button>
  )
}
```

### 4.2 Storybook 文档
```typescript
// components/Button/Button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger'],
    },
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: {
    variant: 'primary',
    children: 'Button',
  },
}

export const WithLoading: Story = {
  args: {
    variant: 'primary',
    loading: true,
    children: 'Loading',
  },
}
```

---

## 案例 5: 表单密集型应用

**技术栈**: React Hook Form + Zod + TypeScript

### 5.1 复杂表单验证
```typescript
// schemas/userForm.schema.ts
import { z } from 'zod'

export const userFormSchema = z.object({
  email: z.string().email('无效的邮箱格式'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .regex(/[A-Z]/, '必须包含大写字母')
    .regex(/[0-9]/, '必须包含数字'),
  profile: z.object({
    name: z.string().min(1, '姓名为必填'),
    age: z.number().min(18).max(120),
    bio: z.string().max(500, '简介最多 500 字'),
  }),
  tags: z.array(z.string()).max(5, '最多 5 个标签'),
})

// hooks/useUserForm.ts
export const useUserForm = () => {
  return useForm<z.infer<typeof userFormSchema>>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      email: '',
      password: '',
      profile: {
        name: '',
        age: 18,
        bio: '',
      },
      tags: [],
    },
  })
}
```

---

## 性能对比数据

| 案例 | 首屏加载 | LCP | FID | CLS | 包大小 |
|------|---------|-----|-----|-----|--------|
| 电商后台 | 1.8s | 2.1s | 45ms | 0.05 | 320KB |
| SaaS 仪表盘 | 1.5s | 1.8s | 38ms | 0.03 | 280KB |
| 移动端 H5 | 1.2s | 1.5s | 52ms | 0.08 | 180KB |
| 组件库 | 0.8s | 1.0s | 25ms | 0.02 | 45KB |

---

## 复用建议

1. **电商后台**: 适合企业内部管理系统、CRM、ERP
2. **SaaS 仪表盘**: 适合数据分析平台、监控面板
3. **移动端 H5**: 适合 C 端活动页、移动商城
4. **组件库**: 适合团队标准化建设
5. **表单应用**: 适合注册流程、数据录入系统

每个案例都可以作为新项目的起点，根据需求调整技术栈和功能。

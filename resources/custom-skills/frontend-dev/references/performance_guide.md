# 前端性能优化指南

## 核心性能指标 (Core Web Vitals)

| 指标 | 目标 | 测量内容 |
|------|------|----------|
| LCP (Largest Contentful Paint) | < 2.5s | 最大内容绘制时间 |
| FID (First Input Delay) | < 100ms | 首次输入延迟 |
| CLS (Cumulative Layout Shift) | < 0.1 | 累积布局偏移 |
| INP (Interaction to Next Paint) | < 200ms | 交互响应性 |

## 加载性能优化

### 1. 代码分割

```typescript
// 路由级分割
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))

// 组件级分割
const HeavyChart = lazy(() => import('./components/HeavyChart'))

// 条件加载
if (needsChart) {
  const Chart = await import('./Chart')
  Chart.render()
}
```

### 2. 预加载策略

```html
<!-- 关键资源预加载 -->
<link rel="preload" href="/fonts/main.woff2" as="font" crossorigin>
<link rel="preload" href="/critical.css" as="style">
<link rel="preload" href="/app.js" as="script">

<!-- 预连接 -->
<link rel="preconnect" href="https://api.example.com">
<link rel="dns-prefetch" href="https://cdn.example.com">

<!--  prefetch (空闲时加载) -->
<link rel="prefetch" href="/next-page.js">
```

### 3. Tree Shaking

```typescript
// ✅ 好的做法 - 支持 tree-shaking
import { Button, Input } from 'antd'
import { debounce } from 'lodash-es'

// ❌ 避免 - 引入整个库
import _ from 'lodash'
import * as Antd from 'antd'
```

### 4. 图片优化

```typescript
// 响应式图片
<picture>
  <source 
    srcset="image-480.webp 480w, image-800.webp 800w, image-1200.webp 1200w"
    sizes="(max-width: 600px) 480px, (max-width: 900px) 800px, 1200px"
    type="image/webp"
  >
  <img src="image-1200.jpg" alt="description" loading="lazy" />
</picture>

// 现代图片组件
<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={630}
  priority  // 首屏图片
  quality={85}
  placeholder="blur"
  blurDataURL="data:image/jpeg;base64,..."
/>
```

## 渲染性能优化

### 5. 避免不必要的重渲染

```typescript
// 使用 React.memo
const ListItem = React.memo(({ item, onClick }) => {
  return <div onClick={() => onClick(item.id)}>{item.name}</div>
})

// 使用 useMemo 缓存计算结果
const filteredList = useMemo(() => {
  return list.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name))
}, [list])

// 使用 useCallback 缓存函数
const handleClick = useCallback((id: string) => {
  setSelectedId(id)
}, [])

// 传递稳定引用
const props = useMemo(() => ({ 
  config: { theme: 'dark' } 
}), [])
<ListItem {...props} />
```

### 6. 列表虚拟化

```typescript
import { FixedSizeList } from 'react-window'

const VirtualList = ({ items }) => (
  <FixedSizeList
    height={600}
    itemCount={items.length}
    itemSize={50}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        <Item item={items[index]} />
      </div>
    )}
  </FixedSizeList>
)
```

### 7. 防抖和节流

```typescript
// 防抖 - 适用于搜索输入
const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value)
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  
  return debouncedValue
}

// 节流 - 适用于滚动/调整大小
const useThrottle = <T,>(value: T, interval: number): T => {
  const [throttledValue, setThrottledValue] = useState(value)
  const lastUpdated = useRef<number>()
  
  useEffect(() => {
    const now = Date.now()
    if (!lastUpdated.current || now >= lastUpdated.current + interval) {
      lastUpdated.current = now
      setThrottledValue(value)
    } else {
      const id = setTimeout(() => {
        lastUpdated.current = now
        setThrottledValue(value)
      }, interval - (now - lastUpdated.current))
      return () => clearTimeout(id)
    }
  }, [value, interval])
  
  return throttledValue
}

// 使用
const searchTerm = useDebounce(inputValue, 300)
const scrollPos = useThrottle(scrollY, 100)
```

## 网络优化

### 8. 请求优化

```typescript
// 请求合并
const useBatchedQueries = (ids: string[]) => {
  return useQuery({
    queryKey: ['items', ids],
    queryFn: () => api.getItemsByIds(ids), // 单次请求代替多次
  })
}

// 请求去重
const fetchWithDedup = (() => {
  const cache = new Map<string, Promise<any>>()
  
  return (url: string) => {
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then(r => r.json()))
      cache.delete(url) // 清理
    }
    return cache.get(url)
  }
})()

// 乐观更新
const mutation = useMutation({
  mutationFn: updateItem,
  onMutate: async (newData) => {
    await queryClient.cancelQueries(['item', id])
    const previous = queryClient.getQueryData(['item', id])
    queryClient.setQueryData(['item', id], newData)
    return { previous }
  },
  onError: (err, newData, context) => {
    queryClient.setQueryData(['item', id], context.previous)
  },
})
```

### 9. 缓存策略

```typescript
// React Query 缓存配置
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 分钟
      cacheTime: 10 * 60 * 1000, // 10 分钟
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Service Worker 缓存
// workbox-config.js
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{js,css,html,png,jpg}'],
  swDest: 'sw.js',
  runtimeCaching: [{
    urlPattern: /^https:\/\/api\.example\.com\//,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'api-cache',
      expiration: {
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24, // 1 天
      },
    },
  }],
}
```

## 内存优化

### 10. 内存泄漏预防

```typescript
// 清理事件监听器
useEffect(() => {
  const handleResize = () => {}
  window.addEventListener('resize', handleResize)
  return () => window.removeEventListener('resize', handleResize)
}, [])

// 清除定时器
useEffect(() => {
  const timer = setInterval(() => {}, 1000)
  return () => clearInterval(timer)
}, [])

// 取消异步请求
useEffect(() => {
  const controller = new AbortController()
  
  fetch('/api/data', { signal: controller.signal })
    .then(res => res.json())
    .catch(err => {
      if (err.name !== 'AbortError') throw err
    })
  
  return () => controller.abort()
}, [])

// 清理订阅
useEffect(() => {
  const subscription = store.subscribe(handleChange)
  return () => subscription.unsubscribe()
}, [])
```

## 性能监控

### 11. 性能指标收集

```typescript
// Web Vitals 监控
import { onLCP, onFID, onCLS, onINP } from 'web-vitals'

onLCP(metric => sendToAnalytics(metric))
onFID(metric => sendToAnalytics(metric))
onCLS(metric => sendToAnalytics(metric))
onINP(metric => sendToAnalytics(metric))

// 自定义性能标记
performance.mark('app-start')
// ... 初始化代码
performance.mark('app-ready')
performance.measure('app-init', 'app-start', 'app-ready')

// 监听长任务
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) {
      console.log('Long task detected:', entry.duration)
    }
  }
})
observer.observe({ entryTypes: ['longtask'] })
```

### 12. 性能预算

```javascript
// package.json
{
  "performance": {
    "budget": {
      "scripts": {
        "size": 200000,
        "limit": 250000
      },
      "styles": {
        "size": 50000,
        "limit": 75000
      },
      "images": {
        "size": 500000,
        "limit": 750000
      },
      "total": {
        "size": 1000000,
        "limit": 1500000
      }
    }
  }
}
```

## 构建优化

### Vite 配置优化

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['antd', '@ant-design/icons'],
        },
      },
    },
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false, // 生产环境关闭
  },
  esbuild: {
    drop: ['console', 'debugger'], // 生产环境移除
  },
})
```

## 性能检查清单

### 加载性能
- [ ] 启用 gzip/brotli 压缩
- [ ] 启用 HTTP/2 或 HTTP/3
- [ ] 使用 CDN 分发静态资源
- [ ] 图片使用 WebP/AVIF 格式
- [ ] 实现懒加载
- [ ] 预加载关键资源

### 渲染性能
- [ ] 避免内联对象/函数作为 props
- [ ] 使用 React.memo 优化组件
- [ ] 实现虚拟列表
- [ ] 避免大型组件树
- [ ] 使用 CSS containment

### 网络性能
- [ ] 最小化请求数量
- [ ] 实现请求缓存
- [ ] 使用 HTTP 缓存头
- [ ] 压缩 API 响应
- [ ] 实现离线支持

### 监控
- [ ] 收集 Core Web Vitals
- [ ] 设置性能预算
- [ ] 监控错误率
- [ ] 追踪用户交互
- [ ] 建立性能基线

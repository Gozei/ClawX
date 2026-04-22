#!/usr/bin/env python3
"""
前端项目脚手架生成器
快速创建 React/Vue/Angular 项目
"""

import argparse
import json
import os
from pathlib import Path


def create_react_vite_ts(project_name: str, output_dir: str):
    """创建 React + Vite + TypeScript 项目"""
    
    project_path = Path(output_dir) / project_name
    project_path.mkdir(parents=True, exist_ok=True)
    
    # package.json
    package_json = {
        "name": project_name,
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "tsc && vite build",
            "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
            "preview": "vite preview",
            "test": "vitest",
            "test:ui": "vitest --ui"
        },
        "dependencies": {
            "react": "^18.2.0",
            "react-dom": "^18.2.0"
        },
        "devDependencies": {
            "@types/react": "^18.2.43",
            "@types/react-dom": "^18.2.17",
            "@typescript-eslint/eslint-plugin": "^6.14.0",
            "@typescript-eslint/parser": "^6.14.0",
            "@vitejs/plugin-react": "^4.2.1",
            "eslint": "^8.55.0",
            "eslint-plugin-react-hooks": "^4.6.0",
            "eslint-plugin-react-refresh": "^0.4.5",
            "typescript": "^5.2.2",
            "vite": "^5.0.8",
            "vitest": "^1.1.0",
            "@testing-library/react": "^14.1.2",
            "@testing-library/jest-dom": "^6.1.5"
        }
    }
    
    # tsconfig.json
    tsconfig = {
        "compilerOptions": {
            "target": "ES2020",
            "useDefineForClassFields": True,
            "lib": ["ES2020", "DOM", "DOM.Iterable"],
            "module": "ESNext",
            "skipLibCheck": True,
            "moduleResolution": "bundler",
            "allowImportingTsExtensions": True,
            "resolveJsonModule": True,
            "isolatedModules": True,
            "noEmit": True,
            "jsx": "react-jsx",
            "strict": True,
            "noUnusedLocals": True,
            "noUnusedParameters": True,
            "noFallthroughCasesInSwitch": True,
            "baseUrl": ".",
            "paths": {
                "@/*": ["src/*"]
            }
        },
        "include": ["src"],
        "references": [{"path": "./tsconfig.node.json"}]
    }
    
    # vite.config.ts
    vite_config = '''import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
'''
    
    # 目录结构
    (project_path / 'src' / 'components').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'hooks').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'utils').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'types').mkdir(parents=True, exist_ok=True)
    (project_path / 'public').mkdir(parents=True, exist_ok=True)
    
    # 主入口文件
    main_tsx = '''import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
'''
    
    # App 组件
    app_tsx = '''import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div className="app">
        <h1>Vite + React + TypeScript</h1>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
      </div>
    </>
  )
}

export default App
'''
    
    # 基础样式
    index_css = '''* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
'''
    
    app_css = '''.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.card {
  padding: 2em;
  background: #f9f9f9;
  border-radius: 8px;
  margin-top: 1rem;
}

button {
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  cursor: pointer;
  background: #646cff;
  color: white;
  border: none;
  border-radius: 8px;
  transition: background 0.25s;
}

button:hover {
  background: #535bf2;
}
'''
    
    # 写入文件
    (project_path / 'package.json').write_text(json.dumps(package_json, indent=2), encoding='utf-8')
    (project_path / 'tsconfig.json').write_text(json.dumps(tsconfig, indent=2), encoding='utf-8')
    (project_path / 'vite.config.ts').write_text(vite_config, encoding='utf-8')
    (project_path / 'src' / 'main.tsx').write_text(main_tsx, encoding='utf-8')
    (project_path / 'src' / 'App.tsx').write_text(app_tsx, encoding='utf-8')
    (project_path / 'src' / 'index.css').write_text(index_css, encoding='utf-8')
    (project_path / 'src' / 'App.css').write_text(app_css, encoding='utf-8')
    
    # .gitignore
    gitignore = '''node_modules
dist
.env
.env.local
*.log
.DS_Store
coverage
'''
    (project_path / '.gitignore').write_text(gitignore, encoding='utf-8')
    
    return project_path


def create_vue_vite_ts(project_name: str, output_dir: str):
    """创建 Vue 3 + Vite + TypeScript 项目"""
    
    project_path = Path(output_dir) / project_name
    project_path.mkdir(parents=True, exist_ok=True)
    
    package_json = {
        "name": project_name,
        "private": True,
        "version": "0.0.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "vue-tsc && vite build",
            "preview": "vite preview",
            "test": "vitest",
            "lint": "eslint . --ext .vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts"
        },
        "dependencies": {
            "vue": "^3.3.11",
            "pinia": "^2.1.7",
            "vue-router": "^4.2.5"
        },
        "devDependencies": {
            "@vitejs/plugin-vue": "^4.5.2",
            "typescript": "^5.2.2",
            "vite": "^5.0.8",
            "vue-tsc": "^1.8.25",
            "vitest": "^1.1.0",
            "@vue/test-utils": "^2.4.3"
        }
    }
    
    (project_path / 'package.json').write_text(json.dumps(package_json, indent=2), encoding='utf-8')
    
    return project_path


def create_nextjs_app(project_name: str, output_dir: str):
    """创建 Next.js 14 App Router 项目"""
    
    project_path = Path(output_dir) / project_name
    project_path.mkdir(parents=True, exist_ok=True)
    
    package_json = {
        "name": project_name,
        "private": True,
        "scripts": {
            "dev": "next dev",
            "build": "next build",
            "start": "next start",
            "lint": "next lint",
            "test": "jest",
            "test:e2e": "playwright test"
        },
        "dependencies": {
            "next": "^14.0.4",
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            "@tanstack/react-query": "^5.14.0",
            "zod": "^3.22.4"
        },
        "devDependencies": {
            "@types/node": "^20.10.0",
            "@types/react": "^18.2.43",
            "@types/react-dom": "^18.2.17",
            "typescript": "^5.3.2",
            "eslint": "^8.55.0",
            "eslint-config-next": "^14.0.4",
            "@testing-library/react": "^14.1.2",
            "jest": "^29.7.0",
            "@playwright/test": "^1.40.0"
        }
    }
    
    # next.config.js
    next_config = '''/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
}

module.exports = nextConfig
'''
    
    # tsconfig.json
    tsconfig = {
        "compilerOptions": {
            "target": "ES2017",
            "lib": ["dom", "dom.iterable", "esnext"],
            "allowJs": True,
            "skipLibCheck": True,
            "strict": True,
            "noEmit": True,
            "esModuleInterop": True,
            "module": "esnext",
            "moduleResolution": "bundler",
            "resolveJsonModule": True,
            "isolatedModules": True,
            "jsx": "preserve",
            "incremental": True,
            "plugins": [{"name": "next"}],
            "paths": {
                "@/*": ["./src/*"]
            }
        },
        "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        "exclude": ["node_modules"]
    }
    
    # 目录结构
    (project_path / 'src' / 'app').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'components').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'lib').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'hooks').mkdir(parents=True, exist_ok=True)
    (project_path / 'src' / 'types').mkdir(parents=True, exist_ok=True)
    (project_path / 'public').mkdir(parents=True, exist_ok=True)
    
    # 基础页面
    layout_tsx = '''import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '{name}',
  description: 'Generated by create next app',
}

export default function RootLayout({{
  children,
}}: {{
  children: React.ReactNode
}}) {{
  return (
    <html lang="en">
      <body className={{inter.className}}>{{children}}</body>
    </html>
  )
}}
'''.format(name=project_name)
    
    page_tsx = '''export default function Home() {{
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <h1 className="text-4xl font-bold">Welcome to Next.js 14</h1>
    </main>
  )
}}
'''
    
    globals_css = '''@tailwind base;
@tailwind components;
@tailwind utilities;

:root {{
  --foreground-rgb: 0, 0, 0;
  --background-start-rgb: 214, 219, 220;
  --background-end-rgb: 255, 255, 255;
}}

body {{
  color: rgb(var(--foreground-rgb));
  background: linear-gradient(
      to bottom,
      transparent,
      rgb(var(--background-end-rgb))
    )
    rgb(var(--background-start-rgb));
}}
'''
    
    tailwind_config = '''/** @type {import('tailwindcss').Config} */
module.exports = {{
  content: [
    './src/pages/**/*{{js,ts,jsx,tsx,mdx}}',
    './src/components/**/*{{js,ts,jsx,tsx,mdx}}',
    './src/app/**/*{{js,ts,jsx,tsx,mdx}}',
  ],
  theme: {{
    extend: {{}},
  }},
  plugins: [],
}}
'''
    
    # 写入文件
    (project_path / 'package.json').write_text(json.dumps(package_json, indent=2), encoding='utf-8')
    (project_path / 'next.config.js').write_text(next_config, encoding='utf-8')
    (project_path / 'tsconfig.json').write_text(json.dumps(tsconfig, indent=2), encoding='utf-8')
    (project_path / 'src' / 'app' / 'layout.tsx').write_text(layout_tsx, encoding='utf-8')
    (project_path / 'src' / 'app' / 'page.tsx').write_text(page_tsx, encoding='utf-8')
    (project_path / 'src' / 'app' / 'globals.css').write_text(globals_css, encoding='utf-8')
    (project_path / 'tailwind.config.js').write_text(tailwind_config, encoding='utf-8')
    
    # .gitignore
    gitignore = '''.next
node_modules
.env
.env.local
*.log
.DS_Store
coverage
'''
    (project_path / '.gitignore').write_text(gitignore, encoding='utf-8')
    
    return project_path


def main():
    parser = argparse.ArgumentParser(description='前端项目脚手架生成器')
    parser.add_argument('--framework', choices=['react', 'vue', 'nextjs', 'nuxt'], required=True, help='框架类型')
    parser.add_argument('--name', required=True, help='项目名称')
    parser.add_argument('--build', choices=['vite', 'webpack', 'next', 'nuxt'], default='vite', help='构建工具')
    parser.add_argument('--output', default='.', help='输出目录')
    
    args = parser.parse_args()
    
    if args.framework == 'react' and args.build == 'vite':
        project_path = create_react_vite_ts(args.name, args.output)
    elif args.framework == 'vue' and args.build == 'vite':
        project_path = create_vue_vite_ts(args.name, args.output)
    elif args.framework == 'nextjs':
        project_path = create_nextjs_app(args.name, args.output)
    elif args.framework == 'nuxt':
        print(f"暂不支持 {args.framework} 项目生成")
        return
    else:
        print(f"暂不支持 {args.framework} + {args.build} 组合")
        return
    
    print(f"✅ 项目已创建：{project_path}")
    print(f"\n下一步:")
    print(f"  cd {project_path}")
    print(f"  npm install")
    print(f"  npm run dev")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
前端组件生成器
支持 React/Vue/Angular 组件模板生成
"""

import argparse
import os
from pathlib import Path
from datetime import datetime

# React 组件模板
REACT_COMPONENT_TEMPLATE = '''import React, {{ {isFunctional} }} from 'react';
import './{name}.module.css';

interface {name}Props {{
{props}
}}

export const {name}: React.FC<{name}Props> = ({ propsDestructure }) => {{
{body}
}};
'''

REACT_COMPONENT_BODY = '''  return (
    <div className="{name}-container">
      {/* TODO: Implement component content */}
    </div>
  );
'''

# Vue 组件模板
VUE_COMPONENT_TEMPLATE = '''<template>
  <div class="{name}-container">
    <!-- TODO: Implement component content -->
  </div>
</template>

<script setup lang="ts">
interface {name}Props {{
{props}
}}

const props = defineProps<{name}Props>()
</script>

<style module>
.container {{
  /* TODO: Add styles */
}}
</style>
'''

# TypeScript 类型模板
TYPES_TEMPLATE = '''export interface {name}Props {{
{props}
}}

export type {name}Ref = HTMLDivElement;
'''

# CSS Module 模板
CSS_MODULE_TEMPLATE = '''.container {{
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}}
'''

# Test 模板
TEST_TEMPLATE = '''import {{ render, screen }} from '@testing-library/react';
import {{ describe, it, expect }} from 'vitest';
import {{ {name} }} from '../{name}';

describe('{name}', () => {{
  it('renders correctly', () => {{
    render(<{name} />);
    expect(screen.getByTestId('{name}-container')).toBeInTheDocument();
  }});
  
  it('accepts props correctly', () => {{
{propTests}
  }});
}});
'''

PROP_TEST_TEMPLATE = '''    render(<{name} {propRender} />);
    expect(screen.getByText(/test value/i)).toBeInTheDocument();'''


def parse_props(props_str: str) -> list:
    """解析 props 字符串为列表"""
    if not props_str:
        return []
    
    props = []
    for prop in props_str.split(','):
        prop = prop.strip()
        if ':' in prop:
            name, type_ = prop.split(':', 1)
            props.append({'name': name.strip(), 'type': type_.strip()})
    return props


def generate_react_component(name: str, props: list, output_dir: str):
    """生成 React 组件"""
    props_interface = '\n'.join([f"  {p['name']}: {p['type']};" for p in props]) if props else '  // Add props here'
    props_destructure = ', '.join([p['name'] for p in props]) if props else ''
    
    component_content = REACT_COMPONENT_TEMPLATE.format(
        isFunctional='FC' if props else '',
        name=name,
        props=props_interface,
        propsDestructure=props_destructure,
        body=REACT_COMPONENT_BODY.format(name=name)
    )
    
    types_content = TYPES_TEMPLATE.format(
        name=name,
        props=props_interface
    )
    
    css_content = CSS_MODULE_TEMPLATE.format(name=name.lower())
    
    # 生成 props 测试
    prop_tests = []
    for prop in props[:3]:  # 只为前 3 个 props 生成测试
        if prop['type'] == 'string':
            prop_tests.append(f"    render(<{name} {prop['name']}=\"test value\" />);")
            prop_tests.append(f"    expect(screen.getByText(/test value/i)).toBeInTheDocument();")
        elif prop['type'] == 'function':
            prop_tests.append(f"    const mockFn = vi.fn();")
            prop_tests.append(f"    render(<{name} {prop['name']}={{mockFn}} />);")
            prop_tests.append(f"    const button = screen.getByRole('button');")
            prop_tests.append(f"    if (button) fireEvent.click(button);")
            prop_tests.append(f"    expect(mockFn).toHaveBeenCalledTimes(1);")
    
    prop_tests_str = '\n'.join(prop_tests) if prop_tests else '    // Add prop tests here'
    test_content = TEST_TEMPLATE.format(name=name, propTests=prop_tests_str)
    
    # 创建目录
    comp_dir = Path(output_dir) / name
    comp_dir.mkdir(parents=True, exist_ok=True)
    
    # 写入文件
    (comp_dir / f'{name}.tsx').write_text(component_content, encoding='utf-8')
    (comp_dir / f'{name}.types.ts').write_text(types_content, encoding='utf-8')
    (comp_dir / f'{name}.module.css').write_text(css_content, encoding='utf-8')
    (comp_dir / f'{name}.test.tsx').write_text(test_content, encoding='utf-8')
    (comp_dir / 'index.ts').write_text(f"export {{ {name} }} from './{name}';\n", encoding='utf-8')
    
    return comp_dir


def generate_vue_component(name: str, props: list, output_dir: str):
    """生成 Vue 组件"""
    props_interface = '\n'.join([f"  {p['name']}: {p['type']};" for p in props]) if props else '  // Add props here'
    
    component_content = VUE_COMPONENT_TEMPLATE.format(
        name=name,
        props=props_interface
    )
    
    comp_dir = Path(output_dir) / name
    comp_dir.mkdir(parents=True, exist_ok=True)
    
    (comp_dir / f'{name}.vue').write_text(component_content, encoding='utf-8')
    
    return comp_dir


def main():
    parser = argparse.ArgumentParser(description='前端组件生成器')
    parser.add_argument('--type', choices=['react', 'vue', 'angular'], required=True, help='组件类型')
    parser.add_argument('--name', required=True, help='组件名称（PascalCase）')
    parser.add_argument('--props', default='', help='Props 定义，格式：name:type,name2:type2')
    parser.add_argument('--output', default='./src/components', help='输出目录')
    
    args = parser.parse_args()
    
    props = parse_props(args.props)
    
    if args.type == 'react':
        output_path = generate_react_component(args.name, props, args.output)
    elif args.type == 'vue':
        output_path = generate_vue_component(args.name, props, args.output)
    else:
        print(f"暂不支持 {args.type} 组件生成")
        return
    
    print(f"✅ 组件已生成：{output_path}")
    print(f"   - {output_path}/{args.name}.{args.type == 'react' and 'tsx' or 'vue'}")
    print(f"   - {output_path}/{args.name}.types.ts")
    print(f"   - {output_path}/{args.name}.module.css")
    print(f"   - {output_path}/{args.name}.test.tsx")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
前端代码审查工具
检查代码质量、性能问题、安全隐患
"""

import argparse
import re
from pathlib import Path
from typing import List, Dict


class CodeReviewer:
    """代码审查器"""
    
    def __init__(self, strict: bool = False):
        self.strict = strict
        self.issues = []
    
    def review_file(self, filepath: str) -> List[Dict]:
        """审查单个文件"""
        path = Path(filepath)
        if not path.exists():
            return [{'error': f'文件不存在：{filepath}'}]
        
        content = path.read_text(encoding='utf-8')
        ext = path.suffix.lower()
        
        self.issues = []
        
        if ext in ['.ts', '.tsx', '.js', '.jsx']:
            self._check_typescript(content, filepath)
            self._check_performance(content, filepath)
            self._check_security(content, filepath)
            self._check_best_practices(content, filepath)
        elif ext in ['.vue']:
            self._check_vue(content, filepath)
        elif ext in ['.css', '.scss', '.module.css']:
            self._check_styles(content, filepath)
        
        return self.issues
    
    def _check_typescript(self, content: str, filepath: str):
        """TypeScript 检查"""
        # 检查 any 类型
        if re.search(r':\s*any\b', content):
            self.issues.append({
                'type': 'warning',
                'rule': 'no-explicit-any',
                'message': '避免使用 any 类型，使用 unknown 或具体类型',
                'file': filepath
            })
        
        # 检查缺少返回类型
        if re.search(r'function\s+\w+\s*\([^)]*\)\s*{', content):
            self.issues.append({
                'type': 'info',
                'rule': 'explicit-function-return-type',
                'message': '建议为函数添加返回类型注解',
                'file': filepath
            })
        
        # 检查未使用的变量
        if re.search(r'const\s+_\w+\s*=', content):
            self.issues.append({
                'type': 'info',
                'rule': 'no-unused-vars',
                'message': '发现以下划线开头的未使用变量',
                'file': filepath
            })
        
        # 检查 console.log
        if 'console.log' in content:
            self.issues.append({
                'type': 'warning' if self.strict else 'info',
                'rule': 'no-console',
                'message': '生产代码应移除 console.log',
                'file': filepath
            })
        
        # 检查 TODO/FIXME
        if re.search(r'(TODO|FIXME|XXX)', content, re.IGNORECASE):
            self.issues.append({
                'type': 'info',
                'rule': 'no-todo',
                'message': '发现待办注释，建议及时清理',
                'file': filepath
            })
    
    def _check_performance(self, content: str, filepath: str):
        """性能检查"""
        # 检查 useEffect 缺少依赖
        if re.search(r'useEffect\s*\(\s*\(\)\s*=>\s*{[^}]*}\s*\)', content):
            self.issues.append({
                'type': 'warning',
                'rule': 'react-hooks/exhaustive-deps',
                'message': 'useEffect 可能缺少依赖数组',
                'file': filepath
            })
        
        # 检查内联对象/函数作为 props
        if re.search(r'<\w+[^>]*\w+=\{[^}]*\}', content):
            self.issues.append({
                'type': 'info',
                'rule': 'react-no-inline-objects',
                'message': '避免在 JSX 中创建内联对象/函数，可能导致不必要的重渲染',
                'file': filepath
            })
        
        # 检查数组索引作为 key
        if re.search(r'key=\{?index\}?', content):
            self.issues.append({
                'type': 'warning',
                'rule': 'react-no-array-index-key',
                'message': '避免使用数组索引作为 key',
                'file': filepath
            })
    
    def _check_security(self, content: str, filepath: str):
        """安全检查"""
        # 检查 dangerouslySetInnerHTML
        if 'dangerouslySetInnerHTML' in content:
            self.issues.append({
                'type': 'error',
                'rule': 'security-no-dangerous-html',
                'message': 'dangerouslySetInnerHTML 有 XSS 风险，确保内容已净化',
                'file': filepath
            })
        
        # 检查 eval
        if re.search(r'\beval\s*\(', content):
            self.issues.append({
                'type': 'error',
                'rule': 'security-no-eval',
                'message': '禁止使用 eval()',
                'file': filepath
            })
        
        # 检查硬编码密钥
        if re.search(r'(api[_-]?key|secret|token|password)\s*[=:]\s*["\'][^"\']{8,}["\']', content, re.IGNORECASE):
            self.issues.append({
                'type': 'error',
                'rule': 'security-no-hardcoded-secrets',
                'message': '发现硬编码的密钥/密码，应使用环境变量',
                'file': filepath
            })
    
    def _check_best_practices(self, content: str, filepath: str):
        """最佳实践检查"""
        # 检查组件命名
        if re.search(r'(const|function)\s+([a-z]\w*)\s*[:=]?\s*\(.*\).*[:{]', content):
            match = re.search(r'(const|function)\s+([a-z]\w*)', content)
            if match:
                comp_name = match.group(2)
                if comp_name[0].islower() and comp_name not in ['props', 'state', 'context']:
                    self.issues.append({
                        'type': 'info',
                        'rule': 'react-component-name',
                        'message': f'组件名 "{comp_name}" 应使用 PascalCase',
                        'file': filepath
                    })
        
        # 检查文件长度
        lines = content.split('\n')
        if len(lines) > 500:
            self.issues.append({
                'type': 'warning',
                'rule': 'max-file-length',
                'message': f'文件过长 ({len(lines)} 行)，建议拆分',
                'file': filepath
            })
        
        # 检查函数长度
        func_matches = re.findall(r'function\s+\w+\s*\([^)]*\)\s*{([^}]*)}', content, re.DOTALL)
        for func_body in func_matches:
            func_lines = func_body.split('\n')
            if len(func_lines) > 50:
                self.issues.append({
                    'type': 'info',
                    'rule': 'max-function-length',
                    'message': f'函数过长 ({len(func_lines)} 行)，建议拆分',
                    'file': filepath
                })
    
    def _check_vue(self, content: str, filepath: str):
        """Vue 组件检查"""
        # 检查是否使用 Composition API
        if '<script>' in content and '<script setup>' not in content:
            self.issues.append({
                'type': 'info',
                'rule': 'vue-prefer-setup',
                'message': '建议使用 <script setup> 语法',
                'file': filepath
            })
        
        # 检查 v-if 和 v-for 同元素
        if re.search(r'v-for=[^>]*v-if=', content):
            self.issues.append({
                'type': 'warning',
                'rule': 'vue-no-v-if-v-for',
                'message': '避免 v-if 和 v-for 在同一元素上',
                'file': filepath
            })
    
    def _check_styles(self, content: str, filepath: str):
        """样式检查"""
        # 检查 !important
        if '!important' in content:
            self.issues.append({
                'type': 'warning',
                'rule': 'no-important',
                'message': '避免使用 !important',
                'file': filepath
            })
        
        # 检查硬编码颜色
        if re.search(r'#[0-9a-fA-F]{3,6}', content):
            self.issues.append({
                'type': 'info',
                'rule': 'use-css-variables',
                'message': '建议使用 CSS 变量代替硬编码颜色',
                'file': filepath
            })


def format_report(issues: List[Dict], filepath: str) -> str:
    """格式化审查报告"""
    if not issues:
        return f"✅ {filepath}: 没有发现问题"
    
    report = [f"📋 代码审查报告：{filepath}\n"]
    
    # 按严重程度排序
    severity_order = {'error': 0, 'warning': 1, 'info': 2}
    sorted_issues = sorted(issues, key=lambda x: severity_order.get(x['type'], 3))
    
    for issue in sorted_issues:
        icon = {'error': '❌', 'warning': '⚠️', 'info': 'ℹ️'}.get(issue['type'], '•')
        report.append(f"{icon} [{issue['type'].upper()}] {issue['rule']}")
        report.append(f"   {issue['message']}")
        report.append("")
    
    # 统计
    errors = len([i for i in issues if i['type'] == 'error'])
    warnings = len([i for i in issues if i['type'] == 'warning'])
    infos = len([i for i in issues if i['type'] == 'info'])
    
    report.append(f"总计：{errors} 错误，{warnings} 警告，{infos} 建议")
    
    return '\n'.join(report)


def main():
    parser = argparse.ArgumentParser(description='前端代码审查工具')
    parser.add_argument('--file', required=True, help='要审查的文件')
    parser.add_argument('--strict', action='store_true', help='严格模式')
    parser.add_argument('--output', choices=['console', 'json'], default='console', help='输出格式')
    
    args = parser.parse_args()
    
    reviewer = CodeReviewer(strict=args.strict)
    issues = reviewer.review_file(args.file)
    
    print(format_report(issues, args.file))


if __name__ == '__main__':
    main()

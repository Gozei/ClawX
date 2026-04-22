#!/usr/bin/env python3
"""
前端开发工具 - 对话集成版本
支持通过自然语言调用各种前端工具
"""

import argparse
import json
import sys
from pathlib import Path

# 导入其他工具模块
from component_generator import generate_react_component, generate_vue_component, parse_props
from project_scaffold import create_react_vite_ts, create_vue_vite_ts, create_nextjs_app
from code_reviewer import CodeReviewer, format_report
from dependency_checker import get_package_json, check_outdated, check_audit


def parse_component_request(text: str) -> dict:
    """解析组件生成请求"""
    result = {
        'type': 'react',  # 默认
        'name': '',
        'props': [],
        'output': './src/components'
    }
    
    # 检测框架
    text_lower = text.lower()
    if 'vue' in text_lower:
        result['type'] = 'vue'
    elif 'react' in text_lower:
        result['type'] = 'react'
    
    # 提取组件名（查找大写字母开头的单词）
    import re
    name_matches = re.findall(r'\b([A-Z][a-zA-Z]+)\b', text)
    if name_matches:
        result['name'] = name_matches[0]
    
    # 提取 props
    prop_patterns = [
        r'显示 ([\u4e00-\u9fa5]+)',  # 中文描述
        r'支持 ([\u4e00-\u9fa5]+)',
        r'有 ([\u4e00-\u9fa5]+)',
        r'带 ([\u4e00-\u9fa5]+)',
    ]
    
    props_map = {
        '姓名': ('name', 'string'),
        '名字': ('name', 'string'),
        '邮箱': ('email', 'string'),
        '邮件': ('email', 'string'),
        '头像': ('avatar', 'string'),
        '年龄': ('age', 'number'),
        '电话': ('phone', 'string'),
        '标题': ('title', 'string'),
        '内容': ('content', 'string'),
        '描述': ('description', 'string'),
        '编辑': ('onEdit', 'function'),
        '删除': ('onDelete', 'function'),
        '保存': ('onSave', 'function'),
        '取消': ('onCancel', 'function'),
        '点击': ('onClick', 'function'),
        '按钮': ('onClick', 'function'),
        '加载': ('loading', 'boolean'),
        '禁用': ('disabled', 'boolean'),
    }
    
    for pattern in prop_patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            if match in props_map:
                prop_name, prop_type = props_map[match]
                if prop_name not in [p['name'] for p in result['props']]:
                    result['props'].append({'name': prop_name, 'type': prop_type})
    
    return result


def handle_component_generation(request: dict) -> str:
    """处理组件生成请求"""
    if not request['name']:
        return "❌ 请提供组件名称"
    
    output_dir = Path(request['output'])
    output_dir.mkdir(parents=True, exist_ok=True)
    
    if request['type'] == 'react':
        output_path = generate_react_component(
            request['name'], 
            request['props'], 
            str(output_dir)
        )
    elif request['type'] == 'vue':
        output_path = generate_vue_component(
            request['name'],
            request['props'],
            str(output_dir)
        )
    else:
        return f"❌ 暂不支持 {request['type']} 组件生成"
    
    # 生成文件列表
    files = list(output_path.glob('*'))
    files_str = '\n'.join([f"  - {f.name}" for f in files])
    
    return f"""✅ 组件已生成：{output_path}

📁 生成的文件:
{files_str}

📝 组件信息:
  - 类型：{request['type'].upper()}
  - 名称：{request['name']}
  - Props: {len(request['props'])} 个
    {chr(10).join([f"    • {p['name']}: {p['type']}" for p in request['props']]) if request['props'] else '    (无)'}

💡 下一步:
  1. 在 {output_path}/{request['name']}.tsx 中实现组件逻辑
  2. 运行测试：npm test -- {request['name']}
  3. 在页面中导入使用
"""


def handle_code_review(code: str, strict: bool = False) -> str:
    """处理代码审查请求"""
    if not code.strip():
        return "❌ 请提供要审查的代码"
    
    # 写入临时文件
    temp_file = Path('/tmp/review_temp.tsx')
    temp_file.write_text(code, encoding='utf-8')
    
    reviewer = CodeReviewer(strict=strict)
    issues = reviewer.review_file(str(temp_file))
    
    # 清理临时文件
    temp_file.unlink()
    
    if not issues:
        return "✅ 代码审查通过！没有发现问题。\n\n👍 代码质量很好，符合最佳实践。"
    
    report = format_report(issues, '代码片段')
    
    # 添加修复建议
    suggestions = []
    for issue in issues:
        if issue['rule'] == 'no-explicit-any':
            suggestions.append("💡 将 `any` 替换为具体类型或 `unknown`")
        elif issue['rule'] == 'react-no-array-index-key':
            suggestions.append("💡 使用唯一 ID 作为 key，如 `item.id`")
        elif issue['rule'] == 'security-no-dangerous-html':
            suggestions.append("💡 使用 DOMPurify.sanitize() 净化 HTML 内容")
        elif issue['rule'] == 'no-console':
            suggestions.append("💡 使用日志工具替代 console.log，或在生产环境移除")
    
    if suggestions:
        report += "\n\n🔧 修复建议:\n" + '\n'.join([f"  {s}" for s in set(suggestions)])
    
    return report


def handle_project_creation(request: dict) -> str:
    """处理项目创建请求"""
    framework = request.get('framework', 'react')
    name = request.get('name', 'my-app')
    output_dir = request.get('output', '.')
    
    output_path = None
    
    if framework == 'react':
        output_path = create_react_vite_ts(name, output_dir)
    elif framework == 'vue':
        output_path = create_vue_vite_ts(name, output_dir)
    elif framework == 'nextjs' or framework == 'next':
        output_path = create_nextjs_app(name, output_dir)
    else:
        return f"❌ 暂不支持 {framework} 框架"
    
    # 获取项目结构
    structure = []
    for item in output_path.rglob('*'):
        if item.is_file() and 'node_modules' not in str(item):
            rel_path = item.relative_to(output_path)
            if len(rel_path.parts) <= 3:  # 只显示前 3 层
                structure.append(f"  {'  ' * (len(rel_path.parts) - 1)}├── {rel_path.name}")
    
    return f"""✅ 项目已创建：{output_path}

📁 项目结构:
{chr(10).join(structure[:15])}
{'  ...' if len(structure) > 15 else ''}

⚙️ 技术栈:
  - 框架：{framework.upper()}
  - 语言：TypeScript
  - 构建：{framework == 'nextjs' and 'Next.js Build' or 'Vite'}
  - 测试：Vitest + Testing Library

🚀 下一步:
  cd {output_path}
  npm install
  npm run dev

📦 可用命令:
  npm run dev      - 开发服务器
  npm run build    - 生产构建
  npm run test     - 运行测试
  npm run lint     - 代码检查
"""


def handle_dependency_check(project_path: str = '.') -> str:
    """处理依赖检查请求"""
    package = get_package_json()
    if not package:
        return f"❌ 在 {project_path} 未找到 package.json"
    
    outdated = check_outdated()
    vulnerabilities = check_audit()
    
    report = ["📦 依赖检查报告\n"]
    
    # 过时依赖
    if outdated:
        report.append(f"⚠️  发现 {len(outdated)} 个过时的依赖:")
        for pkg, info in list(outdated.items())[:5]:  # 只显示前 5 个
            current = info.get('current', '?')
            latest = info.get('latest', '?')
            report.append(f"  - {pkg}: {current} → {latest}")
        if len(outdated) > 5:
            report.append(f"  ... 还有 {len(outdated) - 5} 个")
        report.append("")
    else:
        report.append("✅ 所有依赖都是最新版本\n")
    
    # 安全漏洞
    if vulnerabilities:
        total = sum(vulnerabilities.values())
        report.append(f"❌ 发现 {total} 个安全漏洞:")
        for level in ['critical', 'high', 'moderate', 'low']:
            count = vulnerabilities.get(level, 0)
            if count > 0:
                icon = {'critical': '🔴', 'high': '🟠', 'moderate': '🟡', 'low': '🔵'}[level]
                report.append(f"  {icon} {level.upper()}: {count}")
        report.append("\n💡 运行 `npm audit fix` 修复自动可修复的漏洞")
    else:
        report.append("✅ 没有发现安全漏洞\n")
    
    return '\n'.join(report)


def main():
    """主函数 - 支持命令行和对话两种模式"""
    parser = argparse.ArgumentParser(description='前端开发工具 - 对话集成版本')
    parser.add_argument('--action', choices=['component', 'review', 'project', 'deps'], 
                       help='操作类型')
    parser.add_argument('--input', type=str, help='输入内容（代码或自然语言描述）')
    parser.add_argument('--config', type=str, help='JSON 配置文件路径')
    parser.add_argument('--strict', action='store_true', help='严格模式')
    
    args = parser.parse_args()
    
    # 对话模式：从自然语言解析
    if args.action == 'component' and args.input:
        request = parse_component_request(args.input)
        print(handle_component_generation(request))
    
    elif args.action == 'review' and args.input:
        print(handle_code_review(args.input, args.strict))
    
    elif args.action == 'project':
        # 从 JSON 配置读取
        if args.config:
            with open(args.config, 'r', encoding='utf-8') as f:
                config = json.load(f)
            print(handle_project_creation(config))
        else:
            print("❌ 项目创建需要提供 --config 参数")
    
    elif args.action == 'deps':
        print(handle_dependency_check(args.input or '.'))
    
    else:
        print(__doc__)


if __name__ == '__main__':
    main()

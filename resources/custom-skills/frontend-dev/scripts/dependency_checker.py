#!/usr/bin/env python3
"""
依赖检查工具
检查项目依赖的安全性、更新情况
"""

import json
import subprocess
import sys
from pathlib import Path


def get_package_json() -> dict | None:
    """获取 package.json 内容"""
    package_path = Path('package.json')
    if not package_path.exists():
        return None
    return json.loads(package_path.read_text(encoding='utf-8'))


def check_outdated() -> list:
    """检查过时的依赖"""
    try:
        result = subprocess.run(
            ['npm', 'outdated', '--json'],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.stdout:
            return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        pass
    return []


def check_audit() -> list:
    """检查安全漏洞"""
    try:
        result = subprocess.run(
            ['npm', 'audit', '--json'],
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.stdout:
            data = json.loads(result.stdout)
            return data.get('vulnerabilities', {})
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        pass
    return {}


def format_report(outdated: list, vulnerabilities: dict) -> str:
    """格式化报告"""
    report = ["📦 依赖检查报告\n"]
    
    # 过时依赖
    if outdated:
        report.append("⚠️  过时的依赖:")
        for pkg, info in outdated.items():
            current = info.get('current', '?')
            latest = info.get('latest', '?')
            report.append(f"  - {pkg}: {current} → {latest}")
        report.append("")
    else:
        report.append("✅ 所有依赖都是最新版本\n")
    
    # 安全漏洞
    if vulnerabilities:
        report.append("❌ 发现安全漏洞:")
        for level in ['critical', 'high', 'moderate', 'low']:
            count = vulnerabilities.get(level, 0)
            if count > 0:
                icon = {'critical': '🔴', 'high': '🟠', 'moderate': '🟡', 'low': '🔵'}[level]
                report.append(f"  {icon} {level.upper()}: {count}")
        report.append("\n运行 'npm audit fix' 修复自动可修复的漏洞")
    else:
        report.append("✅ 没有发现安全漏洞\n")
    
    return '\n'.join(report)


def main():
    package = get_package_json()
    if not package:
        print("❌ 未找到 package.json，请在项目根目录运行")
        sys.exit(1)
    
    print("🔍 检查依赖...\n")
    
    outdated = check_outdated()
    vulnerabilities = check_audit()
    
    print(format_report(outdated, vulnerabilities))


if __name__ == '__main__':
    main()

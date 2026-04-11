#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LHC彩票投注记录解析统计工具 v3.0
支持多种格式：聊天记录、混合玩法、分行记录、生肖特碰等
"""

import re
import sys
from collections import defaultdict
from itertools import combinations
from typing import List, Tuple, Dict, Optional


class LHCParser:
    """LHC彩票投注记录解析器 v3.0"""
    
    # 玩法类型映射
    PLAY_TYPES = {
        '三中三': 3,
        '复三中三': 3,
        '复式三中三': 3,
        '复试三中三': 3,
        '复三': 3,
        '三星': 3,  # 三星 = 三中三
        '二中二': 2,
        '复二中二': 2,
        '复式二中二': 2,
        '复试二中二': 2,
        '复二': 2,
        '死活组': 4,
        '死活': 4,
        '特串': 1,
    }
    
    # 中文数字映射
    CHINESE_NUMBERS = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '十一': 11, '十二': 12, '十五': 15, '二十': 20, '三十': 30,
        '五十': 50, '一百': 100, '两百': 200, '三百': 300, '五百': 500,
    }
    
    # 生肖数字映射（虚岁，不超过49）
    ZODIAC_MAP = {
        '狗': [9, 21, 33, 45],
        '鸡': [10, 22, 34, 46],
        '龙': [3, 15, 27, 39, 41],
        '蛇': [4, 16, 28, 40],
        '马': [5, 17, 29, 41],
        '羊': [6, 18, 30, 42],
        '猴': [7, 19, 31, 43],
        '鼠': [1, 13, 25, 37, 49],
        '牛': [2, 14, 26, 38],
        '虎': [3, 15, 27, 39],
        '兔': [4, 16, 28, 40],
        '猪': [8, 20, 32, 44],
    }
    
    def __init__(self):
        # 存储格式：{combo: {'count': 组数, 'amount': 总金额, 'unit_price': 单价}}
        self.results = {
            '三中三': defaultdict(lambda: {'count': 0, 'amount': 0, 'unit_price': 0}),
            '二中二': defaultdict(lambda: {'count': 0, 'amount': 0, 'unit_price': 0}),
            '特碰': defaultdict(lambda: {'count': 0, 'amount': 0, 'unit_price': 0}),
            '死活组': defaultdict(lambda: {'count': 0, 'amount': 0, 'unit_price': 0}),
            '特串': defaultdict(lambda: {'count': 0, 'amount': 0, 'unit_price': 0}),
        }
        self.unparsed_lines = []  # 无法解析的内容
    
    def contains_chinese_number(self, text: str) -> bool:
        """检查文本是否包含中文数字"""
        pattern = r'[一二三四五六七八九十百千万]+'
        return bool(re.search(pattern, text))
    
    def chinese_to_number(self, text: str) -> Optional[int]:
        """将中文数字转换为阿拉伯数字"""
        # 直接匹配
        if text in self.CHINESE_NUMBERS:
            return self.CHINESE_NUMBERS[text]
        
        # 复杂中文数字解析
        result = 0
        temp = 0
        for char in text:
            if char == '十':
                temp = 10 if temp == 0 else temp * 10
            elif char == '百':
                temp = temp * 100
            elif char in '一二三四五六七八九':
                num = self.CHINESE_NUMBERS.get(char, 0)
                temp = temp + num if temp >= 10 else num
            else:
                result += temp
                temp = 0
        result += temp
        
        return result if result > 0 else None
    
    def parse_numbers(self, text: str) -> List[int]:
        """从文本中提取号码"""
        all_numbers = re.findall(r'\d+', text)
        numbers = [int(n) for n in all_numbers if 1 <= int(n) <= 49]
        return sorted(set(numbers))
    
    def parse_amount(self, text: str) -> Tuple[int, bool]:
        """
        从文本中提取金额
        返回: (金额, 是否为单价)
        """
        # 检查中文数字金额（如"三中三的五"表示每组5元）
        match = re.search(r'(三中三|二中二|三星)的([一二三四五六七八九十百]+)', text)
        if match:
            chinese_num = match.group(2)
            amount = self.chinese_to_number(chinese_num)
            if amount:
                return amount, True
        
        # 检查 "各XX" 格式
        match = re.search(r'各(\d+)', text)
        if match:
            return int(match.group(1)), True
        
        # 检查 "名XX" 或 "块XX" 格式
        match = re.search(r'[名块](\d+)', text)
        if match:
            return int(match.group(1)), True
        
        # 检查 "XX元" 或 "XX块" 格式
        match = re.search(r'(\d+)(?:元|块)', text)
        if match:
            return int(match.group(1)), True
        
        # 检查 "玩法XX" 格式（如"三中三300"）
        match = re.search(r'(三中三|二中二|死活组|特串|三星)(\d+)', text)
        if match:
            return int(match.group(2)), False  # 总额
        
        # 最后尝试匹配行末数字
        match = re.search(r'(\d+)$', text)
        if match:
            return int(match.group(1)), False
        
        return 0, False
    
    def detect_play_type(self, text: str, numbers: List[int]) -> str:
        """检测玩法类型"""
        # 检查生肖特碰
        for zodiac in self.ZODIAC_MAP:
            if zodiac in text and ('x' in text or '×' in text or '特碰' in text):
                return '特碰'
        
        # 优先检测明确标记
        for play_name in self.PLAY_TYPES:
            if play_name in text:
                if play_name == '三星':
                    return '三中三'
                return play_name
        
        # 根据号码数量推断
        if len(numbers) == 4 and '死活' in text:
            return '死活组'
        elif len(numbers) >= 3:
            return '三中三'
        elif len(numbers) == 2:
            return '二中二'
        
        return '三中三'
    
    def parse_zodiac_tepeng(self, line: str) -> List[Tuple[str, List[int], int, int]]:
        """解析生肖特碰"""
        results = []
        
        # 提取金额
        amount, is_unit = self.parse_amount(line)
        if amount == 0:
            amount = 10
        
        # 提取生肖
        zodiacs_found = []
        for zodiac in self.ZODIAC_MAP:
            if zodiac in line:
                zodiacs_found.append(zodiac)
        
        if len(zodiacs_found) >= 2:
            z1_nums = self.ZODIAC_MAP[zodiacs_found[0]]
            z2_nums = self.ZODIAC_MAP[zodiacs_found[1]]
            
            # 生成所有二中二组合
            for n1 in z1_nums:
                for n2 in z2_nums:
                    if n1 != n2:
                        combo = tuple(sorted([n1, n2]))
                        results.append(('特碰', list(combo), amount, 1))
        
        return results
    
    def parse_line(self, line: str) -> List[Tuple[str, List[int], int, int]]:
        """解析单行投注记录"""
        results = []
        line = line.strip()
        
        if not line:
            return results
        
        # 处理混合玩法
        if re.search(r'[,，]', line):
            parts = re.split(r'[,，]', line)
            for part in parts:
                sub_results = self.parse_line(part)
                results.extend(sub_results)
            return results
        
        # 检查生肖特碰
        if '特碰' in line or re.search(r'[狗鸡龙蛇马羊猴鼠牛虎兔猪][x××]', line):
            return self.parse_zodiac_tepeng(line)
        
        # 提取号码
        numbers = self.parse_numbers(line)
        if not numbers:
            self.unparsed_lines.append(line)
            return results
        
        # 提取金额
        amount, is_unit_price = self.parse_amount(line)
        
        # 检测玩法
        play_type = self.detect_play_type(line, numbers)
        
        # 计算组合数
        n = self.PLAY_TYPES.get(play_type, 3)
        if play_type == '死活组':
            num_combos = 1
        elif play_type == '特串':
            num_combos = len(numbers)
        else:
            from math import comb
            num_combos = comb(len(numbers), n)
        
        # 计算单价
        if is_unit_price:
            unit_price = amount
        else:
            unit_price = amount // num_combos if num_combos > 0 else 0
        
        results.append((play_type, numbers, unit_price, num_combos))
        return results
    
    def add_bet(self, play_type: str, numbers: List[int], unit_price: int):
        """添加投注记录"""
        if play_type not in self.results:
            return
        
        n = self.PLAY_TYPES.get(play_type, 3)
        
        if play_type == '特串':
            for num in numbers:
                self.results['特串'][(num,)]['count'] += 1
                self.results['特串'][(num,)]['amount'] += unit_price
                self.results['特串'][(num,)]['unit_price'] = unit_price
        elif play_type == '死活组':
            if len(numbers) >= 4:
                combo = tuple(sorted(numbers[:4]))
                self.results['死活组'][combo]['count'] += 1
                self.results['死活组'][combo]['amount'] += unit_price
                self.results['死活组'][combo]['unit_price'] = unit_price
        else:
            combos = list(combinations(sorted(numbers), n))
            for combo in combos:
                self.results[play_type][combo]['count'] += 1
                self.results[play_type][combo]['amount'] += unit_price
                self.results[play_type][combo]['unit_price'] = unit_price
    
    def parse(self, text: str):
        """解析所有投注记录"""
        lines = text.strip().split('\n')
        
        results = []
        i = 0
        
        while i < len(lines):
            line = lines[i].strip()
            
            # 跳过空行
            if not line:
                i += 1
                continue
            
            # 跳过用户名和时间戳
            if re.match(r'^[顺顺吸当当兰购收]+$', line):
                i += 1
                continue
            if re.match(r'^\d{4}年\d{1,2}月\d{1,2}日\d{1,2}:\d{2}$', line):
                i += 1
                continue
            
            # 解析当前行
            parsed = self.parse_line(line)
            
            # 检查是否需要合并下一行
            if parsed and parsed[0][2] == 0:
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if re.match(r'^(复式|复试|复)?(三中三|二中二|死活组|三星)(各\d+)?$', next_line):
                        amount, is_unit = self.parse_amount(next_line)
                        if amount > 0:
                            play_type, numbers, _, num_combos = parsed[0]
                            unit_price = amount if is_unit else (amount // num_combos if num_combos > 0 else 0)
                            parsed = [(play_type, numbers, unit_price, num_combos)]
                        i += 1
            
            results.extend(parsed)
            i += 1
        
        for play_type, numbers, unit_price, _ in results:
            if numbers and unit_price > 0:
                self.add_bet(play_type, numbers, unit_price)
    
    def format_output(self, original_text: str) -> str:
        """格式化输出结果"""
        output_lines = []
        
        output_lines.append("=" * 70)
        output_lines.append("📊 彩票投注记录统计报告")
        output_lines.append("=" * 70)
        
        # 1. 图片识别文字内容
        output_lines.append("\n📄 【图片识别文字内容】")
        output_lines.append("-" * 70)
        output_lines.append(original_text)
        
        # 2. 无法解析的格式
        if self.unparsed_lines:
            output_lines.append("\n⚠️ 【无法解析的格式】")
            output_lines.append("-" * 70)
            for line in self.unparsed_lines:
                output_lines.append(f"- {line}（格式无法识别）")
        
        # 3. 可解析部分统计
        output_lines.append("\n🎯 【可解析部分统计】")
        output_lines.append("-" * 70)
        
        # 各玩法统计
        for play_type in ['三中三', '二中二', '特碰', '死活组', '特串']:
            if any(v['count'] > 0 for v in self.results[play_type].values()):
                output_lines.append(f"\n📌 【{play_type}统计】（按金额降序）")
                output_lines.append("-" * 70)
                
                sorted_combos = sorted(
                    [(k, v) for k, v in self.results[play_type].items() if v['count'] > 0],
                    key=lambda x: (-x[1]['amount'], x[0])
                )
                
                for combo, data in sorted_combos:
                    combo_str = ' '.join(f'{n:02d}' for n in combo)
                    output_lines.append(f"{combo_str} {data['count']}组 {data['amount']}元（每组单价{data['unit_price']}元）")
                
                total_count = sum(v['count'] for v in self.results[play_type].values())
                total_amount = sum(v['amount'] for v in self.results[play_type].values())
                output_lines.append("-" * 70)
                output_lines.append(f"小计: {total_count}组 共{total_amount}元")
        
        # 总计
        output_lines.append("\n" + "=" * 70)
        output_lines.append("💰 【总计汇总】")
        output_lines.append("-" * 70)
        
        grand_total_count = 0
        grand_total_amount = 0
        
        for play_type, combos in self.results.items():
            count = sum(v['count'] for v in combos.values())
            amount = sum(v['amount'] for v in combos.values())
            if count > 0:
                grand_total_count += count
                grand_total_amount += amount
                output_lines.append(f"- {play_type}: {count}组，共 {amount} 元")
        
        output_lines.append("-" * 70)
        output_lines.append(f"✅ 总计: {grand_total_count}组，共 {grand_total_amount} 元")
        output_lines.append("=" * 70)
        
        return '\n'.join(output_lines)


def main():
    """主函数"""
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    if len(sys.argv) < 2:
        print("用法: python lhc_parse.py <投注记录>")
        print("      python lhc_parse.py <文件路径>")
        print("\n支持格式:")
        print("  - 聊天记录格式")
        print("  - 混合玩法（逗号分隔）")
        print("  - 分行记录")
        print("  - 生肖特碰（狗x龙二中二特碰各10）")
        print("  - 中文数字（三中三的五 = 每组5元）")
        print("  - 三星 = 三中三")
        sys.exit(1)
    
    input_text = sys.argv[1]
    
    try:
        with open(input_text, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        text = input_text
    
    parser = LHCParser()
    parser.parse(text)
    output = parser.format_output(text)
    print(output)


if __name__ == '__main__':
    main()

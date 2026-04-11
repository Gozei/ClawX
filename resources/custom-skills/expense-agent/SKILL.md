# 报销 Agent Skill

## 功能描述

从发票图片/PDF 中自动识别信息，生成报销清单并追加到指定 Excel 文件。

## 触发场景

- "帮我处理这张发票"
- "把这个发票加到报销清单"
- "批量处理这些发票"
- "识别一下这个发票"

## 使用方式

### 单张发票处理

```bash
python tools/expense_agent.py <发票文件> --project <项目简称> --stage <项目进度>
```

### 批量处理

```bash
python tools/expense_agent.py 发票1.jpg 发票2.pdf 发票3.png --project <项目简称>
```

### 测试模式（仅识别不保存）

```bash
python tools/expense_agent.py <发票文件> --project <项目简称> --test
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| files | ✅ | 发票文件（图片或 PDF） | invoice.jpg |
| --project, -p | ✅ | 项目简称 | 楚雄鲜花产业营销平台 |
| --stage, -s | ❌ | 项目进度（售前/交付/验收） | 售前 |
| --location, -l | ❌ | 地点 | 昆明 |
| --remark, -r | ❌ | 备注 | 机票 |
| --test, -t | ❌ | 测试模式，仅识别不保存 | - |
| --excel, -e | ❌ | 报销清单路径（默认已配置） | - |

## 自动分类规则

| 发票关键词 | 费用类别 |
|------------|----------|
| 航空、机票、高铁、火车、出租车、加油 | 交通 |
| 酒店、宾馆、住宿、旅馆 | 住宿 |
| 餐饮、饭店、酒楼、招待 | 招待 |
| 其他发票 | 其他 |

## 输出文件

默认输出到：`C:\Users\likew\.openclaw\workspace\附件\报销\许志雄报销明细202601.xls`

## 依赖安装

```bash
pip install paddlepaddle paddleocr pdf2image pandas openpyxl xlrd
```

## 示例

### 示例 1: 处理机票发票

```bash
python tools/expense_agent.py 机票.jpg --project "楚雄鲜花产业营销平台" --stage 售前
```

输出：
```
📋 识别结果:
  发票类型: 电子发票
  发票号码: 12345678
  开票日期: 2026-01-06
  销售方: 深圳航空有限公司
  金额: ¥520.00
  费用类别: 交通
  推断地点: 深圳

✅ 已添加报销记录: 序号 17, 金额 ¥520
```

### 示例 2: 批量处理

```bash
python tools/expense_agent.py 发票1.jpg 发票2.pdf 发票3.png --project "某项目名称"
```

## 注意事项

1. **项目简称为必填项**
2. 支持的图片格式：JPG、PNG、BMP 等
3. 支持 PDF 文件（需要 pdf2image 和 poppler）
4. 首次使用会自动下载 PaddleOCR 模型（约 100MB）
5. 推荐使用 GPU 版本 PaddlePaddle 加速识别

## 故障排除

### PaddleOCR 安装失败

```bash
# CPU 版本
pip install paddlepaddle

# GPU 版本（需要 CUDA）
pip install paddlepaddle-gpu
```

### PDF 处理失败

需要安装 poppler：
- Windows: 下载 poppler 并添加到 PATH
- 或使用图片格式发票

### 中文乱码

确保终端使用 UTF-8 编码：
```python
sys.stdout.reconfigure(encoding='utf-8')
```

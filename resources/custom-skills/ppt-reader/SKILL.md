---
name: ppt-reader
description: 读取和解析 PowerPoint 演示文稿（.pptx/.ppsx）。提取文字内容、表格数据、图片信息、元数据等。当用户需要查看 PPT 内容、分析演示文稿、提取幻灯片信息时使用此技能。
---

# PPT Reader - PowerPoint 演示文稿读取器

读取和解析 PowerPoint 文件，提取完整内容。

## 支持格式

- `.pptx` - PowerPoint 演示文稿
- `.ppsx` - PowerPoint 放映文件

## 使用方法

### 基本用法

```bash
python scripts/extract_ppt.py <ppt文件路径>
```

### 输出内容

返回 JSON 结构，包含：

1. **元数据**：标题、作者、创建时间、修改时间
2. **幻灯片列表**：每页内容
3. **形状信息**：文本框、图片、表格等
4. **完整文本**：所有文字内容合并

### 输出示例

```json
{
  "success": true,
  "filename": "演示文稿.pptx",
  "slide_count": 10,
  "slides": [
    {
      "slide_number": 1,
      "text_content": ["标题", "副标题"],
      "full_text": "标题\n副标题",
      "shapes": [
        {"type": "AUTO_SHAPE", "text": "标题"},
        {"type": "PICTURE", "image": {"size": "800x600"}}
      ]
    }
  ],
  "full_content": "=== 第 1 页 ===\n标题\n副标题",
  "metadata": {
    "title": "文档标题",
    "author": "作者"
  }
}
```

## 提取能力

### 文本内容
- 标题和正文
- 文本框内容
- 形状内文字

### 表格数据
- 完整表格内容
- 单元格文本

### 图片信息
- 图片尺寸
- 图片类型

### 元数据
- 文档标题
- 作者信息
- 创建/修改时间

## 依赖

需要 `python-pptx` 库：

```bash
pip install python-pptx
```

## 使用场景

1. **内容分析**：查看 PPT 全部文字内容
2. **数据提取**：提取表格数据
3. **文档理解**：分析演示文稿结构
4. **内容转换**：将 PPT 转为可读文本

# Mem0 Memory Skill

为 OpenClaw 提供 Mem0 智能记忆能力。

## 功能

- **智能检索**: 向量语义搜索，找相关记忆
- **自动提取**: 从对话中自动提取关键事实
- **多级记忆**: User / Session / Agent 三层隔离
- **增量更新**: 自动去重、合并、清理过期记忆

## 使用场景

- 需要查找历史记忆时
- 需要保存重要信息时
- 需要跨会话记忆时

## 工具

### mem0_search - 搜索记忆

```python
from tools.mem0.mem0_client import search_memories

# 搜索相关记忆
results = search_memories("用户的创业目标")
```

### mem0_add - 添加记忆

```python
from tools.mem0.mem0_client import add_memory

# 添加记忆
add_memory("用户决定下周三开会讨论融资", user_id="xuzhixiong")
```

### mem0_get_all - 获取所有记忆

```python
from tools.mem0.mem0_client import get_all_memories

# 获取用户所有记忆
memories = get_all_memories(user_id="xuzhixiong")
```

## 配置

配置文件: `tools/mem0/mem0_config.py`

API Key: `tools/mem0/.env`

## 集成到 OpenClaw

此 skill 可替代现有的 memory_search/memory_get 工具：

| 原工具 | Mem0 对应 |
|--------|-----------|
| memory_search | mem0_search (语义搜索) |
| memory_get | mem0_get_all |
| 手动写 MEMORY.md | mem0_add (自动提取) |

## 数据目录

```
C:\Users\likew\.openclaw\mem0_data\
└── qdrant\          # 向量数据库
```

## 导入现有记忆

```bash
python tools/mem0/import_memory.py
```

## 测试

```bash
python tools/mem0/test_mem0.py
```

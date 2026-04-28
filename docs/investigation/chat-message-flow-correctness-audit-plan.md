# Chat 消息处理逻辑正确性与精简度审查计划

## 背景

`chat-message-flow-simplification-plan.md` 已完成结构性重构：消息 view model 派生、列表外壳、process turn 渲染和共享类型已经从 `Chat/index.tsx` 拆出。

这次重构的主要目标是降低文件耦合和阅读成本，并通过现有单测、补充单测、lint、typecheck 确认没有明显回归。但它还不是一次完整的逻辑正确性审查，也没有系统证明当前消息流展示规则已经足够精简。

本计划用于后续专门审查：

- streaming / process / final 展示逻辑是否正确
- active turn 与历史消息切换是否稳定
- fallback active turn 是否覆盖真实边界场景
- 滚动锚点与列表 key 是否足够稳定
- 当前 view model 是否还有可删除的重复状态和组合布尔值

已观察到或需要重点防止的问题：

- 消息重复显示：同一条 user / assistant / streaming final / process event 可能同时出现在历史区、active turn、standalone streaming item 中
- 流式输出效果丢失：内容仍在增长，但 UI 被当成普通已完成消息渲染，缺少 streaming 状态和增量反馈
- 自动滚动失效：用户位于底部且有内容持续输出时，列表没有稳定跟随到底部
- 不该展示的中间态泄漏：已被 process/final 拆分或内部 routine 过滤的内容仍然以普通消息出现
- 应该保留的内容被误隐藏：去重或过滤条件过宽，导致最终回复、附件、图片或 tool 结果不可见

## 审查目标

- 明确 `useChatTranscriptModel.ts` 中每个分支的业务含义和可观测 UI 结果
- 找出重复、含糊或可合并的派生状态
- 建立消息流状态矩阵，覆盖 active turn、streaming、pending final、tool status、recent completed grace window
- 补足缺失测试，尤其是容易靠手感维护的边界状态
- 在不改变 Gateway 协议、不重写 store 的前提下，让 transcript model 更容易证明正确

非目标：

- 不重新设计聊天 UI 视觉表现
- 不重写 `useChatStore`
- 不改变 session / Gateway / transport 语义
- 不为了“看起来更少代码”合并有清晰业务差异的状态

## 当前重点文件

- `src/pages/Chat/useChatTranscriptModel.ts`
- `src/pages/Chat/transcript-types.ts`
- `src/pages/Chat/ChatProcessTurn.tsx`
- `src/pages/Chat/ChatTranscriptList.tsx`
- `src/pages/Chat/history-grouping.ts`
- `src/pages/Chat/message-utils.ts`
- `src/pages/Chat/process-events-next.tsx`
- `tests/unit/chat-transcript-model.test.ts`
- 相关聊天页面回归测试

## 审查问题清单

### 1. 输入状态是否归一化完整

逐项检查 `BuildChatTranscriptModelInput`：

- `messages`
- `deferredHistoryMessages`
- `activeTurnBuffer`
- `streamingMessage`
- `streamingTools`
- `sending`
- `pendingFinal`
- `lastUserMessageAt`
- `showThinking`
- `chatProcessDisplayMode`
- `assistantMessageStyle`
- `hideInternalRoutineProcesses`

需要回答：

- 哪些字段只是影响数据拆分，哪些字段只是影响 UI 选择
- `activeTurnBuffer` 与 fallback 的差异是否被完全屏蔽
- `deferredHistoryMessages` 是否只参与历史去重，不影响 active turn 内容
- `streamingTools` 是否只在 process display mode 为 `all` 时进入可见展示

### 2. fallback active turn 是否正确

重点检查 `buildFallbackActiveTurn`：

- `sending=true` 时是否总能找到正确的最后一条 user message
- `sending=false` 但仍在 grace window 内时，是否只保留刚完成的一轮
- history 与 active turn 的切割是否会吞掉普通历史消息
- streaming 字符串和结构化 assistant message 是否生成等价 display message
- streaming 内容与已落盘 assistant 重复时，是否只展示一份
- 无 user message、internal maintenance user、空 assistant 内容时是否安全

建议补充测试：

- 多轮历史中最后一轮完成后 grace window 内外的切换
- 最后一条消息不是 user 且 `sending=true` 的异常输入
- streaming message timestamp 缺失时的 fallback timestamp
- user message timestamp 秒级和毫秒级混用

### 3. process/final 拆分是否一致

需要对齐这些入口：

- `splitFinalMessageForTurnDisplay`
- `groupMessagesForDisplay`
- `hasVisibleProcessContent`
- `hasVisibleFinalContent`
- `assistantMessageShowsInChat`
- `getProcessEventItems`

需要回答：

- 同一条 assistant message 在历史 turn 和 active turn 中是否拆分一致
- `_attachedFiles`、图片、thinking、tool use、纯文本的可见性是否一致
- `assistantMessageStyle` 为 `stream` 和 `bubble` 时是否只改变展示形态，不改变消息归属
- `hideInternalRoutineProcesses` 是否只隐藏内部 routine process，不误伤最终回复

建议补充测试：

- final reply 只有附件
- process message 只有 tool use
- assistant message 同时包含 thinking、tool、final text
- `hideInternalRoutineProcesses=true` 时仍保留用户可见 final

### 4. active turn UI 决策是否可证明

重点检查这些派生状态：

- `shouldUseProcessLayout`
- `showProcessActivity`
- `activeTurnProcessStreamingMessage`
- `activeTurnFinalStreamingMessage`
- `shouldShowRecentCompletedTurnLayout`
- `shouldHideStandaloneStreamingAvatar`
- `showTyping`

需要回答：

- 每个布尔值是否只有一个明确职责
- 是否存在两个布尔值表达同一件事
- `pendingFinal`、`streamingTools`、`hasStreamingFinalMessage` 同时出现时优先级是否明确
- active turn 存在时，standalone streaming final 是否永不重复出现
- active turn user message 是否永远不会同时出现在历史列表末尾
- 已落盘 final 与 streaming final 内容相同或高度相似时，是否只展示一个
- process message 被合并进 process section 后，是否不会再作为普通 assistant bubble 展示
- `isStreaming={sending}` 是否准确传给仍在增长的 final bubble，避免流式效果丢失

建议输出一个状态表：

| 状态 | active turn | process section | final bubble | typing | activity | standalone streaming |
|------|-------------|-----------------|--------------|--------|----------|----------------------|
| sending，无输出 | 是 | 否 | 否 | 是 | 否 | 否 |
| sending，process streaming | 是 | 是 | 否 | 否 | 视情况 | 否 |
| sending，final streaming，无 process | 视设置 | 视设置 | 是 | 否 | 否 | 视情况 |
| pending final，tools running | 视设置 | 是 | 否 | 否 | 是 | 否 |
| completed grace window | 是 | 是 | 是 | 否 | 视情况 | 否 |
| completed grace window 过期 | 否 | 历史 turn | 历史 turn | 否 | 否 | 否 |

### 5. 列表 key 与滚动签名是否稳定

重点检查：

- `activeTurnScrollKey`
- `chatListItems` key
- `latestTranscriptActivitySignature`
- `ChatTranscriptList` anchor attributes
- `ChatMessage` block anchor prefix

需要回答：

- streaming 文本增长时签名是否变化
- tool status 更新时签名是否变化
- 普通重渲染是否不会制造新的 key
- active turn 完成进入历史 turn 时是否不会造成明显跳动
- `useDeferredValue` 去重是否只处理 optimistic duplicate user，不隐藏真实消息
- 用户已在底部时，streaming 文本增长、process event 增加、tool status 更新是否都会触发跟随到底部
- 用户主动离开底部阅读历史时，新增内容是否不会强行抢滚动
- `latestTranscriptActivitySignature` 是否包含所有会改变 transcript 高度或最后可见内容的字段
- 去重造成 item 数量减少时，滚动锚点是否仍能定位到正确消息块

建议补充测试或 E2E：

- 用户滚动到历史中间时 streaming 增量不抢滚动
- active turn 完成后历史 turn key 稳定
- 同文本不同 timestamp 的 user message 不被误去重
- 已在底部时连续 streaming token 能自动滚动到底部
- process section 从无内容变为有内容时能自动滚动到底部
- pending final activity 切换到 final bubble 时不丢底部跟随

### 6. 重复显示与去重策略

重复显示需要作为单独审查主题处理，而不是只依赖视觉检查。

重点检查：

- `trimDeferredHistoryForActiveTurn`
- `isSameActiveTurnUserMessage`
- `isStreamingDuplicateOfPersistedAssistant`
- `shouldHideStandaloneStreamingAvatar`
- `chatListItems` 的生成顺序
- `groupMessagesForDisplay` 对 assistant turn 的聚合

需要回答：

- “同一条消息”的判定依据是什么：id、timestamp、role、content，还是组合 key
- optimistic user、落盘 user、active turn user 三者同时存在时优先保留哪一个
- streaming assistant 与落盘 assistant 同内容时，最终应该保留 streaming、persisted，还是按 sending 状态切换
- final reply 拆出 collapsed process 后，原始 assistant message 是否还会走普通渲染路径
- process event 与 streamingTools 表达同一工具状态时，是否会重复显示

建议补充测试：

- optimistic user 与历史 user 同文本同时间窗口只显示一次
- optimistic user 与历史 user 同文本但不同 timestamp 超出窗口时都保留
- streaming final 与 persisted final 同文本只显示一次
- streaming final 与 persisted final 不同文本时展示正确的一份或两份，取决于 active turn 状态
- process event 已在 process section 展示后，不作为普通 assistant bubble 重复出现
- tool status 已由 streamingTools 展示时，不重复生成额外空 assistant 消息

### 7. 流式输出体验

需要确认“有内容正在输出”不仅数据正确，UI 也处于 streaming 表现。

重点检查：

- `activeTurnFinalStreamingMessage`
- `activeTurnProcessStreamingMessage`
- `streaming-final` list item
- `ChatMessage` 的 `isStreaming`
- `ProcessEventMessage` 的 `preferPlainDirectContent`
- active turn 完成前后的 `sending` 状态传递

需要回答：

- final 内容增长时是否总有一个可见 bubble 使用 streaming 渲染
- process 内容增长时是否在 process section 内增量展示
- streaming message 被判定为 duplicate 时，是否真的已有等价 persisted 内容可见
- `pendingFinal=true` 但还没有 final 内容时，是否显示 activity 而不是空白
- `sending=false` 的 recent completed grace window 是否不再错误显示 streaming 效果

建议补充测试或 E2E：

- 字符串 streamingMessage 增长时 final bubble 标记为 streaming
- 结构化 assistant streamingMessage 增长时 final bubble 标记为 streaming
- process streaming message 增长时 process section 内容更新
- duplicate streaming 被隐藏时 persisted final 可见
- pending final 没有文本时显示 activity / typing，不出现空 assistant bubble

### 8. 精简度审查

审查时不要只看行数，而要看状态是否可解释。

候选精简方向：

- 将 `shouldUseProcessLayout` 拆成命名更明确的原因集合，或反过来用 helper 返回 reason
- 将 streaming process/final 选择提取为纯函数
- 将 active turn item 生成提取为小函数，减少 `buildChatTranscriptModel` 的线性分支长度
- 将可见性判断集中为 `ProcessVisibilityContext`
- 给 `latestTranscriptActivitySignature` 建立专门 builder，避免签名字段散落在主流程末尾

不建议的精简：

- 合并 `processStreamingMessage` 和 `finalStreamingMessage`，除非能证明所有 UI 场景等价
- 移除 `recent completed grace window`，它影响完成瞬间的用户体验
- 把 `activeTurnBuffer` 和 fallback 混回页面组件
- 用字符串拼接替代已有结构化判断

## 执行阶段

### Phase A：分支标注与状态矩阵

产出：

- 给 `useChatTranscriptModel.ts` 的主要分支写出状态矩阵
- 标出每个派生布尔值的职责
- 列出无法解释或职责重叠的状态
- 标出所有可能导致重复显示、流式效果丢失、底部跟随失效的分支

验收：

- 每个 `chatListItems` item 类型都有明确触发条件
- active turn、streaming final、typing、activity 不存在未解释的重叠展示
- 每一种重复显示风险都有明确去重策略或保留理由
- 每一种 streaming 内容来源都有明确的 UI 承载位置

### Phase B：补测试覆盖边界

产出：

- 扩充 `tests/unit/chat-transcript-model.test.ts`
- 必要时新增页面级回归测试

验收：

- fallback active turn、process/final 拆分、duplicate streaming、recent completed grace window、tool activity、scroll signature 都有对应测试
- 新增测试先能描述当前行为，再决定是否需要修正行为
- 至少覆盖 user 重复、assistant final 重复、process event 重复、streaming final 重复
- 至少覆盖 final streaming、process streaming、pending final activity 三类流式/准流式体验
- 至少覆盖“在底部自动跟随”和“离开底部不抢滚动”两类滚动行为

### Phase C：小步精简与命名修正

产出：

- 将可独立证明的复杂分支提取为纯函数
- 删除确认无用的重复状态
- 改善命名，使状态表达 UI 结果或业务原因

验收：

- `buildChatTranscriptModel` 主流程长度和嵌套深度下降
- 新 helper 有单测或由现有 model 测试覆盖
- 对外返回类型不引入不必要字段

### Phase D：真实 UI 验证

产出：

- 运行相关 E2E 或手动验收记录
- 对比重构前后关键聊天流场景

建议场景：

- 普通文本回复
- 带 thinking 的回复
- tool call 运行中、重试、完成、失败
- final reply 在 process 后出现
- pending final 长时间等待
- streaming final 持续增长并保持流式效果
- process event 持续增长并保持在 process section 内
- 同一轮回复完成时不重复显示 user、process 或 final
- 用户在底部时输出增长自动跟随到底部
- 用户滚动到历史中间时输出增长不抢滚动
- recent completed turn 从 active layout 过渡到历史 turn
- 切换 `assistantMessageStyle`
- 切换 `chatProcessDisplayMode`
- 切换 `hideInternalRoutineProcesses`

## 建议验证命令

```bash
pnpm exec eslint src/pages/Chat/index.tsx src/pages/Chat/useChatTranscriptModel.ts src/pages/Chat/ChatProcessTurn.tsx src/pages/Chat/ChatTranscriptList.tsx src/pages/Chat/transcript-types.ts tests/unit/chat-transcript-model.test.ts
pnpm exec tsc -p tsconfig.typecheck.json --noEmit --pretty false
pnpm exec vitest run tests/unit/chat-transcript-model.test.ts tests/unit/chat-page-process-turn.test.tsx tests/unit/chat-page-stream-dedupe.test.tsx tests/unit/chat-page-active-turn-dedupe.test.tsx
pnpm run build:vite
pnpm exec playwright test tests/e2e/chat-stream-stability.spec.ts tests/e2e/chat-process-step-complete-without-refresh.spec.ts
```

如果审查期间改动通信路径、gateway events、runtime send/receive、delivery 或 fallback，还必须运行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## 完成标准

- 有明确状态矩阵覆盖主要消息流状态
- 新增或更新测试覆盖审查发现的边界
- 所有已知重复展示、漏展示、滚动跳动风险都有结论
- 已观察到的三类问题有明确验收：消息不重复、流式输出可见、底部自动跟随正确
- `useChatTranscriptModel.ts` 中剩余复杂分支都有命名或注释解释
- lint、typecheck、相关单测和必要 E2E 通过
- 若发现行为问题，修复与测试在同一轮完成

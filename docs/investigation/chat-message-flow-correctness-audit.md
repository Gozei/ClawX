# Chat 消息流正确性审查记录

审查日期：2026-04-28

## 状态矩阵

| 状态 | active turn | process section | final bubble | typing | activity | standalone streaming |
|------|-------------|-----------------|--------------|--------|----------|----------------------|
| sending，无输出 | 有 user 时显示 | 否 | 否 | active turn 内显示；无 user 时显示列表 typing item | 否 | 否 |
| sending，process streaming | 显示 | 显示 process streaming message | 否 | 否 | 无 final 时可显示 process activity | 否 |
| sending，final streaming，无 process | 显示 | 当前进入 process layout，并在 process section 中承载未完成输出 | 否 | 否 | 否 | 否 |
| pending final，tools running | 有 user 时显示；无 user 时只显示 activity item | `chatProcessDisplayMode=all` 时显示 tool status | 否 | 否 | 显示 | 否 |
| completed grace window | 显示 | 有 process、final 或状态-only header 时显示 | 显示 persisted final | 否 | 仅无 final 可见内容时显示 | 否 |
| completed grace window 过期 | 否 | 历史 turn 中显示 | 历史 turn 或普通 assistant message 中显示 | 否 | 否 | 否 |

## 派生状态职责

- `shouldShowRecentCompletedTurnLayout`：仅保留刚完成的一轮在 active turn 形态中，避免完成瞬间 UI 跳动
- `shouldUseProcessLayout`：决定 active turn 是否使用 user + process section + final 的组合布局
- `activeTurnProcessStreamingMessage`：选择仍在进行中的 process 承载消息；duplicate streaming 被 persisted assistant 覆盖时为空
- `activeTurnFinalStreamingMessage`：选择可独立显示的 final streaming bubble；sending 期间若使用 process layout，则不重复显示
- `showProcessActivity`：process layout 中暂无 final 可见内容时显示工作状态
- `shouldHideStandaloneStreamingAvatar`：active turn 或历史 turn 已能承载 streaming/final 时，禁止额外 assistant avatar
- `showTyping`：active turn 存在但尚无 stream、pending final、process layout 或 final 时显示等待反馈

## 归一化结论

- `messages`、`activeTurnBuffer`、`streamingMessage`、`lastUserMessageAt` 参与 active turn 与历史切割
- `deferredHistoryMessages` 只用于历史列表去 optimistic duplicate user，不改变 active turn 内容
- `showThinking`、`chatProcessDisplayMode`、`assistantMessageStyle`、`hideInternalRoutineProcesses` 只影响 process/final 可见性和渲染形态
- `streamingTools` 只在 `chatProcessDisplayMode=all` 时生成可见 process/tool status；否则最多维持 pending activity
- fallback active turn 与 `activeTurnBuffer` 最终归一到 `NormalizedActiveTurnSource`，页面组件不再关心来源差异

## 风险与处理

- 重复显示：active user 通过 id/text/timestamp window 去重，streaming assistant 与 persisted assistant 同文本时隐藏 streaming 副本，process/final 拆分后原始 assistant 不再走普通 active bubble 路径
- 流式效果：sending 期间 final streaming 若进入 process layout，会用 process section 的 streaming markdown 承载；独立 final bubble 只在非 process layout 或完成后场景出现
- 滚动跟随：已修正 `latestTranscriptActivitySignature`，现在包含历史尾部完整可见内容、active streaming process/final、persisted final、附件元数据和 tool status 细节，避免同 key 内容增长时漏触发底部跟随
- 内部 routine：`hideInternalRoutineProcesses` 只过滤 process event item，不会过滤 final text 或附件
- 附件-only final：`hasVisibleFinalContent` 将附件和图片视为 final 可见内容，测试覆盖已补足

## 本轮补充覆盖

- fallback active turn 在 grace window 内外切换
- 最后一条消息不是 user 但仍在 sending 时的 active user 选择
- streaming message timestamp 缺失时回退到 user timestamp
- optimistic user 与历史 user 的 timestamp window 去重
- final reply 只有附件
- streamingTools 在非 `all` 模式不产生可见 tool process
- process streaming 内容增长会改变滚动活动签名
- 历史尾部同 key 内容变化会改变滚动活动签名
- tool status summary/failure 等细节变化会改变滚动活动签名

## 后续观察点

- sending 期间“final streaming，无 process”当前仍由 process section 承载，这是现有页面测试明确锁定的行为；若产品希望 final bubble 始终显示 streaming cursor，需要单独调整 UI 规格
- 真实滚动已有相关 unit 与本轮指定 E2E 覆盖；若后续调整滚动控制器，再补更细的 Playwright 场景

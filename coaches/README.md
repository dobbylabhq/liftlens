# LiftLens 教练 Skills

每个教练是一个符合 [Agent Skills 规范](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) 的目录：

```
coaches/
├── _shared/            # 所有教练共用：协议、指标说明、文献库（sources.json）
├── coach-ipf-referee/  # IPF 裁判席：逐条对照 IPF 2026 规则
├── coach-nsca-cscs/    # NSCA 体能教练：技术检查点 + ACSM 渐进
├── coach-rehab-pt/     # 康复理疗师：风险优先、动作调整与替代
├── coach-eastern-periodization/  # 东欧周期化：一致性与训练量
└── coach-china-fitness/          # 大众健身教练：通俗口令、史密斯机
```

本地 agent（`../agent`）调用 `claude -p` 时，用 `--append-system-prompt-file coach-xxx/SKILL.md` 加载人设，
并 `--add-dir coaches/` 让模型按需 Read `references/` 与 `_shared/`（渐进式加载）。

## 新增一个教练
1. 新建 `coach-<小写-连字符>/SKILL.md`，frontmatter 必须有 `name`、`description`（写清"做什么 + 什么时候用"）
2. `metadata` 里写 `displayName`、`region`、`flag`、`school`、`tone`、`accent`、`sourceIds`
3. 引用的文献必须先加到 `_shared/sources.json`（`verified: true` 表示已核实原文/PubMed）
4. **不得冒充任何真实在世的个人**：以流派 / 机构标准为准

## Prior-art（借鉴 / 不借鉴）
| 参考 | 借鉴 | 不借鉴 |
|---|---|---|
| anthropics/skills、官方 Agent Skills 规范 | 目录 + SKILL.md、name 小写连字符、description 写触发时机、references 渐进加载 | — |
| Stanford CS231n 2024 自动判定力量举 | 关键点不等式直接映射 IPF 条款（hip_y>knee_y、elbow_y>shoulder_y）、用关节代替杠铃、平滑 | 只做裁判，不给训练建议 |
| ctsc/FormCheck | 带迟滞的状态机计数 | 固定绝对角度阈值（体型不同会失效）→ 本项目全部按身体比例归一化 |
| 03y/pose-estimation-for-powerlifting | 卧推侧拍存在遮挡 → 降低置信度、交给 agent 看关键帧 | 直接排除卧推 |
| OneWave-AI/claude-skills 等社区健身 skill | 一个教练一个目录、参考资料拆到 references | 强人设 / 冒充真人；"膝过脚尖一律错误"之类无依据的规则（fry-2003） |
| `xxx教练.skill` 命名 | 中文名放 metadata.displayName | 目录名用中文/点号（不符合规范） |

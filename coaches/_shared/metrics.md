# 程序指标说明（findings[].id）

| id | 动作 | 含义 | 计算方式 | 依据 |
|---|---|---|---|---|
| bench.touch_point | 卧推 | 触胸点在"肩→髋"连线上的相对位置，0=肩关节，1=髋关节 | 到底帧杠铃（或手腕）投影到肩髋线 | nsca-technique-4e（触胸于乳头线附近）、经验阈值 0.2–0.5 |
| bench.depth_ipf | 卧推 | 到底时肘关节是否低于肩关节（IPF 2026 深度条款） | elbow_y ≥ shoulder_y（侧拍，图像坐标） | ipf-2026-bench、cs231n-2024 |
| bench.partial_reps | 卧推 | 某次到底位置比本组常规深度浅 = 半程 | 底部 y 差 / 本组杠铃行程中位数 > 15% | ipf-2026-bench |
| bench.hip_lift | 卧推 | 推起时臀部抬离凳面 | 髋 y 上升 / 躯干长 > 0.08 | ipf-2026-bench |
| bench.knee_angle | 卧推 | 脚位：膝角过大=脚太靠前，腿驱动弱 | 髋-膝-踝夹角中位数 | nsca-technique-4e（经验阈值 125°） |
| bench.grip_ratio | 卧推（正面） | 握距 / 肩宽 | 腕间距 / 肩关节间距 | green-comfort-2007、noteboom-2024（>1.5 风险升高） |
| *.bar_tilt | 正面 | 杠铃左右倾斜 | 左右腕 y 差 / 肩宽 | nsca-technique-4e |
| squat.depth_ipf | 深蹲 | 髋是否低于膝 | hip_y − knee_y，按股骨长归一化 | ipf-2026-squat、cs231n-2024 |
| squat.trunk_angle | 深蹲 | 到底时躯干前倾角 | 肩髋连线与垂线夹角 | schoenfeld-2010 |
| squat.knee_travel | 深蹲 | 膝前移（仅提示，非错误） | 膝 x 超出脚尖 / 小腿长 | fry-2003 |
| squat.heel_lift | 深蹲 | 脚跟抬起 | 脚跟 y 上升 / 小腿长 | ipf-2026-squat（脚不得移动） |
| squat.bar_path | 深蹲/硬拉 | 杠铃水平漂移 | 向心段杠铃 x 极差 / 股骨长 | nsca-technique-4e |
| squat.valgus | 深蹲（正面） | 膝内扣 | 到底时膝间距 / 踝间距 | schoenfeld-2010、escamilla-2001 |
| deadlift.hips_first | 硬拉 | 臀先起（早安式起杠） | 向心前 35% 时间里 髋上升量 / 肩上升量 | nsca-technique-4e、zatsiorsky-2021 |
| deadlift.lockout | 硬拉 | 锁定：膝、髋伸直，肩在杠后 | 顶部髋角/膝角 >165°，肩 x 在杠 x 之后 | ipf-2026-deadlift |
| deadlift.hyperextension | 硬拉 | 锁定时过度后仰 | 躯干后仰角 >15° | nsca-technique-4e |
| deadlift.bar_drift | 硬拉 | 杠铃离开脚中线 | 杠 x 与脚中线距离 / 小腿长 | nsca-technique-4e |
| *.downward_in_concentric | 全部 | 向心过程中杠铃下降（IPF 犯规） | 平滑后向心段 y 反向变化 | ipf-2026-* |
| *.eccentric_tempo | 全部 | 下放过快 | 离心时长 < 0.6s | wilk-2019 |
| *.rep_consistency | 全部 | 多次之间到底位置的一致性 | 到底 y 标准差 / 本组行程 < 5% | — |

## 通用动作模式（三大项以外）
| id 后缀 | 含义 | 依据 |
|---|---|---|
| `.rom` | 每次到达峰值时的关节角是否达到该模式的幅度标准（如弯举肘角 ≤ 65°、深蹲类膝角 ≤ 95°） | schoenfeld-grgic-2020, nsca-technique-4e |
| `.lockout` | 每次是否回到起始位（伸直 / 站直） | nsca-technique-4e |
| `.tempo` | 离心（下放或还原）时长 < 0.5 s 视为过快 | wilk-2019 |
| `.consistency` | 各次峰值关节角的标准差 | zatsiorsky-2021 |
| `.velocity_loss` | 最后一次发力用时 / 前两次平均 ≥ 1.5，接近力竭（info，不扣分） | sanchez-medina-2011 |
| `.swing` | 躯干与竖直方向夹角在动作中的变化范围（借力） | nsca-technique-4e |
| `.elbow_drift` | 上臂与躯干夹角的变化范围（弯举/下压时大臂是否固定） | nsca-technique-4e |
| `.body_line` | 肩—髋—踝偏离直线的角度，正 = 塌腰、负 = 撅臀 | nsca-technique-4e |
| `.valgus` / `.asymmetry` | 正面机位：膝内扣、左右关节角差 | escamilla-2001 |
| `hold.duration` | 静态支撑连续保持时长 | — |

计次用多路信号融合（两侧关节角 + 按肢段长度归一的位置量）+ ±5 秒局部归一化 + 迟滞阈值，所以半程次数也会被数到并由 `.rom` 标出。

<div align="center">

<img src="web/public/icons/icon-192.png" width="72" alt="LiftLens logo" />

# LiftLens

**拍一组，自动测量；用你自己的 AI 当教练点评，视频不离开你的设备。**

姿态识别、杠铃追踪和计次全部在浏览器里完成。教练点评由你选的 AI 完成：填自己的 key 调用云端 API，或者用电脑上已登录的 Claude Code / Codex。

[English](README.md) · 简体中文

[![License: MIT](https://img.shields.io/badge/license-MIT-c8ff3d.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg)

</div>

## 功能

- **浏览器里分析视频**：MediaPipe Pose 或 OpenMMLab RTMO（按需下载）、杠铃颜色追踪、自动分次，支持卧推 / 深蹲 / 硬拉的专项规则和动作库里 800 多个动作。所有阈值都按身体比例归一化，每条判定都附文献出处。
- **训练模式**：粘贴计划，每组拍一段（或打开摄像头实时计次、语音提示）。拍完在后台分析，组间休息时就能看到这一组的问题和下一组建议。
- **自带教练**：5 套教练 skill（IPF 裁判、NSCA-CSCS、东欧周期化、康复理疗师、大众健身），可以运行在：
  - **云端 API**，浏览器直接调用：Claude、OpenAI、Gemini、OpenRouter、通义千问、豆包、Kimi、硅基流动、DeepSeek 或任意 OpenAI 兼容接口；
  - **本地 agent**，在你的电脑上调用 Claude Code、Codex CLI、Gemini CLI、Qwen Code、OpenCode、Ollama 或 LM Studio。
- **本地优先**：训练记录和视频保存在浏览器的 IndexedDB，可以导出 / 导入 JSON 备份，可以添加到主屏幕。
- **能力曲线**：预估 1RM 和动作分趋势、反复出现的问题、每周肌肉图，以及 AI 生成的能力报告。

## 原理

程序负责**测量**，教练负责**判断**。两者分开，测量结果可以复现；教练还会结合叠加了骨架的关键帧，交叉核对程序的结果（比如手臂被杠铃片挡住时）。架构图见 [英文 README](README.md#how-it-works)。

## 快速开始

### 使用

打开线上站点或你自己部署的站点，在「AI 教练」里选择点评方式：

| | 需要 |
|---|---|
| **云端 API** | 任意一家支持的厂商的 API key，手机也能用 |
| **本地 agent** | 电脑上有 Node.js 20+ 和已登录的 Claude Code / Codex 等，运行页面上的那行 `npx` 命令。只能在同一台电脑的浏览器里用（网页直接访问 `127.0.0.1`） |

### 开发

```bash
git clone <本仓库> && cd liftlens
npm run setup   # 安装 web 和 agent 依赖
npm run dev     # 网页 http://localhost:5180 + 本地 agent 127.0.0.1:4517
```

本地开发不需要任何配置。`npm run web` 只启动网页，`npm run agent` 只启动本地 agent，`cd web && npx tsc -b && npm run lint` 做类型检查和 lint。

### 本地 agent 命令

```bash
npx -y <站点>/agent/liftlens-agent.tgz            # 启动并和浏览器配对
npx -y <站点>/agent/liftlens-agent.tgz install    # 后台运行、开机自启（macOS / Linux）
npx -y <站点>/agent/liftlens-agent.tgz use <id>   # 切换点评工具，例如 use qwen --key … --model …
```

## 部署

LiftLens 是部署在 Cloudflare Workers 上的静态站点。服务端只有一个很小的 Worker，作用是让缺失的 `/assets/*` 返回 404。没有后端：用户的 AI、key 和训练数据都不会经过你的部署。

```bash
cp .env.example .env          # 填 LIFTLENS_SITE（你的 workers.dev 或自定义域名）
npx wrangler login
scripts/deploy.sh
```

部署脚本还会把教练 skills 和带版本号的 agent 安装包一起发布到站点上，用户不需要 npm 账号就能用 `npx` 运行。用你的站点的人会在自己电脑上运行这个包，等于信任你部署的代码；不想这样的人可以 clone 仓库，用 `npm run agent` 自己跑。

## 隐私

- 视频和训练记录只保存在你的浏览器里。
- 每次点评只发送测量数据和几张关键帧（不含原视频）：云端 API 由浏览器直接发给厂商；本地 agent 发给你自己的电脑。
- API key 存在浏览器里（云端 API），或者存在电脑的 `~/.liftlens/config.json`，权限 0600（本地 agent）。
- 本地 agent 只监听 `127.0.0.1`，需要配对码，网络上访问不到，线上站点也接触不到它的流量。

## 局限

- 规则阈值主要用卧推侧拍视频校准，深蹲和硬拉还需要更多真实视频验证。
- 单机位 2D 角度在斜向机位下会受透视影响，细节判断交给教练结合关键帧核对。
- 数据只在一个浏览器里，清除站点数据或换浏览器会丢失，记得导出备份。

## 参与贡献

欢迎提 issue 和 PR。提交前请跑类型检查和 lint，代码注释请用英文，并说明你在什么设备和浏览器上测试过。

## 许可证

[MIT](LICENSE)。第三方许可证见 [NOTICE.md](NOTICE.md)。

> [!WARNING]
> LiftLens 提供的是训练反馈，不是医疗建议。量力而行，大重量请有保护或使用安全杠。

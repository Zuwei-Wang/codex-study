# Codex Study

[![CI](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml/badge.svg)](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) | 简体中文

**以本地存储为核心的 Codex 学习插件：资料版本管理、带引用笔记与明确记录的学习进度。**

通过 Codex 对话和八个学习 Skills 使用。TypeScript 核心、CLI 与本地 MCP 服务共用同一套逻辑，将课程、原始文件、来源证据和进度保存在你指定的工作区。没有独立图形应用；生成的 Markdown 导航和笔记也可以在 Codex 之外阅读。

## 当前状态

**M1–M3 已实现，采用 MIT 许可证，仍为开发预览版。** 可以从源码构建并安装本地插件，尚未发布到插件目录或 npm。当前开发版本另含 M4 提醒服务候选：本地预览、独立 HTTP 服务、合成邮件适配器和 Resend 接口；尚未部署，也未完成真实投递验收。

| 已实现                                              | 计划中，尚未实现                      |
| --------------------------------------------------- | ------------------------------------- |
| 可配置工作区、中英文导航和 IANA 时区                | 测试部署与真实提醒投递验收            |
| SHA-256 归档、历史版本、任务证据与日期冲突          | 更多学校平台适配器                    |
| 独立学习进度、SQLite 事务与完整性检查               | OCR、课件图像理解、PPTX/DOCX 内容读取 |
| Markdown/TXT 分节读取、保留原页码的 PDF 文本读取    | 自动备份恢复与更多平台支持            |
| 校验来源哈希、引用位置和原文的版本化笔记            | AI 教学质量的真实用户试用评估         |
| 22 个 MCP 工具、八个 Skills、本地插件安装与升级验证 | 公开插件目录分发                      |

运行 `npm run reminders:demo` 可查看明确标注的合成提醒演示。详见[提醒数据契约](docs/REMINDERS.md)、[服务运行说明](services/reminders/README.md)和[中文试用指南](docs/PILOT.zh-CN.md)。

M3 新增本地 ICS 导入、限定范围的 Blackboard Ultra/Minerva 观察候选，以及需要明确启用的每日检查进程。手动浏览器路径已做有限真实兼容性验证；无人值守运行仍需在用户配置的 CLI/浏览器环境中验收。详见[平台检查与调度](docs/PLATFORM_CHECKS.md)（英文）。

核心与记录 CLI 不调用 AI 模型；可选每日检查进程会调用用户配置的 Codex CLI。Codex 调用读取工具时，选中的资料文本会进入当前 Codex 会话；本地存储不意味着 AI 推理离线。虚构课程演示不需要学校账号。

## 运行虚构课程演示

支持的基准环境：**Node.js 24.21.0、npm 11.12.1**，macOS 或 Linux 本地文件系统。暂不支持 Windows、网络文件系统或同步盘。先通过版本管理器切换到固定 Node 版本：

```sh
git clone https://github.com/Zuwei-Wang/codex-study.git
cd codex-study
npm install --global npm@11.12.1
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-demo"
```

演示会重复导入原创虚构 Markdown 课件，保留两个变化版本，记录明确的学习进度，保留冲突日期，读取其中一节，并保存含引用和自测题的笔记。输出包括 `versions: 2`、`officialDeadlineState: "conflict"`、`recordedProgress: ["read"]`、`citedNote`、`navigation` 和 `doctor.ok: true`。重复运行不会产生重复版本、笔记或进度。验证时间戳反映实际导入时间。

如果工作区由 M1/M2 创建，请先执行下文的显式 `upgrade` 命令，再运行演示。

## 安装本地 Codex 插件

安装依赖并选定受支持的 Node 版本后：

```sh
npm run plugin:build -- build/marketplace-v0.4.0-dev.1
npx --no-install codex plugin marketplace add "$PWD/build/marketplace-v0.4.0-dev.1"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

构建会打包编译后的代码和适用于**当前系统及架构**的生产依赖，输出目录已存在时会拒绝覆盖。学习工作区应放在代码仓库和插件安装目录之外。上述命令使用固定版本 Codex CLI **0.144.4**，安装到正常 Codex 配置；自动化测试使用独立的临时配置。重启 Codex 或新建会话，并确保它的 PATH 中可使用 Node 24。

例如，对 Codex 说：

> 使用 Codex Study 的 setup skill。在[仓库之外的绝对路径]创建学习工作区，语言中文，时区 Europe/London，学年 2030/31。添加 DEMO101，课程名称 Imaginary Systems，使用 manual 适配器。

随后提供 `examples/demo-workspace/fixtures/v1/intro.md` 的绝对路径，要求以 `lecture-intro` 为来源 ID 导入，再使用课件学习 Skill 讲解第 2 节并保存带引用笔记。模型填写工具参数，不需要你手工编辑 JSON。

八个 Skills 分别负责初始化、资料更新、课前准备、课件学习、自测、每周复盘、课程平台检查与每日调度。课前准备使用导入课表及明确的课程映射，不会猜测某份课件对应哪次课。[安装、升级与故障排查](docs/INSTALLATION.md)（英文）说明了验证边界和手动 MCP 接入方法。

## 手动 CLI 操作

运行 `npm run build` 后，在仓库根目录执行：

```sh
npm run study -- init --workspace "$HOME/codex-study-demo" --config examples/demo-workspace/config.json
npm run study -- course --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/course.json
npm run study -- import --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/source.json --file examples/demo-workspace/fixtures/v1/intro.md
npm run study -- task --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/task.json
npm run study -- progress --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/progress.json
npm run study -- nav --workspace "$HOME/codex-study-demo"
npm run study -- doctor --workspace "$HOME/codex-study-demo"
```

`snapshot` 导出记录；`read` 读取指定归档版本；`note` 校验引用并使用版本冲突检查保存笔记。`attempt` 只记录调用者提供的部分检查或失败证据，不执行平台检查。详见[输入示例](examples/demo-workspace/README.md)（英文）。

关闭使用工作区的工具后，可明确升级 M1/M2 数据库到 schema 3：

```sh
npm run study -- upgrade --workspace "$HOME/codex-study-demo"
```

迁移通过事务新增缺失的笔记、课表、检查与调度表，保留配置、归档、记录与进度。旧 M1/M2 客户端不能读取 schema 3，暂不支持降级；迁移前请保留完整工作区备份。安装或更新插件不会自动迁移学习数据。

## 数据处理方式

- **存储：** `.study/records.sqlite` 保存结构化记录；`objects/` 保留原始文件；`notes/` 和 `navigation/` 保存不可变 Markdown 快照。真实学习工作区应位于代码仓库之外。
- **身份：** 通过课程 ID 和来源 ID 区分资料，不仅凭文件名合并。格式或资料类型变化时需要不同身份。支持归档 PDF、PPTX、Markdown、TXT 和 DOCX，每个文件上限 100 MiB。
- **读取：** 导入只复制字节。明确读取时先校验哈希，每次最多 20 页或节，每个单元最多返回 32,000 个字符，空内容和截断会被标记。PDF 只提取文本，不识别图表、布局或扫描件。PPTX/DOCX 暂时只归档。
- **笔记：** 引用绑定具体版本、真实页码或节号，以及匹配的原文。这证明可追溯性，不代表解释正确或确认课堂实际覆盖。来源更新保留旧笔记引用；冲突修改和被手工编辑的生成文件不会被覆盖。
- **日期与进度：** 官方日期、个人计划和反馈分别记录；冲突和未知时间继续显示。打开、阅读、起草、上传、提交、评分是独立且明确记录的状态。工具读取或保存笔记不会自动标记学习进度。
- **恢复：** 文件持久化后 SQLite 才引用它们，中断后可重试。`doctor` 报告缺失或损坏的归档、笔记与未引用残留，不自动删除内容。

仓库只包含原创虚构资料，不包含真实学校记录、浏览器状态或私有课表。资料文本属于不可信数据，不能授权执行命令或外部操作。

## 开发与验证

```sh
node scripts/ci.mjs
```

本地与托管 CI 共用此入口，运行锁定依赖安装、格式与 TypeScript 检查、行为测试、真实 Codex CLI 插件安装/MCP 操作/升级测试、公开内容检查、依赖审计和虚构课程演示。日志、提交和工具版本信息保存在被 Git 忽略的 `.cache/verification/`；Codex 验收证据位于 `.cache/codex-acceptance-*/`。

托管 CI 面向 Ubuntu 和 macOS。本地成功不等于 GitHub 必需检查成功。Codex 集成测试没有发起模型对话，也不评估教学质量或桌面 UI。详见[验证与托管 CI 回退规则](docs/VERIFICATION.md)（英文）。

## 项目结构

```text
packages/core/             记录、校验、SQLite、读取、笔记与导航
packages/cli/              调用 core 的轻量命令行入口
packages/mcp/              调用同一 core 的 22 个本地工具
plugins/codex-study/       插件模板、启动脚本与八个学习 Skills
packages/scheduler/        需要明确启用的本地每日检查进程
services/reminders/        独立运行的可选提醒服务
adapters/                  平台工作流支持边界
examples/demo-workspace/   原创虚构资料与可运行演示
tests/                     行为、CLI、MCP、恢复与一致性测试
scripts/                   验证、插件构建与公开内容检查
docs/                      安装、架构、路线与边界说明
```

以下文档目前为英文：[开发路线](docs/ROADMAP.md) · [架构](docs/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [公开内容边界](docs/OPEN_SOURCE_BOUNDARY.md) · [MIT 许可证](LICENSE)

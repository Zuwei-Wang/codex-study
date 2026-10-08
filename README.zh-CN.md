# Codex Study

[![CI](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml/badge.svg)](https://github.com/Zuwei-Wang/codex-study/actions/workflows/ci.yml)
[![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) | 简体中文

**以本地存储为核心的学习记录、资料版本管理与基于来源证据的任务导航。**

面向 Codex 的本地学习工作流。先可靠保存课程、课件版本、任务来源和个人进度，再逐步接入课前准备、课件学习、自测与复习。

## 当前状态

**M1 已实现本地核心与命令行工具（CLI）。** 本仓库是采用 MIT 许可证的早期开发预览版，尚不是可安装的 Codex 插件或托管应用。

| 已实现                                 | 计划中，尚未实现                 |
| -------------------------------------- | -------------------------------- |
| 可配置工作区、中英文导航、IANA 时区    | Codex MCP 服务与学习 Skills      |
| 手动导入、SHA-256 去重与历史版本保留   | 学校平台检查与 ICS 课表导入      |
| 来源身份、课程记录、任务证据与日期冲突 | PDF/PPTX 解析、AI 辅导与笔记生成 |
| 导入更新后仍保留的独立学习进度         | 定时检查与托管提醒               |
| SQLite 事务、中断恢复与完整性检查      | 自动备份与恢复、独立 UI          |

不需要学校账号即可运行演示。当前 CLI 不调用 AI、不访问学校网站、不发送通知；未来的 Codex 集成也不意味着 AI 推理完全离线。

## 运行虚构课程演示

支持的基准环境：**Node.js 24.21.0、npm 11.12.1**，macOS 或 Linux 的本地文件系统。暂不支持 Windows、网络文件系统或同步盘。请使用 Node 版本管理器按 `.node-version` 切换版本，再按需安装固定版本的 npm。

```sh
git clone https://github.com/Zuwei-Wang/codex-study.git
cd codex-study
npm install --global npm@11.12.1
npm ci --ignore-scripts
npm run demo -- "$HOME/codex-study-demo"
```

演示会在指定路径创建一个虚构学习工作区：导入 Markdown 课件、重复导入、导入同名但内容已变化的文件，保留两个版本，记录阅读进度，并保留两条相互冲突的官方日期。JSON 输出中包含生成的导航文件路径。

预期的关键结果：

```json
{
  "synthetic": true,
  "repeated": { "changed": false, "version": 1 },
  "versions": 2,
  "officialDeadlineState": "conflict",
  "recordedProgress": ["read"],
  "doctor": { "ok": true, "issues": [], "recoverableFiles": [] }
}
```

以上仅展示部分预期字段，实际输出还包括文件哈希和路径。再次运行演示会复用已有的两个版本。验证时间戳反映实际导入时间。所有演示内容均为原创虚构资料。

## 手动 CLI 操作流程

运行 `npm run build` 后，可在仓库根目录执行以下命令：

```sh
npm run study -- init --workspace "$HOME/codex-study-demo" --config examples/demo-workspace/config.json
npm run study -- course --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/course.json
npm run study -- import --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/source.json --file examples/demo-workspace/fixtures/v1/intro.md
npm run study -- task --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/task.json
npm run study -- progress --workspace "$HOME/codex-study-demo" --input examples/demo-workspace/progress.json
npm run study -- nav --workspace "$HOME/codex-study-demo"
npm run study -- doctor --workspace "$HOME/codex-study-demo"
```

`snapshot` 将完整记录导出为 JSON。`attempt` 为已有来源记录调用者明确提供的部分检查或失败观察结果，本身不执行平台检查。详见[演示操作说明](examples/demo-workspace/README.md)和[数据语义](docs/ARCHITECTURE.md)（英文）。

## 数据处理方式

- **本地工作区：** `.study/records.sqlite` 保存结构化记录；`.study/objects/` 保存原始文件字节；`.study/navigation/` 保存不可变的 Markdown 导航快照。真实学习工作区应放在代码仓库之外。
- **来源身份：** 使用课程 ID 和来源 ID 识别资料，不仅凭文件名合并。文件格式或资料类型变化时需要使用不同的来源身份。字节完全相同的文件可以共享底层存储，同时保留独立的来源记录。
- **来源证据：** 当前和历史版本均保留哈希、文件名、观察时间和来源引用。导入只复制原始字节，不执行或解析文档。支持归档 PDF、PPTX、Markdown、TXT 和 DOCX 文件，每个文件上限为 100 MiB。
- **日期：** 官方截止日期、个人计划和反馈日期分别记录。未知日期和仅有日期的值保留原有精度。相互冲突的官方记录会继续显示，不会悄悄选定其中一个。
- **进度：** 打开（opened）、阅读（read）、起草（drafted）、上传（uploaded）、提交（submitted）和评分（graded）是相互独立、需要明确记录的状态。导入文件或标记为已上传，不会自动变成已提交。
- **恢复：** 归档文件完成持久化后，SQLite 才会写入对它的引用。导入中断后可以重新运行。`doctor` 会报告损坏或缺失的归档，以及未被引用的残留文件，不会自动删除内容。生成导航时不会覆盖已被编辑的文件。

仓库不包含真实学校资料、账号、浏览器状态、私有课表链接或个人学习记录。M1 不依赖云端服务。

## 开发与验证

```sh
node scripts/ci.mjs
```

这是本地与托管 CI 共用的标准验证入口，会依次执行锁定依赖安装、格式检查、严格 TypeScript 检查、行为测试、公开内容检查、依赖安全审计和虚构课程演示。完整日志、工具版本和提交元数据写入已被 Git 忽略的 `.cache/verification/` 目录。

托管 CI 在 Ubuntu 和 macOS 上运行。本地验证成功不等于 GitHub 必需检查成功。[验证与托管 CI 不可用时的回退规则](docs/VERIFICATION.md)（英文）说明了允许使用回退机制的有限条件和证据要求。

## 项目结构

```text
packages/core/             类型化记录、校验、SQLite 存储与导航
packages/cli/              调用 core 的轻量命令行入口
packages/mcp/              计划中的本地 MCP 集成
plugins/codex-study/       计划中的插件与学习 Skills
adapters/                  计划中的平台与课表适配器
examples/demo-workspace/   原创虚构资料与可运行演示
tests/                     行为、CLI、中断恢复与 CI 一致性测试
scripts/                   共用验证流程与公开内容检查
docs/                      设计、路线图、验证与公开边界
```

以下文档目前为英文：[开发路线](docs/ROADMAP.md) · [架构说明](docs/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [公开内容边界](docs/OPEN_SOURCE_BOUNDARY.md) · [MIT 许可证](LICENSE)

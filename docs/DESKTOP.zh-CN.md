# Codex 桌面端安装

[English](DESKTOP.md)

桌面端包包含同一套本地核心、22 个 MCP 工具和 8 个 Skills。目前首次安装仍需终端，日常使用在桌面端对话中完成。安装不会启用邮件提醒或每日调度，也不会安装另一个独立图形应用。

## 在自己的电脑安装

准备 macOS/Linux、Git、**Node 24.21.0** 和 **npm 11.12.1**。桌面端后端已在 macOS 验证，Linux 桌面界面与 Windows 尚未验收。通过版本管理器选好 Node 后，在项目仓库执行：

```sh
npm ci --ignore-scripts
npm run plugin:build:desktop -- build/desktop-v0.4.0-dev.2
npx --no-install codex plugin marketplace add "$PWD/build/desktop-v0.4.0-dev.2"
npx --no-install codex plugin add codex-study@codex-study-local --json
```

这些命令向你正常使用的 Codex 配置注册本地市场并安装插件；同一台电脑的桌面端与 CLI 共用配置。保留已有配置、生成的市场目录和所选 Node 安装。构建目录已存在时会拒绝覆盖，请为新构建选择新目录；市场名称冲突时先检查原注册，不要直接删除其他配置。

桌面端构建会将 MCP 命令绑定到构建时 Node 的绝对路径，并使用受支持的 `.codex-plugin/plugin.json` 兼容入口。因此桌面应用不必继承终端的 PATH。机器路径只进入生成的本地包，不进入公开源码。每位用户应在自己的电脑构建，不要互传该包；移动或删除 Node 后需要重新构建、安装。

## 在桌面端验收

1. 完成正在运行的工作后重启桌面应用。在 **Plugins / 插件** 中选择 **Codex Study (local)**，确认 **Codex Study** 已安装并启用。它属于本地来源，不是公共插件目录中的条目。
2. 打开本地 Codex 对话，发送：“使用 Codex Study，调用 `study_capabilities`，告诉我支持哪些资料读取方式。如果 MCP 工具不可用，请报告错误，不要用终端命令代替。”只看到 Skills 不代表工具可用。
3. 使用 setup Skill，提供仓库和插件目录之外的绝对学习路径、语言、时区、学年和课程。首轮先用仓库原创虚构的 DEMO101，不放入私人学校资料。
4. 提供 `examples/demo-workspace/fixtures/v1/intro.md` 的实际绝对路径，请它导入、讲解第 2 节并保存带引用笔记。打开返回的 Markdown 文件，再调用 `study_doctor`。以实际工具结果为准，不能只凭模型说“完成了”。

在[反馈模板](pilot-feedback-template.md)中记录桌面版本、系统、源码提交、发现的能力、工具结果和错误。讲解是否有帮助仍需真人评价。

## 已验证范围与排错

2026-10-13，在 macOS 桌面应用 **26.1007.30912（20156）** 自带的 **0.162.0-alpha.17.2** 后端中，桌面包通过了隔离 app-server 验收：安装、发现 8 个 Skills 和 22 个工具、初始化、导入、读取、引用笔记、进度和升级保留。测试的 PATH 中没有 Node。该后端读取通用根清单时能发现 Skills，却漏掉本地 stdio 服务；兼容清单可发现两者。原有 CLI 打包方式继续保留。

这证明随桌面应用附带的后端可运行该包，尚不代表桌面界面已完整验收。自动化工具不允许控制该应用，因此重启后可见的插件状态和真实桌面对话仍需用户确认；没有把后端测试当作模型教学质量或独立用户试用结果。

- **有 Skills、没有工具：** 使用桌面构建，确认生成的 `.mcp.json` 所指 Node 仍存在，重启并查看启动错误。不要直接安装未构建的源码模板。
- **Node 路径改变：** 选定 Node 24 后重新构建、安装，无需修改系统全局 PATH 或其他 MCP 服务。
- **远程或云端对话：** 本机安装不会将插件或学习数据自动部署到其他主机。
- **卸载：** 在插件页面卸载 Codex Study；保留独立的学习目录。移除市场注册和卸载插件是两件事。

官方依据：[本地插件与市场](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)、[桌面端与 CLI 共用 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)。更多内容见[安装与升级](INSTALLATION.md)。

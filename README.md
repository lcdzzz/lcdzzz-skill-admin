# 本地 Skill 管理器

**手上装了一堆 Agent，Skill 却散落在各自的目录里，管起来很麻烦。这个工具用一个本地网页把它们收进一张列表。**

Claude Code、Codex、Cursor、WorkBuddy……每个 Agent 都有自己的 `skills/` 目录，散在家目录和项目目录里。想找一个 Skill 要靠 `ls` 和记忆；想改一句 `description`，得先摸清那个深层路径；改完还不知道这段时间里文件有没有被别的东西动过。

本地 Skill 管理器就是解决这件事的：**登记 Skill 根目录，然后在一个页面里搜索、查看、编辑、创建 `SKILL.md`**，不用记路径，也不用敲命令。

它只做管理，不做接管：不物理删除任何 Skill，不修改任何 Agent 的配置，不联网、不登录、不建数据库。**文件系统始终是 Skill 的唯一真实来源**，管理器只在项目目录的 `.skill-manager/` 里保存自己的登记信息和操作记录。

## 它解决的四个具体麻烦

| 麻烦 | 平时怎么做 | 用了它之后 |
| --- | --- | --- |
| **找不到**：Skill 分散在多个 Agent 目录 | 靠记忆和 `ls`，或者临时写脚本 `find` | 目录登记一次，所有 Skill 一屏列出；支持名称/描述关键词搜索、按来源目录筛选、按修改时间排序 |
| **不敢改**：手改 `SKILL.md` 没有退路 | 用编辑器打开深层路径，改坏了只能靠 git 兜底 | 内置 Markdown 编辑器；保存前比对文件指纹，文件被外部改过会被拦下，由你决定"读盘"还是"确认覆盖"；写入走临时文件原子替换，失败不破坏原文件 |
| **建得乱**：新建 Skill 靠复制别人的目录 | 复制粘贴 + 手写 front matter，格式各写各的 | 结构化表单（`name` / `description` / when to use / instructions）生成标准 `SKILL.md`，提交前可预览并直接改；可一次写入多个登记目录，目标重名直接拒绝而不是覆盖 |
| **查不到**：出了事不知道谁在什么时候动过 | 没有记录 | 创建、读取、修改、复制、同步都写进 `.skill-manager/operations.json`，失败原因和多目录操作结果一并记录 |

## 特点

- **不侵入**：只读写已登记目录内的文件，不碰 Agent 配置，不做卸载、软禁用这类动作
- **中文友好**：`description` 是英文时保留原文展示，你填写的中文简介会回写到 `SKILL.md` 的 front matter
- **异常隔离**：某个 Skill 的 YAML 坏了只影响它自己，列表照常出，错误信息直接显示在页面上
- **统一管理**：不同目录中 `name` 相同的 Skill 聚合为一条记录；可设置默认目录，保存主 Skill 后自动同步已存在副本，冲突不会被悄悄覆盖
- **安全默认值**：只监听 `127.0.0.1`；校验 `Host` 和 `Origin`，拒绝跨站请求；所有路径经 `realpath` 校验，越界和符号链接逃逸一律拒绝
- **轻量**：单机 Node.js 服务 + 静态前端，不需要数据库、不需要登录、不需要云

## 快速开始

### 方式一：下载预构建包

从 GitHub Releases 下载与你的系统和 CPU 架构对应的压缩包，解压后运行。

macOS：

```sh
chmod +x start.sh
./start.sh
```

Windows：双击 `start.cmd`。

启动脚本会检查 Node.js 版本、启动服务并自动打开浏览器。预构建包已包含前端文件、编译后的后端和生产依赖，不需要 pnpm；仍然需要 Node.js 20.19 或更高版本。

### 方式二：从源码运行

```sh
corepack enable
pnpm install
pnpm build
pnpm start
```

开发模式：

```sh
pnpm dev
```

默认地址 <http://127.0.0.1:8787>，可以用 `PORT=8788 pnpm dev` 覆盖端口。

### 第一次使用

首次启动是**空的**：不预置任何目录，也不会自动扫描。展开列表页的「目录管理」，输入你希望管理的 Skill 根目录并登记，之后才会扫描。

一个登记目录下的**直接子目录**，只要含有 `SKILL.md`，就会被识别为一个 Skill。

如果登记目录本身直接包含 `SKILL.md`，也会被识别为根 Skill；根 Skill 使用 front matter 的 `name` 与其他登记目录中的根 Skill 匹配。

### 上哪儿找我的 Skill 目录

`SKILL.md` 现在是跨工具的开放格式，支持的 Agent 已经不止一家，而目录名各家各用各的——这正是「Skill 管理起来麻烦」的根源之一。下表是常见约定位置：

> ⚠️ 下表整理于 2026-09，生态变化很快，**请以你本机实际安装位置为准**；目录不存在时，新建一个即可。少数产品（如豆包 App）把技能放在账号里、不走文件系统，见表格下方的说明。

**主流 Agent**

| Agent | 用户级（全局） | 项目级 |
| --- | --- | --- |
| **通用约定** | `~/.agents/skills` | `.agents/skills` |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Codex CLI | `~/.codex/skills` | `.codex/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| GitHub Copilot | `~/.copilot/skills` | `.github/skills` |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` |
| WorkBuddy（腾讯） | `~/.workbuddy/skills` | `.workbuddy/skills` |
| CodeBuddy（腾讯） | `~/.codebuddy/skills` | `.codebuddy/skills` |
| 豆包工作 DoubaoWork（字节） | `~/.super_doubao/super-doubao-runtime/workspace/.user_skills` | — |
| Trae（字节） | `~/.trae/skills` | `.trae/skills` |
| Qoder（阿里） | `~/.qoder/skills` | `.qoder/skills` |
| QoderWork（阿里） | `~/.qoderwork/skills` | — |

<details>
<summary>展开：更多 Agent（Windsurf、Cline、Roo Code、Kiro、OpenCode、Qwen Code、Comate、iFlow、Continue 等）</summary>

| Agent | 用户级（全局） | 项目级 |
| --- | --- | --- |
| Windsurf | `~/.codeium/windsurf/skills` | `.windsurf/skills` |
| Cline | `~/.cline/skills` | `.cline/skills` |
| Roo Code | `~/.roo/skills` | `.roo/skills` |
| Kiro CLI | `~/.kiro/skills` | `.kiro/skills` |
| Trae CN | `~/.trae-cn/skills` | `.trae/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| Qwen Code | `~/.qwen/skills` | `.qwen/skills` |
| QwenWork（千问办公） | `~/.qwenworkcn/skills` | — |
| Comate / 文心快码（百度） | `~/.comate/skills` | `.comate/skills` |
| iFlow CLI | `~/.iflow/skills` | `.iflow/skills` |
| Continue | `~/.continue/skills` | `.continue/skills` |
| Amp / Kimi Code CLI | `~/.config/agents/skills` | `.agents/skills` |
| Droid（Factory） | `~/.factory/skills` | `.factory/skills` |
| Goose | `~/.config/goose/skills` | `.goose/skills` |
| Crush | `~/.config/crush/skills` | `.crush/skills` |
| Kilo Code | `~/.kilocode/skills` | `.kilocode/skills` |
| Junie | `~/.junie/skills` | `.junie/skills` |
| OpenHands | `~/.openhands/skills` | `.openhands/skills` |
| OpenClaw | `~/.openclaw/skills` | `.openclaw/skills` |
| Command Code | `~/.commandcode/skills` | `.commandcode/skills` |
| Mistral Vibe | `~/.vibe/skills` | `.vibe/skills` |

</details>

**不走文件系统的 Agent（登记不了，别白找）**

| Agent | 说明 |
| --- | --- |
| 豆包（App / 网页端） | 技能走账号体系：在「工作」界面用「技能 → 新建 → 上传技能」装压缩包，或用 `/创建技能` 指令创建，安装后绑定账号。**没有 `~/.doubao/skills` 这类目录**，不要去找。桌面上安装回执里显示的 `workspace/.user_skills/<技能名>/` 是平台工作区内的路径，不是你能直接登记的本地目录 |
| 百度 DuMate | 技能在 App 内管理，通过上传 `.zip` 安装，无本地目录 |

> 💡 **小技巧**：`~/.agents/skills`（以及项目内的 `.agents/skills`）是多家 Agent 共同识别的**通用别名**，Cursor、Gemini CLI、Codex CLI、GitHub Copilot 等都会读它。把 Skill 放在这里，再登记这一个目录，往往一次就能覆盖手上大部分 Agent，不必给每家各拷一份。注意 Claude Code 是例外——它只认自己的 `~/.claude/skills`。
>
> 三处细节：Cursor 还会为兼容读取 `.claude/skills`、`.codex/skills` 及对应用户级目录；Gemini CLI 在同一层级里，`.agents/skills` 的优先级高于 `.gemini/skills`；豆包工作的 Windows 路径是 `%LOCALAPPDATA%\DoubaoWork\User Data\Default\.doubaowork\agent_mode\workspace\.user_skills`。

## 功能现状

### 已经可用

| 能力 | 说明 |
| --- | --- |
| 多目录登记 | 支持 `~` 展开；重复或互相包含的目录会被拒绝；目录不可用时保留登记并给出提示 |
| 扫描与列表 | 扫描登记目录的直接子目录；相同 `name` 的 Skill 聚合展示，并显示使用目录数量 |
| 检索 | 名称/描述关键词搜索、来源目录筛选、修改时间升序或降序 |
| 查看详情 | 读取 `SKILL.md` 全文，返回内容指纹用于冲突判断 |
| 编辑保存 | 内置 Markdown 编辑器；可设置默认目录作为唯一编辑源，保存后同步已存在副本；中文简介回写 front matter；外部修改冲突检测与强制覆盖 |
| 创建 Skill | 结构化表单生成标准 `SKILL.md`，可预览后手改；支持多个目标目录，重名拒绝并回滚已创建目录 |
| 目录管理 | 登记、移除登记（移除不删除磁盘文件） |
| 操作记录 | `.skill-manager/operations.json` 记录创建、读取、修改及其结果 |

### 尚未实现

以下能力在需求与设计文档中已经确认，但当前代码**还没有实现**，暂时不要指望：

- 收藏、标签、软禁用
- 批量收藏、批量软禁用等批量操作
- 保存前自动备份（保留最近 10 份）与撤销最近一次保存
- 辅助文件（`scripts/`、`references/` 等）的只读浏览
- 一键调用外部编辑器打开 Skill 文件
- 登记目录时提示常见 Agent 的目录（设计里已定：把通用目录 `~/.agents/skills` 排在首位推荐）

## 路线图（Roadmap）

上一节是「已确认、待补齐」；这里放方向上想做、但还没细化的，**属于设想，不是承诺**：

**1. 让「没有目录」的 Agent 也能管起来**

豆包 App、百度 DuMate 这类产品把技能放在账号或应用内部，本地没有可登记的目录（见上文「不走文件系统的 Agent」）。计划加一个**打包导出**能力：把选中的 Skill 导出成 `.zip`（或平台要求的 `.md` 安装包）并附一份清单，由你手动上传到对应平台。同一份内容，本地能管、平台能装。

**2. 明确不做的**

物理删除、完整 Git 历史、云同步、多用户与权限、数据库、文件实时监听、全文检索，在设计阶段就划成了非目标，不会为了它们往代码里塞复杂度。架构上只预留两个扩展点：**来源适配器**（将来接远程来源）和 **存储层实现**（将来换掉 JSON 文件）。

## 数据、安全与边界

- 运行时状态在项目目录的 `.skill-manager/`：目录登记、状态文件和操作记录。该目录已在 `.gitignore` 中，也不会进入预构建包
- 应用**只允许**访问已登记 Skill 根目录内的文件和自己的状态目录，路径经 `realpath` 校验后再判断是否越界
- **不提供物理删除**：只能移除目录登记，磁盘上的文件保留
- 写文件采用「临时文件 + 原子替换」，保留原文件权限，尽量避免半写状态
- 元数据 JSON 带结构校验，损坏时拒绝写入而不是覆盖掉损坏内容
- 服务只监听回环地址 `127.0.0.1`，不提供远程访问能力；非本机 `Host` 或跨站 `Origin` 的请求会被直接拒绝
- 环境变量：`PORT`（默认 `8787`）、`SKILL_MANAGER_ROOT`（状态目录所在的根路径，预构建包的启动脚本会自动设置）

## 环境要求

- Node.js 20.19 或更高版本
- 源码运行需要 pnpm
- macOS 支持 Apple Silicon 和 Intel，Windows 支持 x64，Linux 支持源码运行，暂不提供预构建包

## 项目结构

```text
src/                 React 前端
server/              Express 后端源码
tests/               接口测试
scripts/             跨平台启动脚本与打包脚本
build/server/        后端编译产物（本地构建生成）
dist/                前端构建产物（本地构建生成）
```

## 开发命令

```sh
pnpm test
pnpm build
pnpm format:check
```

## 许可证

[MIT License](./LICENSE)

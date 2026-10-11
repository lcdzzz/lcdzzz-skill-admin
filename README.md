# 本地 Skill 管理器

**手上装了一堆 Agent，Skill 却散落在各自的目录里，管起来很麻烦。这个工具用一个本地网页把它们收进一张列表。**

Claude Code、Codex、Cursor、WorkBuddy……每个 Agent 都有自己的 `skills/` 目录，散在家目录和项目目录里。想找一个 Skill 要靠 `ls` 和记忆；想改一句 `description`，得先摸清那个深层路径；改完还不知道这段时间里文件有没有被别的东西动过。

本地 Skill 管理器就是解决这件事的：**登记 Skill 根目录，然后在一个页面里搜索、查看、编辑、创建 `SKILL.md`**，不用记路径，也不用敲命令。

它只做管理，不做接管：不物理删除任何 Skill，不修改任何 Agent 的配置，不登录、不建数据库。**文件系统始终是 Skill 的唯一真实来源**，管理器只保存自己的登记信息和操作记录。

## 它解决的四个具体麻烦

| 麻烦 | 平时怎么做 | 用了它之后 |
| --- | --- | --- |
| **找不到**：Skill 分散在多个 Agent 目录 | 靠记忆和 `ls`，或者临时写脚本 `find` | 目录登记一次，所有 Skill 一屏列出；支持名称/描述关键词搜索、按来源目录筛选、按修改时间排序 |
| **不敢改**：手改 `SKILL.md` 没有退路 | 用编辑器打开深层路径，改坏了只能靠 git 兜底 | 内置 Markdown 编辑器；保存前比对文件指纹，文件被外部改过会被拦下，由你决定"读盘"还是"确认覆盖"；写入走临时文件原子替换，失败不破坏原文件 |
| **建得乱**：新建 Skill 靠复制别人的目录 | 复制粘贴 + 手写 front matter，格式各写各的 | 结构化表单（`name` / `description` / when to use / instructions）生成标准 `SKILL.md`，提交前可预览并直接改；可一次写入多个登记目录，目标重名直接拒绝而不是覆盖 |
| **查不到**：出了事不知道谁在什么时候动过 | 没有记录 | 创建、读取、修改、复制、同步都写进 `.skill-manager/operations.json`，失败原因和多目录操作结果一并记录 |
| **不好分享**：Skill 散在本机目录 | 手工找目录再压缩 | 勾选 Skill 导出 ZIP；朋友单独获取管理器，通过「导入分享包」直接安装 |

## 特点

- **不侵入**：只读写已登记目录内的文件，不碰 Agent 配置，不做卸载、软禁用这类动作
- **中文友好**：`description` 是英文时保留原文展示，你填写的中文简介会回写到 `SKILL.md` 的 front matter
- **异常隔离**：某个 Skill 的 YAML 坏了只影响它自己，列表照常出，错误信息直接显示在页面上
- **统一管理**：不同目录中 `name` 相同的 Skill 聚合为一条记录；可设置默认目录，保存主 Skill 后自动同步已存在副本，冲突不会被悄悄覆盖
- **安全默认值**：只监听 `127.0.0.1`；校验 `Host` 和 `Origin`，拒绝跨站请求；所有路径经 `realpath` 校验，越界和符号链接逃逸一律拒绝
- **轻量**：单机本地服务 + 静态前端，不需要数据库、不需要登录、不需要云；macOS app 内置运行时

## 用户使用指南

### 下载和启动

从 GitHub Releases 下载与你的系统和 CPU 架构对应的发行包。macOS 提供 Apple Silicon 和 Intel 版本，Windows 支持 x64。Windows 发行包内置运行时，无需安装 Node.js 或 pnpm。

macOS：当前 Release 中的 `.tar.gz` 需要系统 Node.js 20.19+，解压后运行 `./start.sh`。如果所选 Release 提供 `.dmg`，打开后把 **Skill Manager** 拖到 **Applications**，再从应用程序中启动；DMG 内置 Node.js 和原生窗口。使用 ad hoc 签名、未经 Developer ID 公证的 DMG 首次运行可能显示开发者身份提示，按住 Control 点击 app，选择「打开」即可继续。

Windows x64：

- **独立窗口版（EXE）**：下载 `skill-manager-v版本-windows-x64.exe`，放到普通可写文件夹，双击打开。自带 Node 和界面运行环境，无需安装依赖或手工解压。关闭窗口会停止服务；再次双击会唤起已有窗口。
- **浏览器版（ZIP）**：下载 Windows 压缩包，解压后双击 `start.cmd`。压缩包自带 Node.js，不需要安装 Node 或 pnpm。

EXE 版的数据保存在 EXE 旁边的 `.skill-manager/` 文件夹，桌面缓存保存在其 `desktop-profile/` 子目录。升级时先退出旧版，把旧 `.skill-manager/` 复制到新 EXE 所在目录；也可以把新 EXE 放到旧数据所在目录。数据目录不要放在程序临时展开目录里。

Windows ZIP 的启动脚本会启动服务并打开浏览器；EXE 直接打开独立窗口。需要从源码运行时，见文末的「开发」章节。

### 第一次使用

首次启动是**空的**：不预置任何目录，也不会自动扫描。展开列表页的「目录管理」，输入你希望管理的 Skill 根目录并登记，之后才会扫描。

一个登记目录下的**直接子目录**，只要含有 `SKILL.md`，就会被识别为一个 Skill。

如果登记目录本身直接包含 `SKILL.md`，也会被识别为根 Skill；根 Skill 使用 front matter 的 `name` 与其他登记目录中的根 Skill 匹配。

### 导出 Skill 给朋友

在列表中勾选要分享的 Skill，点击「导出分享包」→「预览文件清单」→「下载 ZIP」。普通 Skill 会打包默认来源的完整目录；根 Skill 只打包 `SKILL.md`。同名 Skill 的其他副本不会重复打包。

ZIP 内是 `skills/` 文件夹和一份安装说明，不包含管理器程序或 `.skill-manager/` 状态。ZIP 条目名称不包含本机绝对路径；Skill 文件内容按原样打包。`.env`、私钥等常见私有文件及 `node_modules` 等生成文件会被排除；符号链接会使导出失败。下载前仍请检查清单和 Skill 内容，确认没有其他不想分享的信息。导出限制为最多 100 个 Skill、1000 个文件、100 MB。

### 导入朋友分享的 Skill

朋友单独获取支持导入的管理器后，在「目录管理」中登记自己的本地 Skill 根目录。然后点击「导入分享包」，选择收到的 ZIP 和目标目录，点击「预览导入」。可以查看每个 Skill 的指令、文件清单和安装位置，再点击「开始导入」，完成后列表会自动刷新。

新 Skill 默认导入；同名目录默认跳过，也可以明确选择「覆盖同名文件，保留本地独有文件」。已有目标包含符号链接、特殊文件或路径类型冲突时只能跳过。预览后本地文件改变会阻止导入，需重新预览。

导入兼容本管理器之前导出的 `skills/` 结构分享包，不需要手动解压或替换文件。损坏 ZIP、越界路径、重复路径和 ZIP 符号链接会被拒绝。安装按 Skill 分别处理并显示成功、跳过或失败；某个 Skill 安装失败会恢复该 Skill 的原目录，新 Skill 则移除未完成的安装。预览保留 15 分钟，重启管理器后需重新选择分享包。

### 上哪儿找我的 Skill 目录

以下目录表覆盖常见的桌面 Agent、IDE 插件和 CLI，分别列出 **Windows 和 macOS 用户级目录**，以及**项目级目录**。核对日期：**2026-10-12**。产品版本、自定义配置和运行环境可能改变实际位置；先找到已有的 `SKILL.md`，再登记它的 Skill 根目录。

#### 先看懂路径

- **用户级（全局）**：同一用户的多个项目共用。Windows 的 `%USERPROFILE%` 通常是 `C:\Users\你的用户名`；macOS 的 `~` 通常是 `/Users/你的用户名`。
- **项目级**：相对于你在 Agent 中打开的项目根目录。表格统一用 `/` 表示分隔符；例如 `.claude/skills` 在 Windows 是 `D:\我的项目\.claude\skills`，在 macOS 是 `/Users/你的用户名/我的项目/.claude/skills`。
- **登记根目录**：填 `skills` 文件夹本身，例如 `C:\Users\你的用户名\.claude\skills`，它下面应有 `技能名\SKILL.md`；不要把 Agent 安装目录当成 Skill 目录。
- **管理器输入框**：支持 `~` 和 `~/` 展开，但目前不展开 `%USERPROFILE%`、`%LOCALAPPDATA%` 或 `$HOME`。Windows 请从资源管理器复制完整路径，或使用 `~/.claude/skills` 这种写法。
- **WSL / SSH / 容器**：以 Agent 实际运行环境的用户主目录为准。Windows 上的 WSL 技能通常在 Linux 的 `/home/用户名/...` 中，不能直接用 `%USERPROFILE%` 换算；在资源管理器里通过 `\\wsl.localhost\发行版名称\home\用户名` 查找。

#### 主流工具目录（Windows / macOS）

工具名称链接到目录说明来源。`—` 表示该来源没有列出项目级目录，不能据此假定某个路径会被工具读取。

| Agent | Windows 用户级（全局） | macOS 用户级（全局） | 项目级目录（相对项目根目录） |
| --- | --- | --- | --- |
| 通用共享目录 | `%USERPROFILE%\.agents\skills` | `~/.agents/skills` | `.agents/skills` |
| [Claude Code](https://code.claude.com/docs/en/skills) | `%USERPROFILE%\.claude\skills` | `~/.claude/skills` | `.claude/skills` |
| [Codex（当前官方本地发现目录）](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) | `%USERPROFILE%\.agents\skills` | `~/.agents/skills` | `.agents/skills` |
| [Cursor](https://cursor.com/help/customization/skills) | `%USERPROFILE%\.cursor\skills`，也读 `%USERPROFILE%\.agents\skills` | `~/.cursor/skills`，也读 `~/.agents/skills` | `.cursor/skills`、`.agents/skills` |
| [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) | `%USERPROFILE%\.copilot\skills` 或 `%USERPROFILE%\.agents\skills` | `~/.copilot/skills` 或 `~/.agents/skills` | `.github/skills`、`.agents/skills`、`.claude/skills` |
| [Gemini CLI](https://geminicli.com/docs/cli/using-agent-skills/) | `%USERPROFILE%\.gemini\skills` 或 `%USERPROFILE%\.agents\skills` | `~/.gemini/skills` 或 `~/.agents/skills` | `.gemini/skills`、`.agents/skills` |
| [Antigravity 2.0 / IDE](https://www.antigravity.google/docs/skills?tab=ide) | `%USERPROFILE%\.gemini\config\skills` | `~/.gemini/config/skills` | `.agents/skills`；兼容 `.agent/skills` |
| [Antigravity CLI](https://www.antigravity.google/docs/skills?tab=ide) | `%USERPROFILE%\.gemini\antigravity-cli\skills` | `~/.gemini/antigravity-cli/skills` | `.agents/skills` |
| [Windsurf / Devin Desktop](https://docs.windsurf.com/windsurf/cascade/skills) | `%USERPROFILE%\.codeium\windsurf\skills` 或 `%USERPROFILE%\.config\devin\skills` | `~/.codeium/windsurf/skills` 或 `~/.config/devin/skills` | `.devin/skills`；兼容 `.windsurf/skills` |
| [Cline](https://docs.cline.bot/features/skills) | `%USERPROFILE%\.cline\skills` | `~/.cline/skills` | `.cline/skills` |
| [Roo Code](https://docs.roocode.com/features/skills) | `%USERPROFILE%\.roo\skills` 或 `%USERPROFILE%\.agents\skills` | `~/.roo/skills` 或 `~/.agents/skills` | `.roo/skills`、`.agents/skills` |
| [Kilo Code](https://kilo.ai/docs/customize/skills) | `%USERPROFILE%\.kilo\skills` 或 `%USERPROFILE%\.agents\skills` | `~/.kilo/skills` 或 `~/.agents/skills` | `.kilo/skills`、`.agents/skills` |
| [Kiro（IDE / CLI）](https://kiro.dev/docs/skills/) | `%USERPROFILE%\.kiro\skills`（原生 IDE；WSL 中的 CLI 按 Linux 主目录查找） | `~/.kiro/skills` | `.kiro/skills` |
| [OpenCode](https://opencode.ai/docs/skills) | `%USERPROFILE%\.config\opencode\skills` | `~/.config/opencode/skills` | `.opencode/skills`、`.agents/skills`、`.claude/skills` |
| [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html) | `%USERPROFILE%\.kimi-code\skills` 或 `%USERPROFILE%\.agents\skills` | `~/.kimi-code/skills` 或 `~/.agents/skills` | `.kimi-code/skills`、`.agents/skills` |
| [WorkBuddy（常见本地约定，见下文的版本说明）](https://github.com/yxdwind/agent-skill-manager#支持的产品) | `%USERPROFILE%\.workbuddy\skills` | `~/.workbuddy/skills` | `.workbuddy/skills`（需确认当前版本已加载） |
| [CodeBuddy（腾讯）](https://www.codebuddy.cn/docs/cli/skills) | `%USERPROFILE%\.codebuddy\skills` | `~/.codebuddy/skills` | `.codebuddy/skills` |
| [TRAE / TraeCode 国内版](https://docs.trae.cn/cli_skills) | `%USERPROFILE%\.trae-cn\skills` | `~/.trae-cn/skills` | `.trae/skills` |
| [TraeCode CLI](https://docs.trae.cn/cli_skills) | `%USERPROFILE%\.traecli\skills` | `~/.traecli/skills` | `.traecli/skills`；也兼容 TraeCode 的目录 |
| [Qoder CLI](https://docs.qoder.com/cli/Skills) | `%USERPROFILE%\.qoder\skills` | `~/.qoder/skills` | `.qoder/skills` |
| [QoderWork](https://docs.qoder.com/qoderwork/skills) | `%USERPROFILE%\.qoderwork\skills` | `~/.qoderwork/skills` | — |
| [OpenClaw](https://docs.openclaw.ai/tools/skills) | `%USERPROFILE%\.openclaw\skills` | `~/.openclaw/skills` | 实际 Agent 工作区的 `skills` 或 `.agents/skills`，不是 `.openclaw/skills` |

**旧版、兼容目录和自定义配置：**

- **Codex**：既有安装中还可能有 Windows `%USERPROFILE%\.codex\skills`、macOS `~/.codex/skills`，以及自定义 `CODEX_HOME` 下的 `skills`。这些目录可能保存旧版手动安装或内置技能；当前官方本地发现文档列出的用户级和项目级目录是 `.agents/skills`。管理既有文件时可登记实际目录，新建技能时按当前版本的发现规则选择位置。
- **Cursor**：还兼容项目内和用户主目录下的 `.claude/skills`、`.codex/skills`。[兼容目录说明](https://cursor.com/help/customization/skills)
- **Antigravity IDE**：还兼容 Windows `%USERPROFILE%\.gemini\antigravity\skills`、macOS `~/.gemini/antigravity/skills`。[版本目录说明](https://www.antigravity.google/docs/skills?tab=ide)
- **OpenCode、Amp、Goose 等**：设置 `XDG_CONFIG_HOME` 后，表中 `.config` 对应的位置可能改变；不要把 Windows `%APPDATA%` 或 macOS `~/Library/Application Support` 当成它们统一的 Skill 默认目录。[跨平台安装器的路径实现](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)
- **Claude Code / Kimi Code CLI / OpenClaw**：自定义配置主目录、`KIMI_CODE_HOME`、OpenClaw profile / state directory 或额外 Skill 路径时，实际目录以该工具的配置和已加载 Skill 路径为准。

<details>
<summary>展开：更多工具和桌面产品的 Windows / macOS 目录</summary>

以下路径参考兼容安装工具的实际目录映射：[Vercel Skills 安装器](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)和[国内 Agent Skill Manager](https://github.com/yxdwind/agent-skill-manager#支持的产品)。这些映射是查找线索，不等于各产品官方对所有版本的保证。Windows 列按原生进程的用户主目录换算；工具在 WSL 中运行时，请按上文的 WSL 说明查找。

| Agent | Windows 用户级（全局） | macOS 用户级（全局） | 项目级目录（相对项目根目录） |
| --- | --- | --- | --- |
| TRAE 国际版 | `%USERPROFILE%\.trae\skills` | `~/.trae/skills` | `.trae/skills` |
| TRAE SOLO 国内版 | `%USERPROFILE%\.trae-cn\skills` | `~/.trae-cn/skills` | `.trae/skills`（与国内版共用的目录约定） |
| Qoder 国内版 | `%USERPROFILE%\.qoder-cn\skills` | `~/.qoder-cn/skills` | `.qoder/skills` |
| Qwen Code | `%USERPROFILE%\.qwen\skills` | `~/.qwen/skills` | `.qwen/skills` |
| QwenWork / 千问办公 | `%USERPROFILE%\.qwenworkcn\skills` | `~/.qwenworkcn/skills` | — |
| Comate / 文心快码 | `%USERPROFILE%\.comate\skills` | `~/.comate/skills` | —（暂未核实项目级路径） |
| iFlow CLI | `%USERPROFILE%\.iflow\skills` | `~/.iflow/skills` | `.iflow/skills` |
| Continue | `%USERPROFILE%\.continue\skills` | `~/.continue/skills` | `.continue/skills` |
| Amp | `%USERPROFILE%\.config\agents\skills` | `~/.config/agents/skills` | `.agents/skills` |
| Droid（Factory） | `%USERPROFILE%\.factory\skills` | `~/.factory/skills` | `.factory/skills`；兼容安装器使用 `.agents/skills` |
| Goose | `%USERPROFILE%\.config\goose\skills` | `~/.config/goose/skills` | `.goose/skills` |
| Crush | `%USERPROFILE%\.config\crush\skills` | `~/.config/crush/skills` | `.crush/skills` |
| Junie | `%USERPROFILE%\.junie\skills` | `~/.junie/skills` | `.junie/skills` |
| OpenHands | `%USERPROFILE%\.openhands\skills` | `~/.openhands/skills` | `.openhands/skills` |
| Command Code | `%USERPROFILE%\.commandcode\skills` | `~/.commandcode/skills` | `.commandcode/skills` |
| Mistral Vibe | `%USERPROFILE%\.vibe\skills`（WSL 使用 Linux 主目录） | `~/.vibe/skills` | `.vibe/skills` |
| Augment | `%USERPROFILE%\.augment\skills` | `~/.augment/skills` | `.augment/skills` |
| MiniMax Code | `%USERPROFILE%\.minimax\skills` | `~/.minimax/skills` | `.minimax/skills` |
| Pi / Warp / Zed（共享目录） | `%USERPROFILE%\.agents\skills` | `~/.agents/skills` | `.agents/skills` |
| 豆包工作 DoubaoWork | `%LOCALAPPDATA%\DoubaoWork\User Data\Default\.doubaowork\agent_mode\workspace\.user_skills` | `~/.super_doubao/super-doubao-runtime/workspace/.user_skills`（部分版本路径） | — |

**WorkBuddy**：官方说明上传或创建的 Skill 默认保存在用户配置目录，可先从「专家 / 技能 / 已安装」查看；代码开发还会加载用户级 `.codebuddy` 配置。`.workbuddy/skills` 是兼容工具记录的本地约定，如果找不到，请让 WorkBuddy 列出当前已加载 Skill 的绝对路径，不要仅凭目录名新建。[技能管理](https://intl.cloud.tencent.com/zh/document/product/1316/84503)、[配置兼容说明](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting)

**豆包工作**：桌面版本的用户 Skill 目录有变化。除上表的路径外，macOS 2.25.18 的本机分析记录还发现 `~/Library/Application Support/DoubaoWork/Default/.doubaowork/agent_mode/workspace/.user_skills`。这些是版本相关的本地目录，不适用于豆包网页端或手机 App；优先从桌面应用确认实际位置。[对应版本与目录证据](https://www.crazyowen.cn/doubaowork/harness/references.html)

</details>

#### Windows：如何打开并复制完整路径

1. 按 **Win + R**，或打开资源管理器的地址栏。
2. 粘贴表中的 Windows 路径，例如 `%USERPROFILE%\.agents\skills`，按回车。
3. 打开后按 **Ctrl + L**，复制展开后的完整路径，再粘贴到管理器的「目录管理」。

也可以用 PowerShell 查看真实路径并打开目录（以 Codex 当前共享目录为例）：

```powershell
$skillDirectory = Join-Path $env:USERPROFILE '.agents\skills'
$skillDirectory
if (Test-Path -LiteralPath $skillDirectory -PathType Container) {
    explorer.exe $skillDirectory
}
```

WorkBuddy 的常见目录把上例的 `.agents\skills` 换成 `.workbuddy\skills` 即可。`%USERPROFILE%` 用于资源管理器和 CMD；PowerShell 使用 `$env:USERPROFILE`。

#### macOS：如何打开并复制完整路径

1. 打开 **Finder**，按 **Command + Shift + G**（前往文件夹）。
2. 粘贴表中的 macOS 路径，例如 `~/.agents/skills`，按回车。
3. 在 Finder 中选中文件夹，按 **Option + Command + C** 复制完整路径，再登记到管理器；家目录下的路径也可以直接用 `~/...` 登记。

终端中查看和打开目录：

```sh
printf '%s\n' "$HOME/.agents/skills"
open "$HOME/.agents/skills"
```

WorkBuddy 的常见目录把 `.agents/skills` 换成 `.workbuddy/skills` 即可。Windows 可打开资源管理器的「查看 → 显示 → 隐藏的项目」，macOS 可按 **Command + Shift + .** 切换隐藏文件显示；直接输入路径无需先显示隐藏文件。

#### 目录不存在，或技能由应用内部管理

目录不存在通常表示还没有在该范围安装过 Skill、配置了别的位置，或 Agent 运行在远程 / WSL 环境中。先在 Agent 中列出技能或询问「请列出已加载 Skill 的绝对路径」。只有确认它会读取该位置后，才创建目录和 `技能名/SKILL.md`；本管理器登记时要求目录已经存在且可读取。

| Agent / 形态 | Windows / macOS 的查找方式 |
| --- | --- |
| 豆包网页端 / 手机 App | 从产品内的技能入口管理；没有可以在本机登记的统一 Skill 根目录。豆包工作桌面端的版本相关目录见上表 |
| 百度 DuMate | 兼容工具目前使用打包 ZIP、在 App 内上传的方式；没有确认可供本管理器登记的稳定目录。[适配方式](https://github.com/yxdwind/agent-skill-manager#支持的产品) |
| Agent 插件自带 Skill | 由插件管理器安装到插件目录或缓存，不一定在用户级 `skills` 中；从 Agent 的已加载技能 / 插件详情确认实际来源，再登记已有目录 |

`~/.agents/skills` 和项目内 `.agents/skills` 已被 Codex、Cursor、Gemini CLI、GitHub Copilot、OpenCode 等工具读取，可以减少重复安装。各工具的兼容目录、优先级和启用方式仍以表内链接为准；登记到管理器只代表管理器可以扫描文件，Agent 是否加载它还要在该 Agent 中确认。[Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)、[Cursor](https://cursor.com/help/customization/skills)、[Gemini CLI](https://geminicli.com/docs/cli/using-agent-skills/)、[GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)、[OpenCode](https://opencode.ai/docs/skills)

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

豆包网页端、百度 DuMate 这类产品通过账号或应用内部管理技能，尚未确认稳定的本地登记目录（见上文「目录不存在，或技能由应用内部管理」）。当前通用 ZIP 已支持朋友间导出和导入；平台专用的 `.md` 安装包和自动上传仍待设计。

**2. 明确不做的**

物理删除、完整 Git 历史、云同步、多用户与权限、数据库、文件实时监听、全文检索，在设计阶段就划成了非目标，不会为了它们往代码里塞复杂度。架构上只预留两个扩展点：**来源适配器**（将来接远程来源）和 **存储层实现**（将来换掉 JSON 文件）。

## 数据、安全与边界

- macOS app 的运行时状态保存在 `~/Library/Application Support/Skill Manager/.skill-manager/`；Windows 和源码启动的状态保存在程序根目录的 `.skill-manager/`
- 应用**只允许**访问已登记 Skill 根目录内的文件和自己的状态目录，路径经 `realpath` 校验后再判断是否越界
- **不提供物理删除**：只能移除目录登记，磁盘上的文件保留
- 写文件采用「临时文件 + 原子替换」，保留原文件权限，尽量避免半写状态
- 元数据 JSON 带结构校验，损坏时拒绝写入而不是覆盖掉损坏内容
- 服务只监听回环地址 `127.0.0.1`，不提供远程访问能力；非本机 `Host` 或跨站 `Origin` 的请求会被直接拒绝

## 开发

### 环境要求

- Node.js 20.19 或更高版本
- pnpm（版本见 `package.json` 的 `packageManager`）
- macOS、Windows 和 Linux 均可从源码运行；Linux 暂不提供预构建包

### 从源码运行

```sh
corepack enable
pnpm install
pnpm build
pnpm start
```

### 开发模式

```sh
pnpm dev
```

默认地址 <http://127.0.0.1:8787>。

### 从源码构建 Windows 桌面版

开发与打包桌面版需要 Node.js 22.12+：

```sh
pnpm install --frozen-lockfile
pnpm desktop:setup
pnpm build
pnpm desktop          # 启动独立窗口用于开发验收
pnpm package:windows  # 生成 release-desktop/ 下的 Windows x64 便携 EXE
```

Windows 验收：`pwsh -File scripts/smoke-windows-desktop.ps1 release-desktop/skill-manager-v版本-windows-x64.exe`。脚本从含空格和中文的独立目录启动 EXE，检查旧数据兼容、重复启动、登记目录、复制粘贴、编辑保存、导出和关闭服务，并清除系统 Node 的 PATH。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 `8787` |
| `SKILL_MANAGER_ROOT` | 静态资源根目录 |
| `SKILL_MANAGER_DATA_DIR` | 可选的独立状态目录 |

例如，在 macOS / Linux 中用 `PORT=8788 pnpm dev` 覆盖端口；Windows PowerShell 中先执行 `$env:PORT = '8788'`，再执行 `pnpm dev`。

### 项目结构

```text
src/                 React 前端
server/              Express 后端源码
tests/               接口测试
scripts/             跨平台启动脚本与打包脚本
build/server/        后端编译产物（本地构建生成）
dist/                前端构建产物（本地构建生成）
```

### 检查命令

```sh
pnpm test
pnpm build
pnpm format:check
```

## 许可证

[MIT License](./LICENSE)

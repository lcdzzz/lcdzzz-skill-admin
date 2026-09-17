# 本地 Skill 管理器

一个本地运行的 Web 工具，用于登记、扫描、查看、编辑和创建本机的 Agent Skill。文件系统是 Skill 内容的真实来源，管理器只在项目目录中保存自己的状态和备份。

## 功能

- 登记多个本地 Skill 根目录并扫描直接子目录
- 搜索、查看和编辑 `SKILL.md`
- 创建标准 Skill 文件
- 收藏、标签、软禁用和批量管理
- 保存前备份、外部修改冲突检测和路径越界保护
- 默认只监听 `127.0.0.1`

## 环境要求

- Node.js 20.19 或更高版本
- 源码运行需要 pnpm
- macOS 支持 Apple Silicon 和 Intel
- Windows 支持 x64
- Linux 支持源码运行，暂不提供预构建包

## 方式一：下载源码自行编译

```sh
corepack enable
pnpm install
pnpm test
pnpm build
pnpm start
```

开发模式：

```sh
pnpm dev
```

打开 <http://127.0.0.1:8787>。首次启动为空，请在目录管理面板登记本机 Skill 根目录。可以用 `PORT=8788 pnpm dev` 修改端口。

## 方式二：下载预构建包

从 GitHub Releases 下载与你的系统和 CPU 架构对应的压缩包。预构建包已包含前端文件、编译后的后端和生产依赖，不需要 pnpm；仍需要 Node.js 20.19+。

macOS：

```sh
chmod +x start.sh
./start.sh
```

Windows：双击 `start.cmd`。脚本会检查 Node.js 版本、启动服务并打开浏览器。

## 数据和安全边界

运行时状态位于项目目录的 `.skill-manager/`，包括目录登记、标签、收藏、操作记录和备份。该目录不会提交到 Git，也不会随预构建包发布。

应用只允许访问已登记 Skill 根目录内的文件和自己的状态目录；不会物理删除 Skill。保存前会检测文件是否被外部修改。服务只监听本机回环地址，不提供远程访问能力。

## 项目结构

```text
src/                 React 前端
server/              Express 后端源码
tests/               接口测试
scripts/             跨平台启动脚本
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

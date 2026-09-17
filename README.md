# 本地 Skill 管理器

核心闭环包含目录登记、扫描与搜索、查看详情、编辑 `SKILL.md` 和标准模板创建。

需要 Node.js 20.19+（当前使用 Node.js 22 验证）和 pnpm。

```sh
pnpm install
pnpm dev
```

访问 http://127.0.0.1:8787 。首次启动为空，在目录管理面板登记本机 Skill 根目录后才扫描。支持 `~/` 路径。仅扫描根目录的直接子目录。

```sh
pnpm test
pnpm build
NODE_ENV=production pnpm start
```

通过 `PORT=8788 pnpm dev` 调整端口。生产启动前须先构建。

状态存放于项目 `.skill-manager/state.json`，移除登记不会删除磁盘文件。元数据损坏时拒绝覆盖，请手动检查该文件。保存会检查外部修改；出现冲突时可保留草稿或明确选择覆盖。

当前阶段不包含备份撤销，保存前请自行保留需要的历史版本。路径移动视为新的 Skill。测试只在自动创建的临时目录内运行。

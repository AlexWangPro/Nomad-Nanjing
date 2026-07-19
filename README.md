# Nomad Nanjing v3.1 — Railway 数据库持久化版

南京数字游民办公地图的 Railway 专用版本。

## v3.1 的核心变化

- 不再使用 `data/db.json`
- 地点、投稿、审核记录、贡献者和系统设置存入 SQLite 数据库
- 压缩后的 WebP 照片也存入 SQLite 数据库，不再依赖 `data/uploads`
- 数据库文件固定保存在 Railway Volume：`/data/nomad-nanjing.sqlite`
- 每次数据变更自动保留最近 50 个状态版本
- Railway 生产环境未连接 Volume 时，应用拒绝启动，防止把数据写进临时容器
- 如果 Volume 中存在旧版 `db.json` 和 `uploads/`，首次启动会自动尝试迁移

## 为什么更新代码不会影响数据

Docker 镜像和 GitHub 仓库只包含程序代码。Railway Volume 挂载到 `/data` 后，数据库位于独立持久存储中：

```text
GitHub / Docker 镜像
└── 程序代码

Railway Volume /data
└── nomad-nanjing.sqlite
    ├── 地点
    ├── 用户投稿
    ├── 审核记录
    ├── 贡献者
    └── WebP 图片二进制
```

覆盖 GitHub 文件、删除仓库中的 `data` 文件夹或重新部署，都不会覆盖 Volume 中的数据库。

## 重要限制

当前 SQLite 架构适合本项目的早期和中低访问量阶段。Railway 服务保持 **1 个 Replica**，不要开启多副本并发写入。未来用户量明显增加时，可以迁移到 PostgreSQL。

## 部署

完整步骤见 [RAILWAY_SETUP.md](./RAILWAY_SETUP.md)。


## v3.1 图片体验升级

- 新上传图片改为高清 WebP，每张控制在约 300KB 内，最长边优先保留到 1920px。
- 地点详情点击任意照片后，可左右滑动查看其余照片。
- 桌面端提供上一张、下一张按钮，也支持键盘左右方向键。
- 图片浏览器显示当前序号，例如 `2 / 6`，并预加载相邻图片。
- 旧图片不会自动变清晰；需要重新上传原图，才能应用新的清晰度规则。

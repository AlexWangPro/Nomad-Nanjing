# Nomad Nanjing v3.3 Railway 部署说明

## 1. 先连接 Railway Volume

在部署 v3.3 之前：

1. 打开 Railway 项目画布。
2. 创建或选择一个 Volume。
3. 将 Volume 连接到当前 Web Service。
4. Mount Path 设置为：

```text
/data
```

Railway 会自动提供：

```text
RAILWAY_VOLUME_MOUNT_PATH=/data
```

v3.3 在 Railway 生产环境检测不到 Volume 时会拒绝启动。这是数据保护机制，不是程序故障。

## 2. 更新 GitHub 代码

解压 v3.3 ZIP，用里面的文件覆盖仓库根目录，然后提交：

```bash
git add .
git commit -m "Use persistent SQLite database"
git push
```

Railway 会自动重新构建和部署。

## 3. Variables

保留现有变量：

```env
NODE_ENV=production

ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=你的复杂管理员密码
SESSION_SECRET=至少32位随机字符串

AMAP_JS_KEY=高德Web端JSAPIKey
AMAP_SECURITY_CODE=对应安全密钥
AMAP_WEB_SERVICE_KEY=高德Web服务Key

APP_NAME=南京数字游民办公地图
APP_NAME_EN=Nomad Nanjing
AUTO_IMPORT_CANDIDATES=true
```

`PORT` 由 Railway 自动提供，不要设置。

`DATA_DIR` 在 Railway 中可以删除。应用会优先采用 Railway 自动提供的 Volume Mount Path。即使保留 `DATA_DIR=/data` 也没有问题。

## 4. 部署后检查

打开：

```text
https://你的域名/api/health
```

应看到类似：

```json
{
  "ok": true,
  "version": "3.4.0",
  "storage": {
    "engine": "sqlite",
    "persistentVolume": true,
    "revision": 1,
    "mediaCount": 0
  }
}
```

其中必须满足：

```text
storage.engine = sqlite
storage.persistentVolume = true
```

## 5. 数据保存位置

所有数据保存在：

```text
/data/nomad-nanjing.sqlite
```

数据库使用 WAL 与 FULL synchronous 模式，减少异常重启导致的数据风险。

每次地点、投稿或审核发生变化时，会在数据库内部保留最近 50 个状态版本。

## 6. 图片保存

用户上传图片仍会：

- 自动转 WebP
- 每张自动转 WebP，并智能压缩到约 150KB 内（无需裁剪）
- 最多 8 张

但 v3.3 不再生成 `/data/uploads` 文件。图片二进制直接写入 SQLite 的 `media` 表，并通过 `/media/<id>.webp` 提供给前端。

## 7. Railway Volume 备份

建议在 Volume 设置中开启备份。代码更新不会触碰数据库，但 Volume 备份可以防止误删 Volume 或人为操作失误。

## 8. 不要做的操作

不要：

- 删除或 Wipe 当前 Volume
- 把 Volume 连接到错误的 Service
- 将 Mount Path 改成其他目录后直接部署
- 同时运行多个应用 Replica 写同一个 SQLite 数据库

只要 Volume 仍连接到当前服务并挂载到 `/data`，后续代码更新不会影响旧数据。

## 9. v3.3 权限说明

- 管理员编辑已发布地点：立即生效。
- 贡献者编辑已发布地点：生成待审核修改，管理员批准后生效。
- 删除照片只有在管理员保存或审核通过后才会真正从公开地点移除。
- 更新代码无需新增环境变量，也不会修改现有 SQLite 数据库。


## 手机桌面图标检查

部署后检查 `/manifest.webmanifest`、`/logo.svg` 和 `/icons/icon-512.png`。无需新增 Railway 环境变量。

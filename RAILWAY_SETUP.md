# Railway 设置清单

## 1. GitHub

解压 ZIP，将目录内所有文件放在仓库根目录并推送到 `main` 分支。

## 2. Railway Service

- New Project → Deploy from GitHub repo
- 选择仓库
- 等待首次构建

## 3. Variables

在 Service → Variables → Raw Editor 粘贴：

```env
NODE_ENV=production
ADMIN_EMAIL=
ADMIN_PASSWORD=
SESSION_SECRET=
AMAP_JS_KEY=
AMAP_SECURITY_CODE=
AMAP_WEB_SERVICE_KEY=
DATA_DIR=/data
APP_NAME=南京数字游民办公地图
APP_NAME_EN=Nomad Nanjing
AUTO_IMPORT_CANDIDATES=true
```

不要填 `PORT`。

## 4. Volume

在项目画布添加 Volume，连接到应用 Service，Mount Path 使用 `/data`。

## 5. Public Domain

Service → Settings / Networking → Generate Domain。

## 6. 高德安全域名

若 Web端（JS API）Key 启用了安全域名白名单，加入 Railway 生成的域名，例如：

```text
your-app-production.up.railway.app
```

只填域名，不填 `https://` 和路径。

## 7. 验证

- `https://你的域名/api/health`
- `https://你的域名/api/amap-check`
- `https://你的域名/api/amap/search?q=星巴克`
- `https://你的域名/admin`


注意：v2.3 新增 Sharp 图片处理依赖，Railway 会在 Docker 构建阶段自动安装，无需新增环境变量。

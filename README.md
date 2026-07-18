# Nomad Nanjing v2.1 — Railway 专用版

南京数字游民办公地图。该版本用于 GitHub → Railway 部署，不需要运行安装脚本。

## 已包含

- 高德真实地图与 Demo 风格 UI
- 店名搜索与地图位置确认
- 极简用户投稿表单
- 管理员快速审核、重复地点检测和自动标签
- 首批南京候选地点自动预录
- Railway Volume 数据持久化
- Dockerfile、Railway 健康检查

## Railway 部署

1. 将本目录全部文件上传到一个 GitHub 仓库的根目录。
2. Railway 新建项目，选择 **Deploy from GitHub repo**。
3. 在 Service → Variables 中填写下方变量。
4. 给该 Service 添加 Volume，Mount Path 设置为 `/data`。
5. 在 Networking 中生成 Railway Domain。
6. 将 Railway 域名加入高德 Web端（JS API）Key 的安全域名白名单（如果你启用了白名单）。

## 必需变量

```env
NODE_ENV=production
ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=你的复杂管理员密码
SESSION_SECRET=至少32位随机字符串

AMAP_JS_KEY=Web端（JS API）Key
AMAP_SECURITY_CODE=该JS Key对应的安全密钥
AMAP_WEB_SERVICE_KEY=Web服务Key

DATA_DIR=/data
APP_NAME=南京数字游民办公地图
APP_NAME_EN=Nomad Nanjing
AUTO_IMPORT_CANDIDATES=true
```

Railway 自动提供 `PORT`，不要手动填写。

## 高德 Key 的正确分工

### AMAP_JS_KEY + AMAP_SECURITY_CODE

在高德同一应用中添加一枚 Key：

- 服务平台：`Web端（JS API）`
- 获得：Key 与安全密钥
- 用途：浏览器显示地图

### AMAP_WEB_SERVICE_KEY

再添加一枚 Key：

- 服务平台：`Web服务`
- 用途：店名搜索、逆地理编码、首批地点预录

请勿把 JS API Key 填到 Web服务变量中，否则会返回 `USERKEY_PLAT_NOMATCH`。

## 部署后检查

依次打开：

- `/api/health`：服务是否正常
- `/api/amap-check`：两类高德配置是否正确
- `/api/amap/search?q=南京图书馆`：店名搜索是否正常
- `/admin`：管理员后台

首次配置完整后，候选地点会自动预录。也可在后台手动重新执行预录。

## 数据持久化

请务必把 Railway Volume 挂载到 `/data`。数据库和用户图片保存在：

```text
/data/db.json
/data/uploads/
```

没有 Volume 时，重新部署可能丢失地点、投稿和图片。

## 本地检查

```bash
npm run check
npm start
```

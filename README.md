# 南京办公地图 / Nanjing Work Map

一套可直接部署到 Railway 的南京数字游民办公地点地图 MVP。

它不是开放式大众点评，也不允许任何人直接在地图上发布地点。普通用户提交后进入审核队列；受邀贡献者可以登录提交；管理员决定是否发布、下架和设置“编辑精选 / 已验证”。

## 第一版已经包含

- 全屏地图、浮动筛选栏、地点列表和地点详情卡
- 高德地图 JavaScript API 2.0 接入
- 未配置高德密钥时自动显示内置演示地图，便于先检查 UI
- 类型、安静程度、通话、插座、免费、近地铁、已验证筛选
- 浏览器本地收藏
- 高德 App / Web 导航跳转
- 普通用户地点申请
- 现场图片上传（1–3 张，单张不超过 2.5MB）
- 管理员审核：通过发布、拒绝、保留待审
- 地点新增、编辑和下架
- 受邀贡献者账号创建、启用和停用
- 贡献者独立登录与提交记录
- JSON 文件持久化，不需要额外数据库服务
- Dockerfile、Railway 配置和健康检查接口
- 手机、iPad 和桌面响应式 UI

## 为什么第一版没有导入南京全部星巴克

当前种子数据全部标注为“示例数据”，用于验证页面和工作流。没有自动抓取或永久保存高德 POI，也没有未经核实地公开全部星巴克。

正式上线前，建议先在后台建立候选清单，再逐步核实并发布：

1. 新街口、大行宫、鼓楼、河西、仙林、百家湖、软件谷等区域；
2. 经过确认的星巴克及独立咖啡馆；
3. 图书馆、城市书房和公共阅读空间；
4. 共享办公、酒店大堂及其他特别空间。

## 本地运行

本项目不依赖任何第三方 npm 包。

```bash
cp .env.example .env
npm start
```

Node.js 版本要求：20 或更高。

打开：

- 地图首页：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/api/health`

Node 本身不会自动读取 `.env` 文件。本地测试可以在终端中导出变量，或使用你习惯的环境变量工具。Railway 会直接注入 Variables。

## Railway 部署步骤

### 1. 上传到 GitHub

把整个项目目录作为一个新的 GitHub 仓库上传。项目根目录必须直接包含：

- `package.json`
- `server.js`
- `Dockerfile`
- `railway.json`
- `public/`

### 2. 从 GitHub 创建 Railway 项目

在 Railway 中选择 **Deploy from GitHub repo**，连接该仓库。项目会根据 Dockerfile 构建，不需要填写自定义构建命令。

### 3. 设置区域

在 Railway 服务设置中优先选择：

`Southeast Asia / Singapore`

这只是当前海外部署的过渡方案。中国大陆的实际访问质量仍需使用南京本地的中国电信、中国移动和中国联通分别测试。

### 4. 添加环境变量

至少添加：

```env
NODE_ENV=production
ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=一个足够长的随机密码
SESSION_SECRET=至少32位随机字符串
DATA_DIR=/data
AMAP_JS_KEY=你的高德Web端JS API Key
AMAP_SECURITY_CODE=你的高德安全密钥
APP_NAME=南京办公地图
APP_NAME_EN=Nanjing Work Map
```

生成 SESSION_SECRET 的一种方法：

```bash
openssl rand -hex 32
```

`AMAP_JS_KEY` 和 `AMAP_SECURITY_CODE` 未设置时，网站仍可运行，但显示的是演示地图，不是真实高德底图。

### 5. 添加 Railway Volume

必须给服务挂载一个 Volume：

- Mount Path：`/data`

否则重新部署或重启后，审核数据和用户上传图片可能丢失。

数据结构：

```text
/data/db.json
/data/uploads/*
```

### 6. 生成域名

在 Railway Networking 中生成公开域名，或绑定你自己的子域名。

随后把正式域名加入高德控制台对应 Key 的安全域名白名单。

### 7. 登录管理后台

打开：

```text
https://你的域名/admin
```

使用 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 登录。

## 高德地图设置

在高德开放平台中：

1. 创建应用；
2. 添加 Key；
3. 服务平台选择 **Web端（JS API）**；
4. 获取 Key 和安全密钥；
5. 把它们分别放入 `AMAP_JS_KEY` 与 `AMAP_SECURITY_CODE`；
6. 配置正式域名白名单。

前端使用高德 `whitesmoke` 官方样式，以保持轻量、低饱和度的地图视觉。

导航按钮使用高德 URI，因此手机安装高德地图时可直接调起；未安装时通常会打开高德网页。

## 权限逻辑

### 游客

- 浏览、筛选、收藏和导航
- 无法直接发布、评分或评论

### 普通提交者

- 无需创建公开账号
- 必须填写真实到访日期、实际办公时长、至少 40 字体验和至少一张图片
- 提交后进入待审核队列

### 受邀贡献者

- 由管理员后台创建账号
- 登录 `/admin`
- 可提交地点并查看自己的审核状态
- 第一版仍不能直接发布

### 管理员

- 审核、发布或拒绝提交
- 新增、编辑和下架地点
- 设置编辑精选和实地验证
- 创建、启用或停用贡献者

## 数据与扩展边界

目前使用单个 JSON 文件和本地 Volume，适合早期低流量验证。它的优点是部署简单、成本低且不依赖额外数据库。

以下情况出现时应升级为 PostgreSQL 和对象存储：

- 地点达到数百或上千条；
- 多名管理员同时高频编辑；
- 图片数量持续增长；
- 需要短信、邮箱验证码或微信登录；
- 需要完整审计、版本回滚或商家认领；
- 需要中国大陆多地域部署。

## 正式公开前必须处理

1. 在后台删除或替换所有“示例数据”；
2. 配置高德正式 Key、安全密钥和域名白名单；
3. 设置 Railway Volume；
4. 修改管理员邮箱、密码和 SESSION_SECRET；
5. 添加隐私政策、用户提交协议和图片授权说明；
6. 检查高德开放平台许可与项目实际用途是否匹配；
7. 使用南京本地三网和常见手机浏览器测试；
8. 对真实地点的地址、开放时间、插座、Wi-Fi 和办公规则进行人工确认。

## 文件结构

```text
.
├── Dockerfile
├── README.md
├── package.json
├── railway.json
├── server.js
├── data/
│   └── .gitkeep
└── public/
    ├── index.html
    ├── app.js
    ├── admin.html
    ├── admin.js
    ├── styles.css
    └── favicon.svg
```

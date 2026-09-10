# MyHKU dashboard

基于 Vite、React 和 TypeScript 的桌面/手机响应式仪表盘。已接入 HKU 官方登录入口：Portal/SIS 使用 `https://studentportal.hku.hk/`，Moodle 使用 CAS 登录地址。首次使用创建本地账户并完成一次官方 2FA；之后桌面端自动复用会话并尝试后台登录。

## 下载与设备对应

旧预发布版本及其安装包已撤下，当前没有可下载的发布版本。请按下方说明从源码构建；新的安装包发布后会更新此处。

## 运行

```bash
npm install
npm run dev
```

生产构建：`npm run build`，预览：`npm run preview`。

开发服务器默认地址为 `http://localhost:5173`。`npm run build` 会先执行 TypeScript 检查，再生成 `dist/`；可用 `npm run preview` 检查生产构建产物。

### 本地验证

以下检查不需要 HKU 账号，适合确认前端和桥接服务已经启动：

```powershell
npm run build
npm run bridge
```

桌面端（Windows/macOS 开发运行）：

```bash
npm run desktop:dev
```

生成桌面安装包（Windows 需在 Windows 构建，macOS 需在 macOS 构建）：

```bash
npm run desktop:package
```

## 三端发布工作流

项目将 Android、Windows 和 macOS 统一为 tag 发布。Web 前端会在构建桌面和 Android 时作为共享资源打包进去，不单独作为发布端。版本号只维护在 `package.json`，发布时创建 `v<version>` tag，GitHub Actions 会并行构建三端产物，最后生成 `SHA256SUMS.txt` 到 GitHub Release。

本地构建 Android：

```powershell
npm run android:debug       # 调试 APK
npm run android:release     # release APK/AAB（配置签名后）
```

桌面产物可用 `MYHKU_RELEASE_DIR=release/desktop npm run desktop:package` 指定目录。完整本地产物可执行 `npm run release:stage`，它会收集桌面和 Android 输出并生成 SHA-256 校验文件。

GitHub Actions 的 Android release 签名使用以下 secrets：`MYHKU_ANDROID_KEYSTORE_BASE64`、`MYHKU_ANDROID_KEY_ALIAS`、`MYHKU_ANDROID_KEYSTORE_PASSWORD`、`MYHKU_ANDROID_KEY_PASSWORD`。仓库不保存 keystore；没有签名环境时仍可构建 unsigned release 供内测，正式分发前必须配置 secrets。Windows 和 macOS 桌面安装包在对应 runner 上构建，macOS 公证或代码签名可在仓库 secrets 配置后再接入 electron-builder 的签名变量。

产物默认写入系统临时目录 `MyHKU-release/`（可用 `MYHKU_RELEASE_DIR` 指定输出目录）。安装包首次启动会先显示账户向导；账户保存后在官方 HKU 登录窗口完成 SSO/MFA。应用只在受限的官方窗口中自动填充常规登录字段，不绕过 2FA。

桌面端会自动启动 loopback bridge，并在独立的 HKU 登录窗口中打开 Portal/Moodle。登录窗口使用 Electron 的 `persist:myhku-hku` 会话分区，因此有效的 SSO/MFA 会话会在应用重启后保留；密码、Cookie 和令牌不会传给仪表盘或 bridge。规范化课表、课程、作业、资料、公告和成绩缓存使用 Electron `safeStorage` 保护的密钥加密保存；若操作系统没有可用的安全存储，应用只保留内存缓存并提示需要重新同步。登录完成后，在官方页面停留或刷新一次，内置连接器会将页面中可见的只读课程字段同步到本机 bridge。只有 HKU 与微软登录域名允许在该窗口中导航。

首次启动应用会先显示本地账户向导；保存账户后打开 Portal、Moodle 官方窗口，完成首次 2FA 后窗口会在后台保持会话。之后启动会隐藏打开认证页，只有会话过期或需要 2FA 时才显示窗口。调试时可用 `MYHKU_OPEN_LOGIN_ON_STARTUP=1 npm run desktop` 强制再次显示官方窗口。

保持桥接进程运行后，在另一个终端执行：

```powershell
Invoke-RestMethod http://127.0.0.1:17321/api/session/portal
Invoke-RestMethod http://127.0.0.1:17321/api/snapshot
```

两个请求应分别返回站点连接状态和空的规范化快照。桥接默认只监听 `127.0.0.1:17321`；可通过 `MYHKU_BRIDGE_PORT` 修改端口，但修改后必须同时更新 `VITE_HKU_BRIDGE_URL` 和扩展中的本地桥接地址。

## 刷新策略

- 应用启动时自动刷新一次。
- 点击「立即刷新」可手动刷新，展示同步中与成功提示。
- 应用持续打开时，以本地时间判断每天最多自动更新一次（原型界面展示该策略）。
- 上次同步时间保存在浏览器 `localStorage`，便于重启后显示。

在“设置 → HKU 服务连接”可以分别打开 Portal、SIS、Moodle 官方登录页并检查状态。演示模式继续使用内置样例；真实模式通过本地桥接服务读取已登录页面同步的数据。浏览器预览未配置桥接时会明确显示配置提示，不会把样例冒充真实数据。`bridge/server.mjs` 负责本机 loopback API、规范化快照和加密缓存；桌面端和 Android 原生层分别负责官方登录会话与页面读取。它不会替用户登录，也不会读取 Cookie。

## 本地桥接配置

打包桌面或 Android 客户端时，复制 `.env.example` 为 `.env.local`，将 `VITE_HKU_BRIDGE_URL` 指向本地桥接服务（例如 `http://127.0.0.1:17321`）。桥接需要实现 `GET /api/session/{portal|sis|moodle}` 并返回 `{ "connected": boolean, "detail"?: string }`，以及 `GET /api/snapshot` 返回规范化课表、课程、作业、资料和成绩；账号登录、Cookie 与 SIS/Moodle 解析应由原生层完成并使用系统安全存储。前端只调用这些受限接口。

需要用浏览器中的真实页面做开发验证时，启动 `npm run bridge`，再按 [`extension/README.md`](extension/README.md) 加载未打包的 Chrome 扩展。扩展仅从已登录页面读取可见只读字段，并通过 `/api/ingest/{portal|sis|moodle}` 写入桥接内存；重新加载对应 HKU 页面后，仪表盘点击刷新才会看到最新快照。桥接进程重启会清空快照。

产品范围与技术方案见 [`docs/product-spec.md`](docs/product-spec.md) 和 [`docs/architecture.md`](docs/architecture.md)。

## 使用真实 HKU 页面（桌面 CDP 连接器）

为了让桌面应用读取用户在官方页面看到的内容，可以运行内置的 Chrome DevTools 连接器：

```powershell
npm run bridge:cdp
```

连接器会启动一个可见的 Chrome 专用配置目录（默认 `.myhku/chrome-profile`），打开 Moodle 和 Student Portal 官方页面。第一次使用时请在这两个页面中亲自完成 HKU SSO/MFA；登录成功后，连接器通过 DevTools Protocol 读取当前页面的可见 DOM，并把课程、课表、资料、待办和成绩等规范化字段发送到本机 bridge。密码、Cookie、localStorage、Authorization header、原始 HTML 和 SSO URL 查询参数不会被读取或保存。Chrome 配置目录只用于保留官方浏览器会话，删除该目录即可注销此连接器的会话。

连接器默认每 5 秒检查登录页和标签页；已登录页面只在启动时和应用持续运行满 24 小时后重新提取一次。`Ctrl+C` 停止连接器。只同步一次并退出可运行：

```powershell
npm run bridge:cdp:once
```

若该命令自动启动了 bridge，bridge 会在一次同步后继续留在本机运行，方便仪表盘读取快照；按需结束对应的 `bridge/server.mjs` 进程。

无需启动 Chrome 即可检查连接器源码和 HKU host 白名单：`npm run bridge:cdp:test`。

可用参数：`--chrome <path>` 指定 Chrome/Chromium，`--profile <path>` 指定会话目录，`--port <n>` 指定 CDP 端口，`--no-launch` 连接已用该端口启动的浏览器，`--watch-ms <n>` 和 `--refresh-ms <n>` 调整检查/刷新间隔。默认使用 Node 22 的内置 WebSocket，不需要额外 CDP 依赖。连接器只允许 `moodle.hku.hk`、`studentportal.hku.hk` 和 `hkuportal.hku.hk` 页面；其他标签页不会被读取。

如果要连接自己已经用远程调试启动的 Chrome，请先关闭同一 profile 的其他 Chrome 进程，再用独立 profile 启动（Windows 示例）：

```powershell
& "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$pwd\.myhku\chrome-profile" https://moodle.hku.hk/ https://studentportal.hku.hk/
npm run bridge:cdp -- --no-launch
```

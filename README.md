# MyHKU dashboard

基于 Vite、React 和 TypeScript 的桌面/手机响应式仪表盘。已接入 HKU 官方登录入口：Portal/SIS 使用 `https://studentportal.hku.hk/`，Moodle 使用 CAS 登录地址。首次使用创建本地账户并完成一次官方 2FA；之后桌面端自动复用会话并尝试后台登录。

## 下载与设备对应

当前最新可下载版本：**[v0.1.2-alpha（预发布版）](https://github.com/StevenLee147/MyHKU/releases/tag/v0.1.2-alpha)**。按设备选择下表中的安装包，无需下载源码。

| 设备 | 对应安装包 | 最新版本下载 | 安装提示 |
| --- | --- | --- | --- |
| Windows 64 位电脑（Intel / AMD x64） | `MyHKU.Setup.0.1.2-alpha.exe` | [下载安装版 EXE](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/MyHKU.Setup.0.1.2-alpha.exe) | 推荐；运行安装向导。 |
| Windows 64 位电脑（免安装） | `MyHKU.0.1.2-alpha.exe` | [下载便携版 EXE](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/MyHKU.0.1.2-alpha.exe) | 下载后直接运行。 |
| Mac Apple Silicon（M 系列芯片 / arm64） | `MyHKU-0.1.2-alpha-arm64.dmg` | [下载 DMG](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/MyHKU-0.1.2-alpha-arm64.dmg) | 拖入 Applications；如遇系统拦截，见[各设备安装指南](#各设备安装指南)。 |
| Mac Apple Silicon（ZIP 备用包） | `MyHKU-0.1.2-alpha-arm64-mac.zip` | [下载 ZIP](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/MyHKU-0.1.2-alpha-arm64-mac.zip) | 解压后移入 Applications；系统拦截处理见[安装指南](#各设备安装指南)。 |
| Android 8.0 及以上手机 / 平板 | `app-debug.apk` | [下载测试 APK（可安装）](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/app-debug.apk) | 使用调试签名，可直接安装；更新限制见[安装指南](#各设备安装指南)。 |
| Android 应用商店分发 / 开发者 | `app-release.aab` | [下载 AAB](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/app-release.aab) | 用于商店分发或生成 APK，不能直接点击安装。 |

当前未提供 Intel Mac（x64）、Windows ARM64 原生包或 iPhone / iPad 安装包。Mac 可在「关于本机」查看芯片类型；Windows 可在「设置 → 系统 → 系统信息」查看系统类型。

本节由 CI/CD 在发布成功后自动更新，包含预发布版，按发布时间选择最新版本。查看[全部版本](https://github.com/StevenLee147/MyHKU/releases)；[Latest 正式版入口](https://github.com/StevenLee147/MyHKU/releases/latest)仅包含正式版，没有正式版时不可用。

可下载 [SHA256SUMS.txt](https://github.com/StevenLee147/MyHKU/releases/download/v0.1.2-alpha/SHA256SUMS.txt) 校验文件完整性；`.blockmap`、`latest.yml` 和 `latest-mac.yml` 是更新元数据，无需手动安装。

## 各设备安装指南

以下步骤适用于上方下载表提供的安装包。目前提供 Windows x64、Mac Apple Silicon（M 系列芯片 / arm64）和 Android 8.0 及以上版本；未提供 Intel Mac、Windows ARM64 原生版或 iPhone / iPad 安装包。下载前请确认设备类型。

当前无 Apple 开发者证书的 Mac 构建仅做 ad-hoc 签名，未经过 Apple 公证；Windows EXE 也没有发布者签名。它们仍可能被系统拦截，下面的操作不会将其变成经开发者认证的应用。仅对本仓库 [GitHub Releases](https://github.com/StevenLee147/MyHKU/releases) 下载、且与该版本 `SHA256SUMS.txt` 匹配的文件执行放行操作。

### Windows 电脑

1. 普通安装选名称含 `Setup` 的 EXE，双击并按向导安装；便携版选不含 `Setup` 的 EXE，保存到固定文件夹后直接运行。
2. 若出现「Windows 已保护你的电脑」，核对下载来源和校验值后选择「更多信息 → 仍要运行」。若没有此选项或电脑由学校/单位管理，请联系管理员处理，不要关闭系统防护。
3. 从开始菜单或便携版 EXE 启动 MyHKU，完成下方首次登录步骤。更新安装版前先退出旧版本，再运行新安装包。

### Mac（Apple Silicon）

1. 在「苹果菜单 → 关于本机」确认芯片为 Apple M 系列。下载 `arm64.dmg`，打开后将 **MyHKU 拖入 Applications（应用程序）**，等待复制完成，再在 Finder 中推出安装磁盘。ZIP 备用包解压后同样将 `MyHKU.app` 移入「应用程序」。
2. 从「应用程序」打开 MyHKU。若提示无法验证开发者或 Apple 无法检查恶意软件，关闭提示，前往「系统设置 → 隐私与安全性」，找到 MyHKU 的拦截记录，点击「仍要打开（Open Anyway）」并确认。
3. 若仍显示「MyHKU 已损坏，无法打开」且上一步不可用，先核对官方来源和 `SHA256SUMS.txt`。确认应用已复制到 `/Applications/MyHKU.app` 后，打开「终端」执行以下命令，再从「应用程序」启动：

```bash
xattr -dr com.apple.quarantine /Applications/MyHKU.app
```

此命令只移除这份 MyHKU 应用的下载隔离标记，不能修复实际损坏的文件，也不代表 Apple 已验证应用。校验值不一致时应删除下载文件并重新下载；不要对整个「下载」或「应用程序」目录运行此命令，也不要全局关闭 Gatekeeper。命令如报权限错误，请确认复制位置和文件所有者，不要直接添加 `sudo`。

### Android 手机 / 平板

1. 优先下载 `app-release.apk`；若本次发布只有测试安装包，选 **`app-debug.apk`**。后者已有调试签名，可以安装，但不是正式发布签名。
2. 在手机中打开 APK，按系统提示为当前浏览器或文件管理器开启「允许来自此来源的应用 / 安装未知应用」，完成安装后可关闭该来源权限。
3. 更新前先退出应用并尝试安装新 APK。测试包的调试密钥可能随构建变化，改用正式签名也会导致签名不匹配；出现「应用未安装 / 与现有软件包冲突」时无法直接覆盖。**卸载会清除应用的本地账户、设置和缓存**，请先记录必要设置、保存需要的资料；目前没有保证保留或恢复全部本地数据的迁移流程，确认可接受后再卸载重装。

`app-release-unsigned.apk` 没有签名，不能直接在手机安装；`.aab` 供开发者签名后用于商店分发或生成 APK，也不能直接点击安装。普通用户请选择上面的可安装 APK。

### 校验下载与首次登录

从同一 Release 下载 `SHA256SUMS.txt`，找到对应文件名的条目，对比 SHA-256 值。Windows PowerShell 使用 `Get-FileHash -Algorithm SHA256 "下载文件的完整路径"`；Mac 终端使用 `shasum -a 256 "下载文件的完整路径"`。Android APK 也可先在电脑校验后传到手机。

首次启动会显示本地账户向导；保存账户后，在打开的 **HKU 官方 Portal / Moodle 登录窗口**中完成 SSO 和首次 MFA / 2FA。应用不会替你绕过验证；会话过期时需再次在官方窗口登录。完成后返回仪表盘并同步课程数据。

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

GitHub Actions 的 Android release 签名使用以下 secrets：`MYHKU_ANDROID_KEYSTORE_BASE64`、`MYHKU_ANDROID_KEY_ALIAS`、`MYHKU_ANDROID_KEYSTORE_PASSWORD`、`MYHKU_ANDROID_KEY_PASSWORD`。仓库不保存 keystore；没有发布签名环境时提供可安装的 `app-debug.apk` 供测试，同时保留不能直接安装的 unsigned release APK / AAB 供开发者使用。正式分发和稳定覆盖更新需要配置持久的发布签名。

macOS 默认 `MYHKU_MAC_NOTARIZE=0`：应用采用 ad-hoc 签名，不进行 Apple 公证，安装时仍可能需要按上方指南放行。未来设置 `MYHKU_MAC_NOTARIZE=1` 并提供 Developer ID 及 Apple 凭据后，构建会强制签名、公证、装订票据并检查 Gatekeeper；缺少凭据或检查失败会停止发布。CI 在配置 `MYHKU_MAC_CERTIFICATE_BASE64` 后启用此严格模式，其余所需 secrets 和本地命令见 [macOS 发布配置](docs/macos-release.md)。已有下载文件不会因修改配置自动改变，必须重新构建发布。

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

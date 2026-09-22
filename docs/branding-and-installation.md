# Logo、协议与覆盖升级

`public/brand/logo.svg` 是原创标识的矢量源文件：展开的书本、字母 M 与指引学习的星芒，使用深蓝、薄荷绿和金色，不使用大学校徽。运行 `npm run generate:branding` 生成 Windows ICO（16–256 px）、macOS ICNS（16–1024 px）、通用 PNG、Android 分辨率图标和扩展图标。Android 自适应前景在 `android/app/src/main/res/drawable/ic_launcher_foreground.xml` 中维护同款图形，内容位于安全区。

`public/legal/agreements.json` 是三份协议及版本的唯一内容来源。构建同步生成安装器文本；网页和桌面端共用 React 确认界面；Android 原生界面读取打包的同一 JSON。协议更新应同时变更 `version`，不要仅修改文案。确认前不挂载仪表盘业务组件；桌面主进程同时阻止业务 IPC 和官方登录，Android 在原生确认前不创建 WebView。

Windows 的 `appId`、包名、产品名以及默认 NSIS GUID 推导规则保持不变，不自行新建 GUID。NSIS assisted 安装器提供安装目录选择并检测现有安装；卸载和更新不主动删除用户数据。macOS 按标准 DMG/Finder 替换应用，允许用户选择目标目录。便携程序和 ZIP 是手工替换分发形式，没有后台更新服务。

Android 版本名和递增的 `androidVersionCode` 统一取自根目录 `package.json`。正式发布必须保持 `hk.my.myhku` 包名和 `android/release-certificate.sha256` 对应的私钥；不得改为临时签名。Play 分发需持续使用同一 Play 签名渠道，不能假定不同渠道的签名可互换。

发布验证：桌面登录与协议确认测试、学习数据显示测试、macOS 签名和最终下载检查、Windows 自定义路径内从上个版本的覆盖安装、Android 8.0/15 上从实际旧版 APK 的覆盖安装。CI 成功后才能创建 Release。

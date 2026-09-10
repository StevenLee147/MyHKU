# MyHKU Chrome 扩展

桌面版 Electron 已内置同等的页面连接器；使用桌面版时不需要加载这个扩展。此扩展保留用于 Chrome 开发验证和浏览器预览。

扩展把当前**已登录**的 HKU 页面中可见的只读数据发送给本机桥接服务。它不读取或发送密码、Cookie、localStorage、Authorization header 或原始 HTML。

## 安装（开发者模式）

1. 在项目根目录运行 `npm run bridge`，保持桥接服务运行。
2. 打开 Chrome 的 `chrome://extensions`，开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本目录下的 `extension` 文件夹。
4. 重新加载已经登录的 `moodle.hku.hk`、`studentportal.hku.hk` 或 `hkuportal.hku.hk` 标签页。页面加载完成后会自动同步一次。

扩展只在页面加载时提取数据；在 MyHKU 仪表盘中点击刷新会读取桥接内存中的最近快照。若页面内容有更新，请重新加载对应 HKU 标签页。

## 支持的字段

- Moodle：课程、公告、作业（截止时间/完成状态）、资料链接、成绩
- Student Portal / SIS：课表（课程、代码、日期/星期、时间、地点、教师）

桥接只绑定 `127.0.0.1:17321`，重启后缓存清空。扩展没有后台轮询。

## 桌面真实连接器

桌面端可使用 `npm run bridge:cdp` 代替手动加载扩展。它会启动带持久化配置目录的可见 Chrome，通过 Chrome DevTools Protocol 在官方页面完成登录后读取同一套 DOM 适配器，并写入本地 bridge。首次运行需要用户在官方 HKU SSO/MFA 页面手动登录；连接器不读取密码或 Cookie。`npm run bridge:cdp:once` 可只同步当前页面一次。

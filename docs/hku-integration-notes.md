# HKU 公开入口与接入验证记录

验证日期：2026-09-09。仅发送公开的 GET/OPTIONS 请求，未提交账号、密码、MFA 或令牌。

## 入口和认证链

### Moodle

- `https://moodle.hku.hk/`、`/index.php` 返回 `303` 到 `/login/index.php`。
- 登录页提供普通用户名/密码表单，以及 **HKU Portal User** 链接：
  `https://moodle.hku.hk/login/index.php?authCAS=CAS`。
- 该 CAS 入口返回 `302` 到：
  `https://hkuportal.hku.hk/cas/login?service=<moodle-authCAS-url>`。
- CAS 入口继续跳到 `/cas/aad`，未认证的公开请求最后返回一个 meta refresh 到
  `https://hkuportal.hku.hk/login.html`（再进入 CAS 登录）。必须让用户在官方 WebView 中完成整个 SSO/MFA 链。
- 认证成功后 CAS 会把一次性 service ticket 回调到 Moodle；应由 WebView 自动跟随回调完成 `MoodleSession` 建立，不记录或自行重放 ticket。
- 公开响应仅显示会话 Cookie 名称/属性：Moodle `MoodleSession`（Secure、HttpOnly、Path=/），CAS `JSESSIONID`（Secure、HttpOnly、Path=/cas）。不要复制 Cookie 值到前端或日志。

### Student Portal

- `https://studentportal.hku.hk/` 返回 `302` 到 `/en-US/`，再将未登录用户重定向到：
  `/en-US/Account/Login/ExternalLogin?provider=https://login.microsoftonline.com/<tenant>/&ReturnUrl=/en-US/`。
- 当前公开响应中的 Azure AD 参数包括租户 ID `e80d8e75-52b9-4839-a358-87abb93b3567`、客户端 ID `c6a3c8e9-4799-4c8b-adfe-d4cdb2c7108f`、回调 `https://studentportal.hku.hk/signin-openid_1`、`response_type=id_token`、`scope=openid profile`、`response_mode=form_post`。这些是站点公开配置，用于识别认证链；客户端不应自行模拟或硬编码用户令牌。

## 接入限制

- Moodle 登录页和业务页带 `X-Frame-Options: SAMEORIGIN`，且未返回 `Access-Control-Allow-Origin`；Portal 页面带 `X-Frame-Options: SAMEORIGIN`（根重定向响应当前有 `ACAO: *`，不代表业务页面可跨域访问）。浏览器渲染器中的跨域 iframe、从本地页面直接 `fetch` Moodle/Portal HTML 都不可靠。
- Moodle `/webservice/rest/server.php` 可公开访问，但无令牌时返回 Moodle XML `invalidtoken`；`/login/token.php` 无参数返回 `missingparam`。标准 Web Service 只有在学校管理员/用户实际启用并发放 token 后才能使用，不应在客户端假设可用。
- Moodle `/lib/ajax/service.php` 需要有效 `sesskey` 及 JSON 请求；无效请求返回 `codingerror`。该接口属于登录后页面内部接口，调用前必须通过同一 WebView 获取当前 `sesskey`，且只调用确认不会改变完成/已读状态的函数。
- Portal 的常见 Power Pages 路径 `/_api/`、`/_odata/` 在公开未登录状态均返回 404；不能据此设计固定 Dataverse API。

## 建议的真实接入实现

1. 使用受限、独立的官方登录 WebView（允许 `moodle.hku.hk`、`hkuportal.hku.hk`、`studentportal.hku.hk`、`login.microsoftonline.com` 及认证链实际需要的域）。仪表盘页面与登录 WebView 分离，不把站点脚本权限带入本地 UI。
2. Portal/SIS 作为主登录入口时，先在 WebView 打开 `https://studentportal.hku.hk/en-US/`，由用户完成 Azure AD/MFA；随后在同一 WebView 或共享的受保护 Cookie 容器中打开 Moodle CAS 链，确认 Moodle 得到自己的 `MoodleSession`。若站点会话不能跨 WebView 容器共享，保留两个站点的 Cookie 容器并分别提示登录。
3. 每次刷新先以 GET 访问一个不产生副作用的 Moodle 页面（例如 `/my/` 或课程页）检查状态。状态为登录页/303 时标记会话失效并回到官方登录 WebView；网络错误时保留旧缓存。
4. 适配器优先顺序：实机确认的官方导出或 Web Service → 登录后同源页面使用的只读 AJAX 请求 → 受控 DOM 解析。解析器必须检测页面标题/关键 DOM 结构，结构变化时报告 `adapter_needs_update`，不能把空结果当作成功。
5. 所有下载在用户明确点击后进行，使用同一 Moodle 会话 Cookie 请求 `pluginfile.php` 等页面给出的真实链接；不猜测文件路径。下载完成后交给平台文件服务。

## 待用户登录后验证的项目

- SIS 课表真实页面 URL、当前学期选择控件、日期/周次字段和是否提供稳定导出。
- Moodle 课程、作业、完成状态、成绩和资料在当前账号下实际使用的页面/AJAX 请求；确认哪些请求是纯只读。
- 三端 WebView Cookie 持久化、退出清理、会话过期和 MFA 回调行为。

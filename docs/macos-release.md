# macOS 发布与安装验证

macOS 从浏览器下载应用后会通过 Gatekeeper 检查来源、代码签名和 Apple 公证。当前未配置 Apple Developer Program 凭据，默认发布 Apple Silicon / arm64 测试包：应用采用 ad-hoc 签名，DMG 不使用 Developer ID 签名，应用和 DMG 均不提交 Apple 公证。

ad-hoc 签名用于检查应用代码是否完整，不能证明开发者身份，也不能消除「无法验证开发者」「文件已损坏」等系统拦截。SHA-256 只能检查下载完整性，不能替代 Developer ID 签名和公证。具体安装、校验和仅针对 MyHKU 的放行步骤见 [README 各设备安装指南](../README.md#各设备安装指南)。

## 默认测试包：无需 Apple 凭据

`MYHKU_MAC_NOTARIZE=0` 是默认模式。构建钩子使用 `identity: "-"` 进行 ad-hoc 签名，关闭 hardened runtime 和公证；DMG 不签名。默认模式验证最终应用签名完整性，但不要求公证票据或 Gatekeeper 接受，不能声称已通过 Apple 认证。

在 macOS 上构建：

```bash
npm ci
MYHKU_MAC_NOTARIZE=0 MYHKU_RELEASE_DIR=release/desktop npm run desktop:package -- --mac --arm64 --publish never
MYHKU_MAC_NOTARIZE=0 npm run verify:macos-release -- release/desktop
```

GitHub Actions 在没有 `MYHKU_MAC_CERTIFICATE_BASE64` secret 时选择默认模式。手动运行 **Release** 工作流会构建并检查产物，不创建 GitHub Release；推送 `v<package.json version>` tag 后，在各平台构建通过时发布。当前不构建 Intel Mac 安装包。

## 可选：Developer ID 签名与 Apple 公证

将 `MYHKU_MAC_NOTARIZE` 设为 `1` 可启用严格发布模式。需要有效的 Apple Developer Program 团队账户。在 macOS 钥匙串中创建或导入 **Developer ID Application** 证书，连同私钥导出为有密码保护的 `.p12`。Apple Development 或 Mac App Distribution 证书不能替代此证书。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 设置以下 repository secrets：

| Secret | 内容 |
| --- | --- |
| `MYHKU_MAC_CERTIFICATE_BASE64` | `.p12` 文件的 Base64 编码，包含证书及私钥；配置后 CI 自动选择严格模式。 |
| `MYHKU_MAC_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码。 |
| `MYHKU_APPLE_ID` | 有权为该团队提交公证的 Apple 账户。 |
| `MYHKU_APPLE_APP_SPECIFIC_PASSWORD` | 在 Apple 账户中生成的 App 专用密码，用于 `notarytool`。 |
| `MYHKU_APPLE_TEAM_ID` | 证书所属开发者团队的 Team ID。 |

只在 GitHub Secrets 或本机进程环境中提供凭据，不要将证书、私钥或密码提交到仓库。electron-builder 会在 CI 中导入证书并管理临时钥匙串。已启用严格模式后，缺少任一凭据或验证失败会阻止发布，不会退回默认模式。

## 发布前检查

严格模式的 macOS job 按顺序执行：

1. 检查必需凭据是否齐全；缺失时立即失败，日志只显示变量名。
2. 构建 Apple Silicon / arm64 应用，完成 Developer ID 签名、Apple 公证及票据装订。
3. 在打包前验证应用的签名、hardened runtime、公证票据和 Gatekeeper 结果。
4. 生成 ZIP 和签名 DMG，对 DMG 提交公证；仅接受 Apple 返回的 `Accepted` 状态，然后装订并验证票据。
5. 挂载最终 DMG、解压最终 ZIP，分别验证内部 `.app` 的签名、票据及 Gatekeeper 接受结果，同时验证 DMG 本身。任何检查失败都不会上传 macOS 产物，依赖它的 Release 发布也不会运行。

DMG 装订票据会改变文件内容，因此关闭 electron-builder 在此之前生成的 DMG 更新元数据及 blockmap，避免发布失效的哈希。macOS 自动更新元数据继续使用已包含公证票据的 ZIP。最终 `SHA256SUMS.txt` 在所有构建与验证完成后生成。

本机严格构建时，先在进程环境设置 `CSC_LINK`（`.p12` 路径或 Base64）、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，再执行：

```bash
export MYHKU_MAC_NOTARIZE=1
npm ci
npm run check:macos-signing
MYHKU_RELEASE_DIR=release/desktop npm run desktop:package -- --mac --arm64 --publish never
npm run verify:macos-release -- release/desktop
```

Windows 可运行 `npm run test:macos-release` 检查构建逻辑；真实 macOS 签名、公证和 Gatekeeper 校验必须在 macOS 上运行。`npm run desktop:dev` 仍用于本机开发。

## 已发布版本与故障处理

改动配置不会自动修复已下载或已发布的文件。启用严格模式后，需要重新构建新版本并重新下载。不要把默认模式的测试包描述为已公证包。

严格模式公证被拒绝时，工作流停止；DMG 步骤给出的 submission ID 可用于 `xcrun notarytool log` 查询 Apple 诊断。检查证书是否有效、包含私钥、属于正确团队，以及嵌套二进制签名与 entitlements 是否完整。签名后不要修改应用内文件，发布前不要用其他工具重新打包已验证产物。

最终候选包还应在干净的 Mac 上通过浏览器下载，按普通用户流程复制到 Applications 并首次启动，确认账户向导、HKU 登录窗口和本机 bridge 正常。默认模式应同时验证 README 中的安装说明；严格模式应确认无需手动解除拦截。CI 检查不能代替这项功能验收。

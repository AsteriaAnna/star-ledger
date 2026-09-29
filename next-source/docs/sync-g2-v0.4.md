# G2 第一轮：加密与 GitHub 适配器 · v0.4

## 验收结果

95 项测试通过：原有 76 项，加 19 项加密/网络契约测试。实际 GitHub Provider 通过注入的 HTTP 模拟器运行，没有连接 GitHub、创建仓库、上传私人数据或读取用户凭据。真实 GitHub 联调未通过验收，因为尚未配置独立测试仓库与授权。

## 已实现

- 随机 256 位恢复密钥；AES-256-GCM、随机 96 位 nonce、128 位认证标签。
- Envelope format=1 / protocol=2。账本 ID、设备 ID、操作起始序号及密钥标识参与认证；批次还保留既有 SHA-256 完整性校验。
- schema v3 新增持久化密文 outbox；随机密文在请求前保存，重试及数据库重开复用同一份密文。
- 远端路径 `ledger-sync/<ledger>/<device>/<seq>.json`，只追加文件，不执行更新或删除。
- GitHub 私有仓库检查、Contents API 创建文件、Git Trees 列表及 Blob SHA 固定内容读取。
- 同步请求超过 15 秒中止；身份、限流、写入冲突等返回可辨识错误。没有自动忙重试，保留本地操作供下次重试。
- 一次拉取全部下载、解密和校验后才原子写入。列表截断、序号缺口、已知历史消失或新上传文件缺失不报告同步成功。
- Token 不写入数据库或请求日志。CLI 只打印固定错误码，不打印响应正文、原始账务字段或密钥。

Provider 只搬运密文，不理解消费/退款。SecureSyncEngine 调用原有同步重放与冲突规则，UI 与网络代码没有直接改写财务表。

## 开发联调入口

要求 Node.js 24+。先使用一个**已有初始提交和 main 分支的独立私有测试仓库**，以及当前工程生成的测试 SQLite 数据库。不要使用旧版账本或正式同步仓库。

```sh
npm test
npm run key:create -- /absolute/path/outside-project/recovery.key
npm run sync:github
```

密钥生成命令不会覆盖已有文件；密钥应保存在工程外。该命令的 POSIX 0600 文件权限不等于 Windows ACL 管理；正式桌面端需系统凭据存储。恢复密钥与 GitHub Token 是不同的东西，不在聊天里发送它们。

运行 sync:github 前在本机运行环境配置：

| 变量 | 内容 |
|---|---|
| LEDGER_DB | 已存在的测试 SQLite 文件绝对路径 |
| LEDGER_DEVICE | 与数据库绑定的设备 ID |
| LEDGER_ID | 两端相同的测试账本标识，只用字母、数字、下划线或连字符 |
| LEDGER_KEY_FILE | 两端同一恢复密钥文件的本地路径 |
| LEDGER_GITHUB_OWNER | 仓库 owner |
| LEDGER_GITHUB_REPO | 独立私有同步仓库名 |
| LEDGER_GITHUB_BRANCH | 默认 main，必须已经存在 |
| LEDGER_GITHUB_TOKEN | 本机提供，针对该仓库的 Contents 读写授权 |

CLI 不自动创建仓库，也不偷偷创建一个空数据库；路径错误会停止。新设备建库/导入配置 UI 尚未实现，开发者可使用 SqliteStore 创建具有新设备 ID 的空库。不要复制数据库后把同一个设备 ID 当成两台设备运行。

## 本轮能力边界

1. **没有真实联网证据。** HTTP 模拟覆盖契约与故障路径，但 GitHub 的实际权限、分支保护、限流和跨设备运行还需联调。
2. **加密仅覆盖远端批次。** 本地 SQLite、恢复密钥文件没有实现系统级静态加密；设备密钥管理、轮换与撤销未做。
3. **恢复完整性的证明有限。** 已有设备能发现曾接受的历史消失，新设备不能凭空知道远端被删除的尾部历史；还需要可信设备头/checkpoint 才能证明完整恢复。持钥设备之间也没有独立签名身份隔离。
4. **全历史下载与重放。** 尚未实现增量下载、压缩或分页树遍历。树截断或超过读取预算直接报错；每个明文 Command 最大 256 KiB，密文最大 512 KiB。超限不会拆开财务原子操作。
5. **没有自动后台重试。** 网络错误或限流保留 outbox，下次手动/前台触发。限流等待策略与后台调度仍需接应用层。
6. **协议要求两端升级。** v0.4 加密 Provider 不读取早期明文 FakeSyncProvider 的远端格式；既有开发库中已经被 Fake 确认的历史，不会自动重置为真实 GitHub 待上传数据。
7. **G2 还未整体放行。** 静态类型检查、原生 adapter、整体解释冲突解决、可信恢复头和真实 GitHub 联调仍未完成，不能直接切换成正式长期账本。

## 接口依据

- [GitHub Contents REST API](https://docs.github.com/en/rest/repos/contents)
- [GitHub Git Trees REST API](https://docs.github.com/en/rest/git/trees)
- [Node.js Crypto](https://nodejs.org/api/crypto.html)

实现固定使用 GitHub REST 请求头版本 2022-11-28；列表采用 Git Trees 并拒绝 truncated 结果，创建文件使用 base64 内容且不传已有文件 sha。认证加密使用 Node 原生 crypto，未自创密码算法；仍需后续独立安全审阅。

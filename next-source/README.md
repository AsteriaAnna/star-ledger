# 星账 · 网页个人版 0.7

本版提供同一链接的电脑和手机界面。详细使用范围、数据边界与验收记录见 `docs/web-release-v0.7.md` 与 `docs/web-validation.json`。

```sh
npm ci
npm run dev:web
npm run build:web
npm test
npm run typecheck:web
```

浏览器验收：安装 Playwright 浏览器后运行 `npm run test:web`。也可通过 `CHROMIUM_EXECUTABLE` 指定测试浏览器路径。生成的 `web-dist` 可直接发布到 GitHub Pages 子目录。

## 底层阶段记录（历史文档）

以下为早期阶段记录；其中“没有界面”“无需 npm install”等描述仅适用于旧版本，当前以本页顶部和网页版本说明为准。

# Ledger G0 / G1 / G2 · 账务与同步验证工程

本工程是新版账本独立工程，依据本次对话中的工程冻结稿 V0.1 实现。没有读取或修改旧版仓库，没有推送 GitHub。

## 运行

安装 Node.js 24 或以上，在本目录执行：

```sh
npm test
npm run demo
```

无需 npm install；使用 Node 内置 SQLite、TypeScript 类型擦除和测试运行器。Android/Windows 将替换 SQLite adapter；Node 实现只用于底层验证。Node 运行测试不等于 TypeScript 静态类型检查，当前环境没有 tsc，因此未执行静态类型检查。

## 已实现的底层能力

- npm workspaces：domain、storage、accounting、sync 四个实际包。
- SQLite schema v3、顺序原子升级、未知版本拒绝打开、设备身份检查。
- 六类核心实体，以及来源标识、操作日志、outbox、cursor、冲突、字段版本表。
- AccountingService 批量命令：事实、操作日志、字段版本、outbox 同事务提交。
- 来源原始 payload 不允许修改；金额使用安全整数分，未知账户暂用 NULL。
- 因果操作 DAG、字段候选集合、显式冲突解决、删除 tombstone。
- 一条业务命令形成一个完整 Batch，不能拆开交易和其消费/余额影响。
- FakeSyncProvider：幂等上传、SHA-256 损坏检测、序列缺失拒绝、原子拉取。
- G0 25 项自动测试，加 G1 31 项账务测试及 20 项状态/补认测试，共 95 项（另含 19 项加密/网络测试）。包括真实 SQLite 重开、SQL outbox 写入故障、双设备模拟和跨端累计退款冲突。

## 重要语义

同字段并发不同值时，所有候选保存在 sync_conflicts。事实表中的值是按 operation_id 排序选出的**临时确定性投影**，不是已经确认的财务事实；未来 UI/统计必须读取冲突状态。已知冲突不能用普通 PATCH 悄悄覆盖，必须发出 RESOLVE_CONFLICT。

删除交易与并发修改其备注、消费分类时生成生命周期冲突。处理前保留交易可见，并保留两端操作。没有时间戳胜出规则。

当前 Account/Transaction 有 tombstone；其他实体删除与账户删除的跨实体业务约束未开放，不能把此原型作为正式财务应用。

## 尚未完成与验收边界

目前完成 G0 原型与 G1 首轮账务规则验证，**不代表整个同步协议已达到生产可靠性**。

- 账务后续：终态交易纠错、已有关联退回时重新分配消费、通用金额纠错与其跨端冲突。G1 已覆盖的场景见下文及 `docs/accounting-rules.md`。
- 对账：SourceIdentifier 表已建立，但尚无强去重、Alias、弱候选、删除后重复导入处理。
- G2：已实现 AES-GCM、GitHub Provider 与 HTTP 模拟测试；尚需真实网络联调、可信恢复头、密钥轮换、设备撤销与原生凭据管理。
- 工程：正式类型检查、后续版本升级迁移、长历史压测、操作压缩、增量投影、跨平台 SQLite adapter。
- G3/G4：UI、OCR、预算、完整分析与 Excel；星空极简视觉保留在设计约束中。

G0 为便于审计，每次投影重放完整操作历史，Fake Provider 每次拉取完整历史。cursor 已原子保存，但未用于增量下载。暂不适合大量真实交易。损坏或缺失任意设备的 Batch 会回滚本次整个拉取；后续 G2 可改进为隔离故障设备。

测试中的 crash 是同步异常注入与数据库回滚验证，不是断电、OS kill 或磁盘硬件损坏测试；离线七天是七轮离线操作模拟。SHA-256 只用于完整性检查，不提供加密或身份认证。

## 文件入口

- `packages/domain/index.ts`：类型、字段与输入校验。
- `packages/storage/migrations/001.sql`：schema v1。
- `packages/storage/index.ts`：SQLite adapter 与 Unit of Work。
- `packages/accounting/index.ts`：原子命令入口。
- `packages/accounting/business.ts`：类型化业务解释器（页面将使用这一层）。
- `packages/domain/invariants.ts`：合并历史后的跨交易财务约束。
- `packages/analytics/index.ts`：只读余额、消费与未识别账户查询。
- `packages/sync/projection.ts`：因果重放、字段冲突与删除冲突。
- `packages/sync/index.ts`：Fake provider 与同步引擎。
- `tests/core.test.ts`：验收用例；`tests/demo.ts`：双设备演示。
- `docs/decisions.md`：工程决定与下一阶段工作。

## G1 账务规则

已经实现普通消费、亲情卡、收入、内部转账、外部转账、押金、红包、提现手续费、信用账户还款、全额/部分/跨月退款与转账退回。余额由期初与 Movement 推导，消费由 Effect 推导，没有持久化合计。

外部转账、押金与红包默认不计消费；可以明确传入 consumptionAmount，或在没有关联退回时后补消费语义。押金未退部分不自动认定为消费。亲情卡与付款账户未知分开：前者没有本人余额变化，后者保留 unresolved movement。

跨月退款暂采用退款发生月冲减口径；期初余额表示 openingBalanceAt 时点（包含该时刻）的余额，只累加该时刻之后的流水。见规则文档中的具体说明，后续如产品口径调整必须连同测试修改。

并发退款合计超过原交易，或一端删除原交易另一端新建退款，都会生成 $accounting 冲突；不丢任何一端的操作。查询在存在未解决冲突时停止输出合计，防止把临时投影当作已确认金额。

## v0.3 更新

新增 SET_STATUS、BIND_ACCOUNT 与 RESOLVE_ACCOUNT_BINDING。待支付记录成功确认后沿用同一个交易 ID，保留备注和历史来源，原子补齐账务影响；重复确认不新增操作。付款账户补认与金额方向一并更新，补认信用账户时按欠款方向处理。

两端确认结果或整笔账的解释不同会保留冲突；两端相同确认只产生一份有效账务事实。升级脚本保留旧交易与操作日志，新字段 posting_plan 用于识别整体解释差异，不参与余额或消费统计。旧客户端无法理解新字段，使用此版本时参与同步的设备都需升级。

详见 `docs/lifecycle-v0.3.md`。测试没有使用真实个人账单或真实同步仓库。

## v0.4 更新

加密与 GitHub Provider 已实现，累计 95 项测试通过。仍无真实 GitHub 联调记录，G2 尚未整体放行。新增 CLI、密钥文件生成入口、schema v3 持久化密文重试。参见 `docs/sync-g2-v0.4.md` 获取配置、验收范围及未完成项。

默认 `npm test` 完全离线；仅显式运行 `npm run sync:github` 且配置凭据时才访问 GitHub。真实个人数据、恢复密钥及 Token 不包含在本源码包中。

## v0.5 更新

新增整笔账冲突解决、过期选择校验和并发解决保护，累计 104 项自动测试通过。接口见 `packages/accounting/resolution.ts`，验收范围见 `docs/settlement-resolution-v0.5.md`。

此前 v0.4 已由用户在 Windows 上完成真实 GitHub 上传/恢复/反向同步，记录见 `docs/live-validation-record.md`；本轮 v0.5 尚未进行真实联网回归。早期章节中“未联调”描述保留为当时阶段记录，以此更新为准。

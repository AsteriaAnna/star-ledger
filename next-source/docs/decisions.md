# 本轮工程决定 · 2026-09-28

1. **先建独立原型。** 当前没有可定位的新版代码工程；用户提供的冻结稿是本轮依据，不推测旧仓库路径，不修改旧版。
2. **先用 Node 内置 SQLite。** 运行环境已验证 Node 24.19.0 / SQLite 3.53.3；原生双端 adapter 未定。Domain 与 Store 接口无 Node/SQLite 依赖。
3. **货币用整数分。** V0 本轮只验证 CNY；不引入汇率。展示金额不参与余额与消费的推导。
4. **不靠设备时间解决冲突。** 操作携带已观察到的因果前沿。并发同值不冲突；不同值保留所有最大候选。
5. **Command 是跨端原子单位。** CREATE/PATCH 等操作仍然是字段级同步语言，同一次 execute 的所有操作必须一起上传、一起导入。Batch 保存 command_id/index/size，缺一条拒绝导入。
6. **本地事实和同步元数据一起提交。** 失败时 SQLite 回滚；下载不再次写 outbox，避免回声。
7. **来源不可变。** 业务修改不覆盖 raw_payload。来源字段的更细粒度展开、来源标识命令与 Alias 留到导入/对账阶段。
8. **冲突不是财务定论。** 候选完整保存，临时投影仅保证设备一致。UI/分析必须显示待解决状态，不可以把投影当作自动胜出的值。
9. **G1 增加类型化业务解释器。** BusinessAccountingService 解释业务命令，底层 AccountingService 负责事务。所有案例金额来自本次对话约定的结构化示例，不是 OCR 或真实账单导入结果。
10. **测试后保持边界。** 完成本轮测试即停止，不接 UI/OCR/GitHub，不对真实账本做故障注入。

## 下一阶段顺序

G1 首批场景已实现。继续补正式 TypeScript 工具链、原生 SQLite adapter 契约验证；之后进入 G2 加密与真实 GitHub，同步仓库必须与代码、正式账本分离。

## 模块边界

domain 无运行时平台依赖；accounting 仅依赖 Store 接口及纯重放函数；storage 实现 SQLite 适配器。sync/projection 为纯计算；sync/index 是 Node 原型装配层，当前直接使用 SQLite 同步元数据 API。后续双端化需要提取 SyncRepository 端口，不能让 Provider 访问账务表。

accounts、transactions、source_records、balance_movements、consumption_effects、transaction_links 为业务表。categories/tags/budgets、解析缓存不在本轮实现范围，不建空占位模块。Apps 只留阶段说明，无可运行页面。

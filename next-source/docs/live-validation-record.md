# Windows 与真实 GitHub 联调记录

日期：2026-09-28，Asia/Shanghai。版本：v0.4。证据来源为用户在对话中提供的本机 PowerShell 输出，非本执行环境独立重跑。

- Node.js：用户报告 v24.15.0。
- 用户本机测试：tests 95 / pass 95 / fail 0。
- 只读连接检查：GITHUB_CONNECTION_OK。
- 真实同步检查：1_UPLOAD_OK、2_RESTORE_OK、3_REVERSE_SYNC_OK、LIVE_SYNC_TEST_PASSED。

该脚本在同一 Windows 电脑建立两个独立 SQLite 数据库，通过 AsteriaAnna/ledger-sync-test 私有仓库交换加密批次。使用虚拟期初 1000 元、消费 44 元；B 恢复后断言余额 956 元、消费 44 元；B 修改备注后 A 拉取，双端冲突为空。

因此记录为：Windows 上单电脑双数据库的真实 GitHub 上传、恢复和反向同步通过。未验证 Android 实机、不同电脑、持续使用、真实网络中断、密钥恢复、全部历史防回滚或新版本 v0.5 的真实联网回归。

不保存 Token、恢复密钥或用户私人交易数据。用户本机的测试目录由用户保留。

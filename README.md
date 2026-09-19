# 星账 · 双人版

绿色是你的账本，紫色是他的账本。一起查看存款时，每笔钱仍保留各自的归属。

## 使用

直接打开：https://asteriaanna.github.io/star-ledger/

- 本仓库根目录包含可直接发布的网页应用。`index.html` 是完整应用。
- Windows 可以下载本仓库 ZIP，解压后用 Edge 或 Chrome 打开 `index.html`。首次使用先添加账户和期初余额。
- 手机与桌面安装到主屏幕需要 HTTPS 网站地址。仓库地址本身不是应用地址。
- 账单首先保存在当前设备；跨设备同步需要在应用设置中连接独立私有仓库 `AsteriaAnna/star-ledger-data`，分支 `main`。
- 访问令牌和共同保管的加密口令只在应用设置中填写，不要写进仓库或聊天。
- 双方各自的存款、流动资金、代为保管的钱分别核算；内部转账不计入消费。

详细使用方法见 `使用说明.md`。

## 开发源码

`star-ledger-source.zip` 保留完整的 `v2/`、`tests/` 和 `.github/workflows/` 目录。解压后：

```sh
python3 v2/build.py
node --test tests/accounting.cjs tests/sync.cjs
node tests/interface.cjs
```

生成的 `dist/` 与本仓库根目录的网页文件对应。上传包不包含真实账单、令牌或加密口令。

## 当前验证范围

核算、导入、加密、冲突合并和界面模拟已通过本地检查。手机安装、真实跨设备同步与离线恢复仍需在网站发布并完成个人授权后验证。不要将代码上传理解为已经连接了真实账本。

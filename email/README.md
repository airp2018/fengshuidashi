# 投稿邮箱模块

这个文件夹包含投稿邮件发送、SMTP 账户验证、附件处理、透明图片跟踪、账户隔离和网页界面。

线上入口：

`https://fengshuidashi.onrender.com/email/send`

## 文件说明

- `index.html`：投稿邮箱网页界面
- `router.js`：发送、登录、历史、查询和跟踪图片接口
- `account.js`：邮箱服务商与 SMTP 配置
- `tracking.js`：打开事件判断与账户隔离
- `filename.js`：附件文件名处理
- `test/`：邮件模块自动测试

邮件模块仍与风水大师共用同一个 Render 服务和飞书数据接口，因此不会新增服务器运行时间。邮箱授权码不会写入本文件夹或 GitHub。

## 登录保持

登录时默认勾选“记住此邮箱 30 天”。服务器使用 AES-256-GCM 将 SMTP 登录信息加密到 HttpOnly、SameSite=Strict Cookie 中，线上 HTTPS 同时设置 Secure。页面脚本无法读取 Cookie；授权码不以明文写入 localStorage、sessionStorage 或发送历史。服务重启或部署后可解密恢复，无需新增数据库。

加密密钥优先从 `EMAIL_SESSION_SECRET` 读取，否则从现有 `FEISHU_APP_SECRET` 派生；部署时必须保持环境密钥稳定，不得写入仓库。密钥更换、Cookie 清除、30 天到期或 SMTP 授权码撤销后，需要重新连接邮箱。未配置密钥时不启用持久登录，并在页面提示。

取消勾选时使用浏览器会话 Cookie，最多 12 小时；点击“切换邮箱”会清除此浏览器的 Cookie 和旧会话令牌。初次升级后需要重新登录一次，旧的内存会话无法恢复。

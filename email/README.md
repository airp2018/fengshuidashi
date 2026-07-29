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

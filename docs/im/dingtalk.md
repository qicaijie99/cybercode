# 钉钉接入

> 使用钉钉官方 Stream 模式连接 CyberCode。连接由桌面端主动发起，不需要公网 IP、回调地址、反向代理或额外安装服务。

## 1. 创建企业内部应用

1. 登录[钉钉开放平台](https://open-dev.dingtalk.com/)。
2. 创建一个企业内部应用。
3. 打开应用的“凭证与基础信息”，记下 `Client ID`（旧称 AppKey）和 `Client Secret`（旧称 AppSecret）。

请不要把 `Client Secret` 发到聊天、截图或公开仓库中。

## 2. 开启机器人 Stream 模式

1. 进入应用的“应用能力”。
2. 点击“添加应用能力”，选择“机器人”。
3. 填写机器人名称和简介。
4. 将消息接收模式选择为 **Stream 模式**。
5. 创建应用版本并发布。

钉钉官方的创建步骤可参考[创建机器人应用](https://opensource.dingtalk.com/developerpedia/docs/explore/tutorials/stream/bot/nodejs/create-bot/)和 [Stream 模式说明](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview/)。

## 3. 在 CyberCode 中保存凭据

1. 打开桌面端 `设置 -> IM 接入 -> 钉钉`。
2. 填写 `Client ID` 和 `Client Secret`。
3. “允许的用户”可以先留空。
4. 点击“保存”。

CyberCode 会自动重启本地 Adapter Sidecar，并通过官方 SDK 建立 Stream 长连接。凭据保存在本机 `~/.cyber/adapters.json`，设置接口返回时会自动脱敏。

## 4. 完成账号配对

1. 在 IM 接入页顶部点击“生成配对码”。
2. 在钉钉中私聊刚创建的机器人。
3. 将 6 位配对码发给机器人。
4. 收到“配对成功”后即可发送任务。

配对码有效期为 60 分钟且只能使用一次。也可以把钉钉员工 ID 填入“允许的用户”，多个 ID 用英文逗号分隔。

## 对话规则

- 私聊机器人时不需要 `@`。
- 群聊中必须 `@机器人` 才会触发 CyberCode。
- 群聊会按“群 + 发送者”隔离会话，避免不同成员串用同一段上下文。
- 当前钉钉通道支持文字消息；发送其他类型时机器人会明确提示，不会静默卡住。
- 支持 `/new`、`/projects`、`/status`、`/stop`、`/clear`、`/allow` 和 `/deny`。

## 命令行手动启动

桌面发布版会自动启动钉钉通道。本地开发或只运行 Adapter 时可以手动启动：

```bash
cd adapters
bun install
bun run dingtalk
```

也可以用环境变量覆盖本地配置：

```bash
export DINGTALK_CLIENT_ID="ding..."
export DINGTALK_CLIENT_SECRET="..."
bun run dingtalk
```

## 常见问题

### 保存后机器人没有响应

确认应用已经添加机器人能力、接收模式是 Stream，并且最新版本已经发布。只创建应用但没有发布时，凭据正确也收不到消息。

### 群里能看到机器人，但发消息没反应

群聊必须 `@机器人`。钉钉只会把群内明确提及机器人的消息推送到 Stream 通道。

### 提示尚未授权

回到桌面端生成新的配对码，在机器人私聊中发送；或者把发送者的员工 ID 加入“允许的用户”。

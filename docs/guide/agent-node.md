# 节点接入

CyberCode 可以把已配置的模型和智能路由，通过一个受权限约束的节点提供给其他 Agent。节点同时支持 OpenAI Chat Completions 和 Anthropic Messages 协议。供应商 API Key 不会交给外部 Agent；外部 Agent 只拿到单独生成的节点密钥。

## 在 CyberCode 中准备节点

1. 打开 **大模型与路由配置 → 节点**。
2. 为每个用户或 Agent 分别创建节点 API Key。完整密钥只显示一次，请立即填入对应的接入方。
3. 在密钥表格中点击要管理的那一行，再为这把 Key 勾选允许访问的模型或路由，并设置 `auto` 的默认目标。
4. 保存后，在 **接入配置生成器** 中选择协议，搜索模型或路由并点击结果。CyberCode 会自动生成包含 Base URL、完整接口地址、公开 ID、Model 和节点 Key 的配置卡，可逐项复制或一键复制全部。

也可以在独立 TUI 中直接完成：

```text
/node start
/node allow all
/node status
```

`/node start` 会按需启动 CyberCode 内置的本地运行时，并在尚无密钥时创建一枚 `cc_...` 密钥。完整密钥只显示一次。直接输入 `/node` 可以交互选择默认目标；脚本中也可使用 `/node default <target-id>`。还可以使用 `/node limit <数量>` 设置月请求上限、`/node rotate` 轮换密钥、`/node stop` 暂停节点、`/node revoke` 撤销密钥。`/agent-node` 和 `/gateway` 是同一个命令的别名。

::: tip 桌面端受管会话
如果 TUI 是从 CyberCode 桌面端启动的子进程，节点由桌面端本地服务统一持有。请在桌面设置中管理节点，避免两个进程同时修改密钥和端口。
:::

## 为多个用户管理 API Key

建议一个用户、设备或外部 Agent 使用一把独立 Key，不要多人共用同一个值。这样可以分别限制权限和月请求量，也能只停用发生泄露的那一把。

1. 点击 **添加 Key**，填写能识别使用者的名称，例如“张三”“CI 构建机”或“Telegram Bot”。
2. 创建后立刻复制完整 `cc_...` 密钥。CyberCode 只保存密钥摘要，关闭或刷新应用后无法还原完整值。
3. 点击密钥名称所在的行。下方的 **目标策略**、月限额和 **接入配置生成器** 都只针对当前选中的 Key。
4. 为这把 Key 勾选可用模型与路由，设置 `auto` 默认目标和月请求上限，然后保存。
5. 在生成器里选择协议和目标，把生成卡片中的地址、Model 和完整 Key 填入对应 Agent。

密钥表格中的操作含义：

| 操作 | 结果 |
| --- | --- |
| 改名 | 只修改表格中的备注名，密钥值和接入状态不变 |
| 复制 | 仅在本次创建或轮换后完整密钥仍在内存中时可用 |
| 轮换 | 只替换这一把密钥；旧值立即失效，权限、限额和本月用量保留 |
| 撤销 | 只阻止这一名用户；其他 Key 和节点继续工作 |

如果完整密钥已经变成掩码，请点击 **轮换密钥**，再把新值更新到对应 Agent。删除最后一把 Key 时节点会自动停用。

TUI 中可以使用：

```text
/node key list
/node key create CI
/node key rename CI BuildBot
/node limit 5000 --key=BuildBot
/node allow route/coding --key=BuildBot
/node default route/coding --key=BuildBot
/node rotate BuildBot
/node revoke BuildBot
```

有多把 Key 时，修改限额、权限、默认目标、轮换或撤销都必须使用 `--key=<ID、前缀或准确名称>`（或在命令末尾指定 Key）；这样不会误改其他用户。

## 第一步：接入方选择协议

先在需要接入 CyberCode 的 Agent 中找到 **添加提供商**、**自定义模型** 或 **Custom Provider**。根据它提供的选项选择协议：

| 接入方提供的选项 | 应选择的协议 |
| --- | --- |
| OpenAI Compatible、Custom OpenAI、Chat Completions | OpenAI |
| Anthropic、Anthropic Compatible、Anthropic Messages | Anthropic |
| 两种协议都有 | 优先选择该 Agent 原生推荐的协议 |

协议只决定请求格式，不决定最终使用哪家模型。OpenAI 和 Anthropic 两种协议都可以使用 CyberCode 已授权的模型与智能路由。

## 第二步：弄清 Key 和 Model

### API Key 填什么

填写 CyberCode 创建节点时显示的完整 `cc_...` 节点密钥，不要填写 Kimi、OpenAI、智谱等上游厂商的 API Key。

完整节点密钥只显示一次。如果页面现在只显示类似 `cc_xxxxx••••••` 的掩码，说明原密钥无法再次查看，需要点击 **轮换密钥** 创建新密钥，并立即填入接入方。

### Model 填什么

Model 字段接受以下三种值：

| 目的 | Model 填写值 | 效果 |
| --- | --- | --- |
| 使用 CyberCode 中设置的默认目标 | `auto` | 自动进入当前默认模型或默认智能路由 |
| 固定使用一条智能路由 | `route/<路由ID>`，例如 `route/coding` | 由该路由动态选择供应商和模型 |
| 固定直连一个模型 | `<供应商别名>/<模型ID>`，例如 `kimi/kimi-k2.6` | 始终调用指定供应商下的具体模型 |

直连模型使用稳定、可读的公开别名，不会暴露内部数据库 UUID。必须填写完整目标 ID，不能只填写界面中的 `Coding`、`kimi-k2.6` 等显示名称。最简单的做法是在节点页面的 **接入配置生成器** 中搜索并点击目标，然后直接复制配置卡；也可以使用带节点 Key 的 `GET /v1/models` 查询。

## 使用 OpenAI 协议接入

在目标 Agent 中新增 **OpenAI Compatible**、**Custom OpenAI** 或 **Chat Completions** 提供商，然后逐项填写：

| 配置项 | 填写内容 |
| --- | --- |
| API 类型 | OpenAI Chat Completions |
| Base URL | CyberCode 页面显示的基础地址，例如 `http://127.0.0.1:3456/v1` |
| API Key | CyberCode 创建时显示的完整 `cc_...` 节点密钥 |
| Model | `auto`、`route/...` 或 `<供应商别名>/<模型ID>` 完整公开 ID |

如果接入方要求填写 **Endpoint** 或完整接口地址，而不是 Base URL，请填写 `http://127.0.0.1:3456/v1/chat/completions`。

## 使用 Anthropic 协议接入

在目标 Agent 中新增 **Anthropic**、**Anthropic Compatible** 或 **Anthropic Messages** 提供商，然后逐项填写：

| 配置项 | 填写内容 |
| --- | --- |
| API 类型 | Anthropic Messages |
| Base URL | CyberCode 页面显示的 Anthropic 协议地址，例如 `http://127.0.0.1:3456` |
| API Key | CyberCode 创建时显示的完整 `cc_...` 节点密钥 |
| Model | `auto`、`route/...` 或 `<供应商别名>/<模型ID>` 完整公开 ID |

Anthropic 客户端通常会在 Base URL 后自动追加 `/v1/messages`，因此这里的地址不包含 `/v1`。如果目标 Agent 要求填写完整接口地址，请使用 `http://127.0.0.1:3456/v1/messages`。

## 验证连接

先用完整节点 Key 读取允许填写的 Model 值：

```bash
curl http://127.0.0.1:3456/v1/models \
  -H "Authorization: Bearer cc_your_node_key"
```

使用 OpenAI 协议测试：

```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Authorization: Bearer cc_your_node_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

使用 Anthropic 协议测试：

```bash
curl http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: cc_your_node_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

节点支持 `GET /v1/models`、`POST /v1/chat/completions` 和 `POST /v1/messages`，OpenAI 与 Anthropic 两种协议均支持流式响应。

## 其他设备接入

默认地址 `127.0.0.1` 只能被同一台电脑上的程序访问。手机、服务器或局域网设备接入时，应使用带 TLS 的反向代理或安全隧道转发到本机节点，再把对应 HTTPS 地址填写到“对外地址”中。

“对外地址”只改变 CyberCode 展示和返回的节点 URL，不会自动开放防火墙、监听公网端口或创建隧道。不要直接暴露本地服务端口，也不要把节点密钥发给不受信任的人。

## 权限与撤销

- 每把 Key 只能调用自己被授权的模型和路由。
- 每把 Key 有独立的每月请求上限和用量统计。
- 轮换只让该 Key 的旧值失效，不会重置它的权限、限额或本月用量。
- 撤销一把 Key 不影响其他 Key；撤销最后一把时节点才会关闭。

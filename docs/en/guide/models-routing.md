# Models, Sync, and Smart Routing

CyberCode organizes model access into clear provider groups while sharing the same local configuration between the desktop app and terminal TUI. Official API-key providers and major aggregators appear first, followed by OAuth, web sessions, image/video/audio providers, and local or custom endpoints.

## Choose a connection type

| Type | Best for | Notes |
| --- | --- | --- |
| Official API key | Stable production access and explicit billing | Keys stay on the local machine. Distinct products such as Kimi Code and Kimi remain separate entries. |
| Aggregator | Accessing many models with one account | OpenAI- and Anthropic-compatible endpoints are supported. |
| OAuth | Providers with a browser authorization flow | CyberCode stores the authorization locally and refreshes tokens when the provider supports it. |
| Web session | Reusing an existing website login | Uses cookies, JWTs, or web tokens and carries more stability, rate-limit, and account-policy risk than an official API. |
| Image/video/audio | Managing media catalogs and credentials | China-focused providers are shown first. Connection tests do not submit paid generation jobs, and media models do not become chat defaults. |
| Local/custom | LM Studio, Ollama, or a self-hosted compatible service | Configure the base URL, protocol, and custom model IDs. |

Open **Settings → Models & Routing → Model Providers** in the desktop app. Provider names follow the selected CyberCode UI language.

## OAuth login

Open an OAuth card and complete its authorization flow. A card is highlighted as connected only after authorization succeeds. For providers that support token rotation, CyberCode maintains a valid token locally instead of asking you to paste short-lived credentials repeatedly.

The provider still controls authorization scopes and account terms. Disconnecting removes the corresponding authorization stored by CyberCode.

## Web-session providers

Each web-session card tells you which cookie or web token is required. CyberCode normalizes cookie input, adds browser-compatible request headers, and keeps session continuity when an upstream response supplies a rotated token. It does not read browser data, solve CAPTCHAs, bypass account restrictions, or bypass region restrictions.

::: warning Check the provider terms
Website interfaces can change without notice and may trigger rate limits or account controls. Use only accounts and credentials you are authorized to use. Prefer an official API for production reliability.
:::

## Import and synchronize models

For API-key, custom, and local providers that expose a compatible `/models` endpoint, choose **Sync latest models** on the provider card. CyberCode merges the remote catalog while preserving model IDs entered manually.

With **Live sync** enabled, CyberCode schedules a refresh after startup and then approximately every 24 hours. OAuth, web-session, and built-in media catalogs are maintained by their own connection paths and are not overwritten by generic `/models` synchronization.

The TUI exposes the same controls:

```text
/provider status
/provider sync [provider ID or name]
/provider auto-sync on|off [provider ID or name]
```

## Build a smart route

Open **Models & Routing → Smart Routing**, create a route, add one or more available model targets, and select a strategy. CyberCode uses target availability, health history, and failure cooldowns to choose each attempt. If one target fails, it can move to the next target within the route's maximum-attempt limit.

Only configured and currently usable targets participate. Targets with a missing key, disconnected OAuth session, disabled state, or an explicit non-routable flag are excluded.

The TUI can manage and activate routes directly:

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route` is an alias for `/routing`. `create` starts with all configured stable providers; use the desktop editor for precise target order and policy.

## Share models with another agent

The **Node** turns configured models and smart routes into independently authenticated OpenAI Chat Completions and Anthropic Messages endpoints. Receiving agents never receive the original provider keys. See [Agent Node](./agent-node.md) for setup, TUI commands, and verification.

## Desktop and TUI ownership

The desktop app and standalone TUI share provider, synchronization, routing, and node settings. A standalone TUI starts the built-in local runtime on demand, with no extra proxy installation.

When the TUI is a desktop-managed child process, the desktop host owns the local server, scheduler, and node lifecycle to avoid two processes writing the same configuration. Manage the node from desktop settings in that mode.

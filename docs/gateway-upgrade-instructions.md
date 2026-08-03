# Lamplight Gateway 升级指令：Per-Agent API 配置

> 给施工方的指令。背景：当前 Gateway 只有 Anthropic + OpenAI 两个 provider，启动时各创建一个实例，用环境变量里的 key + 官方默认 base URL。这不符合需求。

## 核心需求

每个 AI 用自己的 API provider/model/endpoint。用户**不直接用官方 API 地址**，provider 种类和来源不可预知。

当前住户：
- 小克 → Anthropic Claude
- Lucien → OpenAI GPT
- 狗蛋/Jasper → Google Gemini
- 后台任务（报备动态等）→ DeepSeek 等便宜模型
- 未来会加新 AI 成员

**API 来源多样，不能假设走官方 endpoint**：
- **中转站（relay）**：第三方服务，有自己的 base_url，key 格式可能和官方不同
- **CLI/SDK 订阅转 API**：用户在 VPS 上跑 CLIProxyAPI，把 Pro 订阅转成兼容 API endpoint
- **官方 API**：也可能有，但不是默认

所以 `base_url` 是**必填**字段，不能有"留空就用官方地址"的 fallback。

## 要改什么

### 1. 新建 `api_providers` 表

```sql
CREATE TABLE api_providers (
  id TEXT PRIMARY KEY,           -- uuid
  provider_type TEXT NOT NULL,   -- 'anthropic' | 'openai' | 'google' | 'deepseek' | ...
  display_name TEXT NOT NULL,    -- 用户看到的名字，如 "小克的中转站"
  base_url TEXT NOT NULL,        -- 中转站地址，如 https://relay.example.com/v1
  api_key TEXT NOT NULL,         -- 加密存储
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

provider_type 不要用 enum，用 string —— 未来会加新的。

### 2. ModelConfig 加 `api_provider_id`

```typescript
export const modelConfigSchema = z.object({
  provider_id: z.string().min(1),     // 保留，标识 SDK 类型（anthropic/openai/google/deepseek）
  model_id: z.string().min(1),        // 模型名
  api_provider_id: z.string().min(1), // 指向 api_providers 表，决定用哪个 endpoint + key
});
```

### 3. Provider 改为动态创建

现在的问题：AnthropicProvider / OpenAIProvider 在启动时各创建一个实例。

改成：
- GatewayService 持有一个 provider 缓存 `Map<api_provider_id, AIGateway>`
- `complete()` 时根据 request 里的 `api_provider_id` 查 DB 拿到 (provider_type, base_url, api_key)
- 按 `provider_type` 选对应的 Provider class，用 (base_url, api_key) 创建实例并缓存
- Provider 构造函数全部加 `baseURL` 参数：

```typescript
// AnthropicProvider —— baseURL 必填
constructor(apiKey: string, baseURL: string) {
  this.client = new Anthropic({ apiKey, baseURL, maxRetries: 0, timeout: 30_000 });
}

// OpenAIProvider —— baseURL 必填
constructor(apiKey: string, baseURL: string) {
  this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 30_000 });
}

// 新增 GoogleProvider 等
```

Anthropic SDK 和 OpenAI SDK 都原生支持 `baseURL` 参数。DeepSeek API 兼容 OpenAI 格式，可以直接用 OpenAIProvider + DeepSeek 的 base_url。Google Gemini 需要单独的 provider（用 @google/generative-ai SDK 或走 OpenAI 兼容模式，取决于中转站支持哪种格式）。

注意：用户可能用 CLIProxyAPI（VPS 上把订阅转 API 的服务），这种 endpoint 的 base_url 格式和官方/中转站都可能不同，所以 URL 校验只检查是否合法 URL，不要校验路径格式。

### 4. GatewayCompletionRequest 加字段

```typescript
export const gatewayCompletionRequestSchema = z.object({
  provider_id: z.string().min(1),       // SDK 类型
  model_id: z.string().min(1),
  api_provider_id: z.string().min(1),   // 新增：哪个 endpoint
  messages: z.array(gatewayMessageSchema).min(1),
  // ... 其余不变
});
```

调用链：AgentProfile.model_config.api_provider_id → GatewayCompletionRequest.api_provider_id → GatewayService 查缓存/DB → 路由到正确的 provider 实例。

### 5. Settings 页面（前端）

新增 `/settings` 路由，两个 tab：

**Tab 1: API Providers（中转站管理）**
- 列表显示已配置的 provider（名称、类型、base_url、状态）
- 添加/编辑/删除 provider
- 测试连接按钮（发一个最小请求验证 key + endpoint 是否通）

**Tab 2: Agent 模型配置**
- 列表显示所有 Agent
- 每个 Agent 可选：用哪个 API provider + 用哪个 model
- 未来加新 AI 成员时也在这里配

### 6. 对应的 BFF API

```
POST   /api/settings/providers          -- 创建 provider
GET    /api/settings/providers          -- 列表
PUT    /api/settings/providers/:id      -- 更新
DELETE /api/settings/providers/:id      -- 删除
POST   /api/settings/providers/:id/test -- 测试连接

PUT    /api/settings/agents/:agent_id/model-config  -- 更新 agent 的模型配置
```

所有 settings API 需要 owner_token 鉴权。

## 红线

1. **Gateway 仍然不知道 agent_id** —— 它只看 api_provider_id + model_id，身份层和模型层保持分离
2. **api_key 不能明文存 DB** —— 至少做基本加密（AES + 环境变量里的密钥），不能 plaintext
3. **provider_type 不要 enum** —— 用 string，未来会加新 provider
4. **不要删现有的环境变量方式** —— .env 里的 key 作为 fallback，Settings 页面配置优先级更高
5. **DeepSeek 可以复用 OpenAIProvider** —— 它的 API 兼容 OpenAI 格式，只需不同的 base_url + key

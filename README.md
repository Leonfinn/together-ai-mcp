# together-ai-mcp

A Node.js [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes Together AI's inference endpoints — chat completions, image generation, vision, and embeddings — as tools callable from Claude Desktop, Cursor, VS Code, and any other MCP-compatible client.

## Why this exists

I created this MCP due to an issue I was having accessing reasoning models through Together AI.

Together AI's largest reasoning models (GLM-5, Qwen3.5-397B, MiniMax M2.5, Kimi K2.5) use a non-standard response format. During chain-of-thought generation, these models write their reasoning trace into `choices[0].message.reasoning` while leaving `choices[0].message.content` as an **empty string**. The final answer only appears in `message.content` once thinking is complete.

The problem: the OpenAI SDK — which is the standard way to call Together AI's API — sets a default `max_tokens` of 2048. For reasoning models, this budget is exhausted during the thinking phase, so `message.content` is **never populated**. You get charged for tokens, no error is raised, and the response is silently empty.

Any code that reads only `message.content` (which is every other Together AI MCP implementation I could find) returns nothing when called against these models. The failure is completely silent: no exception, no error response, just an empty string.

The fix applied in this server is straightforward once you know what's happening:

```js
// Standard approach — broken for reasoning models:
const text = completion.choices[0].message.content;

// Fixed approach — works for all models:
const message = completion.choices[0].message;
const text = message.content || message.reasoning || '';
```

The default `max_tokens` is also raised from 2048 to 4096 to give reasoning models enough budget to complete their chain of thought before producing a final answer.

---

## Features

- **Chat completions** — any Together AI text or reasoning model, with full prompt and multi-turn message support
- **Reasoning model support** — correctly handles GLM-5, Qwen3.5-397B, MiniMax M2.5, Kimi K2.5 (see above)
- **Image generation** — FLUX.1-dev, FLUX.1-schnell, Stable Diffusion XL; images saved to disk
- **Vision** — analyse images via Llama 3.2 Vision or Qwen 2.5 VL
- **Embeddings** — generate vectors for RAG/retrieval pipelines via BGE and Snowflake Arctic models

---

## Installation

### Prerequisites

- Node.js 18+
- A Together AI API key — [get one at api.together.ai](https://api.together.ai)

### Setup

```bash
git clone https://github.com/your-username/together-ai-mcp
cd together-ai-mcp
npm install
cp .env.example .env
# Edit .env and add your TOGETHER_API_KEY
```

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "together-ai": {
      "command": "node",
      "args": ["/absolute/path/to/together-ai-mcp/index.js"],
      "env": {
        "TOGETHER_API_KEY": "your_api_key_here",
        "IMAGE_OUTPUT_DIR": "/path/to/save/images"
      }
    }
  }
}
```

See [examples/claude-config.md](examples/claude-config.md) for Cursor and VS Code configuration.

---

## Tools

### `together_chat`

Call any Together AI chat or reasoning model.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model` | string | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Model ID |
| `prompt` | string | — | User message (use this OR `messages`) |
| `messages` | array | — | Multi-turn `[{role, content}]` array |
| `system` | string | — | System prompt (used with `prompt` only) |
| `temperature` | number | `0.7` | 0.0–2.0 |
| `max_tokens` | integer | `4096` | Raised from SDK default to support reasoning models |

### `together_generate_image`

Generate images using FLUX or SDXL models.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | **required** | Image description |
| `model` | string | `black-forest-labs/FLUX.1-schnell` | Model ID |
| `width` | integer | `1024` | Image width in pixels |
| `height` | integer | `1024` | Image height in pixels |
| `steps` | integer | `4` | Diffusion steps |
| `n` | integer | `1` | Number of images |
| `negative_prompt` | string | — | What to exclude |

Images are saved as PNG files to `IMAGE_OUTPUT_DIR`.

> **Note:** Image generation uses a direct `fetch` call rather than the OpenAI SDK's `images.generate()` because the SDK strips custom parameters like `steps` when calling Together AI's endpoint.

### `together_vision`

Analyse an image using a vision model.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | **required** | Question or instruction |
| `model` | string | `meta-llama/Llama-3.2-11B-Vision-Instruct` | Model ID |
| `image_url` | string | — | Public image URL |
| `image_path` | string | — | Local file path (converted to base64) |
| `max_tokens` | integer | `1024` | Max response length |

### `together_embed`

Generate text embeddings for RAG and retrieval pipelines.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `input` | string \| string[] | **required** | Text to embed |
| `model` | string | `BAAI/bge-large-en-v1.5` | Embedding model ID |

---

## Models

The server works with **any model available on Together AI's serverless API** — just pass its model ID. No configuration changes are needed.

The tables below list the models I personally use. They are provided as a reference, not as a hard limit.

### Finding model IDs

Browse all available models at [api.together.ai/models](https://api.together.ai/models). Each model's page shows its exact ID string. Pass that ID as the `model` parameter to any tool:

```json
{
  "tool": "together_chat",
  "params": {
    "model": "any-model-id-from-together-ai",
    "prompt": "Hello"
  }
}
```

The only constraint is that image generation models must be called via `together_generate_image`, vision models via `together_vision`, and embedding models via `together_embed` — you cannot call an image model through `together_chat`.

> **Dedicated endpoints:** Some models (e.g. `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8`) require a dedicated endpoint rather than the serverless API. Calling these via this server will return a 400 error from Together AI.

---

### Models I use

#### Chat / Reasoning

| Model | ID | Notes |
|---|---|---|
| Llama 3.3 70B | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Default — fast general-purpose |
| DeepSeek V3 | `deepseek-ai/DeepSeek-V3` | Strong at code and reasoning |
| DeepSeek R1 | `deepseek-ai/DeepSeek-R1` | Reasoning model |
| GLM-5 (744B) | `zai-org/GLM-5` | Reasoning model — requires fix above |
| Qwen3.5 397B | `Qwen/Qwen3.5-397B-A17B` | Reasoning model — requires fix above |
| MiniMax M2.5 | `MiniMaxAI/MiniMax-M2.5` | Reasoning model — requires fix above |
| Kimi K2.5 | `moonshotai/Kimi-K2.5` | Reasoning model — requires fix above |
| Qwen 2.5 7B | `Qwen/Qwen2.5-7B-Instruct-Turbo` | Lightweight / low cost |

#### Image generation

| Model | ID |
|---|---|
| FLUX.1-schnell | `black-forest-labs/FLUX.1-schnell` |
| FLUX.1-dev | `black-forest-labs/FLUX.1-dev` |
| Stable Diffusion XL | `stabilityai/stable-diffusion-xl-base-1.0` |

#### Vision

| Model | ID |
|---|---|
| Llama 3.2 11B Vision | `meta-llama/Llama-3.2-11B-Vision-Instruct` |
| Qwen 2.5 VL 72B | `Qwen/Qwen2.5-VL-72B-Instruct` |

#### Embeddings

| Model | ID |
|---|---|
| BGE Large | `BAAI/bge-large-en-v1.5` |
| M2-BERT 32K | `togethercomputer/m2-bert-80M-32k-retrieval` |
| Snowflake Arctic | `Snowflake/snowflake-arctic-embed-m` |

---

## Running tests

```bash
npm test
```

The test suite uses Node.js's built-in test runner and mocks all external dependencies — no API key required to run tests.

---

## Project structure

```
together-ai-mcp/
├── index.js              # MCP server and handler logic
├── package.json
├── .env.example
├── test/
│   └── index.test.js     # Full test suite (node:test, no external framework)
└── examples/
    ├── chat.md           # Example prompts for each tool and model
    └── claude-config.md  # Configuration for Claude Desktop, Cursor, VS Code
```

---

## Dependencies

- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — MCP server framework
- [`openai`](https://www.npmjs.com/package/openai) — OpenAI-compatible client used with Together AI's `baseURL`

---

## License

MIT

# Chat Examples

## Standard chat with default model (Llama 3.3 70B)

```json
{
  "tool": "together_chat",
  "params": {
    "prompt": "Explain the difference between transformer encoder and decoder architectures."
  }
}
```

## Specify a different model

```json
{
  "tool": "together_chat",
  "params": {
    "model": "deepseek-ai/DeepSeek-V3",
    "prompt": "Write a Python function to parse ISO 8601 timestamps."
  }
}
```

## Reasoning model (GLM-5, Qwen3.5-397B, MiniMax M2.5, Kimi K2.5)

These models require the `message.reasoning` fallback — this server handles it automatically.
Setting `max_tokens` to 8192 or higher gives reasoning models enough budget to complete
their chain of thought before producing a final answer.

```json
{
  "tool": "together_chat",
  "params": {
    "model": "zai-org/GLM-5",
    "prompt": "Prove that the square root of 2 is irrational.",
    "max_tokens": 8192
  }
}
```

## System prompt

```json
{
  "tool": "together_chat",
  "params": {
    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "system": "You are a terse technical writer. Use bullet points. Maximum 5 bullets per answer.",
    "prompt": "What are the main differences between REST and GraphQL?"
  }
}
```

## Multi-turn conversation

```json
{
  "tool": "together_chat",
  "params": {
    "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "messages": [
      { "role": "user", "content": "What is a monad?" },
      { "role": "assistant", "content": "A monad is a design pattern from functional programming..." },
      { "role": "user", "content": "Can you show a simple example in Haskell?" }
    ]
  }
}
```

## Image generation

```json
{
  "tool": "together_generate_image",
  "params": {
    "prompt": "A photorealistic mountain lake at golden hour, reflections in the water",
    "model": "black-forest-labs/FLUX.1-dev",
    "width": 1024,
    "height": 768,
    "steps": 20
  }
}
```

## Vision analysis

```json
{
  "tool": "together_vision",
  "params": {
    "prompt": "Describe what you see in this image in detail.",
    "image_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"
  }
}
```

## Embeddings

```json
{
  "tool": "together_embed",
  "params": {
    "input": "The quick brown fox jumps over the lazy dog",
    "model": "BAAI/bge-large-en-v1.5"
  }
}
```

## Supported models

### Chat / Reasoning

| Model | ID |
|---|---|
| Llama 3.3 70B (default) | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| DeepSeek V3 | `deepseek-ai/DeepSeek-V3` |
| DeepSeek R1 | `deepseek-ai/DeepSeek-R1` |
| GLM-5 (744B reasoning) | `zai-org/GLM-5` |
| Qwen3.5 397B (reasoning) | `Qwen/Qwen3.5-397B-A17B` |
| MiniMax M2.5 (reasoning) | `MiniMaxAI/MiniMax-M2.5` |
| Kimi K2.5 (reasoning) | `moonshotai/Kimi-K2.5` |
| Qwen 2.5 7B | `Qwen/Qwen2.5-7B-Instruct-Turbo` |

> **Note:** `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` requires a dedicated endpoint and is not available via the serverless API.

### Image generation

| Model | ID |
|---|---|
| FLUX.1-schnell (fast) | `black-forest-labs/FLUX.1-schnell` |
| FLUX.1-dev (quality) | `black-forest-labs/FLUX.1-dev` |
| Stable Diffusion XL | `stabilityai/stable-diffusion-xl-base-1.0` |

### Vision

| Model | ID |
|---|---|
| Llama 3.2 11B Vision | `meta-llama/Llama-3.2-11B-Vision-Instruct` |
| Qwen 2.5 VL 72B | `Qwen/Qwen2.5-VL-72B-Instruct` |

### Embeddings

| Model | ID |
|---|---|
| BGE Large (default) | `BAAI/bge-large-en-v1.5` |
| M2-BERT 32K | `togethercomputer/m2-bert-80M-32k-retrieval` |
| Snowflake Arctic | `Snowflake/snowflake-arctic-embed-m` |

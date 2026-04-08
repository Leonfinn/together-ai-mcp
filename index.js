import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── MIME type helper ─────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'image/png';
}

/**
 * Pure handler factory — accepts injected dependencies so handlers can be
 * unit-tested without spawning the full MCP server.
 *
 * @param {object} client        - OpenAI-compatible client instance
 * @param {string} imageOutputDir - Directory to write generated images
 * @param {Function} fetchFn     - fetch implementation (defaults to global fetch)
 * @param {string} apiKey        - Together AI API key (used in raw fetch calls)
 */
export function createHandlers(client, imageOutputDir, fetchFn = fetch, apiKey = process.env.TOGETHER_API_KEY) {
  return {
    /**
     * Call any Together AI chat or reasoning model.
     *
     * IMPORTANT: reasoning models (GLM-5, Qwen3.5-397B, MiniMax M2.5, Kimi K2.5)
     * populate message.reasoning during chain-of-thought and leave message.content
     * as an empty string until thinking is complete. We read both fields so these
     * models return output correctly instead of silently returning empty strings.
     */
    async together_chat({
      model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      prompt,
      messages,
      system,
      temperature = 0.7,
      max_tokens = 8192,
    }) {
      if (!prompt && !messages) {
        throw new Error('Either prompt or messages must be provided');
      }

      let finalMessages = [];
      if (system) {
        finalMessages.push({ role: 'system', content: system });
      }
      if (messages) {
        finalMessages = [...finalMessages, ...messages];
      } else {
        finalMessages.push({ role: 'user', content: prompt });
      }

      const completion = await client.chat.completions.create({
        model,
        messages: finalMessages,
        temperature,
        max_tokens,
      });

      if (!completion.choices?.length) {
        throw new Error('API returned no choices');
      }

      const message = completion.choices[0].message;
      // Together AI reasoning models use different fields depending on the model family:
      //   message.content           — standard + Qwen (may contain inline <think> tags)
      //   message.reasoning_content — DeepSeek-style format
      //   message.reasoning         — Together AI format (GLM-5, MiniMax, Kimi)
      // content is preferred; fall through to reasoning fields if empty.
      const text = message.content || message.reasoning_content || message.reasoning || '';
      const u = completion.usage;
      const usageNote = `\n\nTokens used: prompt=${u?.prompt_tokens ?? 0}, completion=${u?.completion_tokens ?? 0}, total=${u?.total_tokens ?? 0}`;

      return { content: [{ type: 'text', text: text + usageNote }] };
    },

    /**
     * Generate an image using FLUX or SDXL models.
     * Uses raw fetch instead of the OpenAI SDK because the SDK strips
     * custom parameters (steps, width, height) when calling Together AI.
     */
    async together_generate_image({
      prompt,
      model = 'black-forest-labs/FLUX.1-schnell',
      width = 1024,
      height = 1024,
      steps = 4,
      n = 1,
      negative_prompt,
    }) {
      // Ensure output directory exists
      fs.mkdirSync(imageOutputDir, { recursive: true });

      const body = { model, prompt, width, height, steps, n };
      if (negative_prompt) body.negative_prompt = negative_prompt;

      const response = await fetchFn('https://api.together.xyz/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Image generation failed: HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.data?.[0]) {
        throw new Error('Image generation returned empty data');
      }

      const imageData = data.data[0];

      if (imageData.b64_json) {
        const filename = `together-${Date.now()}.png`;
        const filepath = path.join(imageOutputDir, filename);
        fs.writeFileSync(filepath, Buffer.from(imageData.b64_json, 'base64'));
        return { content: [{ type: 'text', text: `Image saved to: ${filepath}` }] };
      }

      if (imageData.url) {
        return { content: [{ type: 'text', text: `Image available at: ${imageData.url}` }] };
      }

      throw new Error('No image data found in response');
    },

    /**
     * Analyse an image using a Together AI vision model.
     * Uses raw fetch (same as image generation) for better error visibility and
     * explicit stream:false, which is required by Together AI's vision models.
     * Accepts either a public URL or a local file path.
     * When a local file is used, the MIME type is inferred from the file extension.
     */
    async together_vision({
      prompt,
      model = 'meta-llama/Llama-3.2-11B-Vision-Instruct',
      image_url,
      image_path,
      max_tokens = 1024,
    }) {
      let imageUrl = image_url;

      if (image_path) {
        const resolvedPath = path.resolve(image_path);
        const mimeType = getMimeType(resolvedPath);
        const buffer = fs.readFileSync(resolvedPath);
        imageUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }

      if (!imageUrl) {
        throw new Error('Either image_url or image_path must be provided');
      }

      const response = await fetchFn('https://api.together.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Vision API error ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json();

      if (!data.choices?.[0]) {
        throw new Error('Vision API returned no choices');
      }

      return { content: [{ type: 'text', text: data.choices[0].message.content || '' }] };
    },

    /**
     * Generate text embeddings for RAG / retrieval pipelines.
     * Embedding vectors are truncated to 5 values in the MCP response for
     * readability; the full vector length is reported separately.
     */
    async together_embed({ input, model = 'BAAI/bge-large-en-v1.5' }) {
      const result = await client.embeddings.create({ model, input });

      const truncatedData = result.data.map((item) => ({
        index: item.index,
        embedding: item.embedding.slice(0, 5),
        embedding_full_length: item.embedding.length,
      }));

      const output = {
        data: truncatedData,
        usage: result.usage,
        note: 'Embedding vectors truncated to first 5 values for display. Full vectors available via direct API call.',
      };

      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    },
  };
}

// ─── Server bootstrap ────────────────────────────────────────────────────────
// Only runs when this file is the entry point, not when imported by tests.

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const IMAGE_OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || process.cwd();
  const API_KEY = process.env.TOGETHER_API_KEY;

  const openaiClient = new OpenAI({
    baseURL: 'https://api.together.xyz/v1',
    apiKey: API_KEY,
  });

  const handlers = createHandlers(openaiClient, IMAGE_OUTPUT_DIR, fetch, API_KEY);
  const server = new McpServer({ name: 'together-ai-mcp', version: '1.0.0' });

  server.tool(
    'together_chat',
    'Call any Together AI chat or reasoning model. Supports single prompts, multi-turn messages, and system prompts. Correctly handles reasoning models (GLM-5, Qwen3.5-397B, MiniMax M2.5, Kimi K2.5) that populate message.reasoning rather than message.content.',
    {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
        prompt: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
        },
        system: { type: 'string' },
        temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
        max_tokens: { type: 'integer', default: 4096 },
      },
    },
    async (params) => {
      try {
        return await handlers.together_chat(params);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'together_generate_image',
    'Generate images using FLUX.1-dev, FLUX.1-schnell, or Stable Diffusion XL. Images are saved to disk.',
    {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', default: 'black-forest-labs/FLUX.1-schnell' },
        width: { type: 'integer', default: 1024 },
        height: { type: 'integer', default: 1024 },
        steps: { type: 'integer', default: 4 },
        n: { type: 'integer', default: 1 },
        negative_prompt: { type: 'string' },
      },
    },
    async (params) => {
      try {
        return await handlers.together_generate_image(params);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'together_vision',
    'Analyse an image using a Together AI vision model. Provide either image_url (public URL) or image_path (local file). MIME type is inferred automatically from the file extension.',
    {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', default: 'meta-llama/Llama-3.2-11B-Vision-Instruct' },
        image_url: { type: 'string' },
        image_path: { type: 'string' },
        max_tokens: { type: 'integer', default: 1024 },
      },
    },
    async (params) => {
      try {
        return await handlers.together_vision(params);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'together_embed',
    'Generate text embeddings for RAG and retrieval pipelines using BGE or Snowflake Arctic models.',
    {
      type: 'object',
      required: ['input'],
      properties: {
        input: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        model: { type: 'string', default: 'BAAI/bge-large-en-v1.5' },
      },
    },
    async (params) => {
      try {
        return await handlers.together_embed(params);
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  const transport = new StdioServerTransport();
  server.connect(transport);
  console.error('Together AI MCP server running');
}

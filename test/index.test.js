import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandlers } from '../index.js';

// ─── Shared mock client factory ───────────────────────────────────────────────

function makeMockClient() {
  return {
    chat: {
      completions: {
        create: mock.fn(),
      },
    },
    embeddings: {
      create: mock.fn(),
    },
  };
}

// ─── together_chat ────────────────────────────────────────────────────────────

describe('together_chat', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = makeMockClient();
    handlers = createHandlers(client, os.tmpdir(), undefined, 'test-key');
  });

  afterEach(() => mock.restoreAll());

  it('returns text from message.content when populated', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'Hello from content', reasoning: 'Some thinking' } }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    }));

    const result = await handlers.together_chat({
      prompt: 'Hello',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    });

    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Hello from content/);
  });

  it('falls back to message.reasoning when message.content is empty (GLM-5 / Kimi format)', async () => {
    // Reasoning models (GLM-5, MiniMax, Kimi K2.5) exhaust max_tokens during
    // chain-of-thought, leaving content empty but populating message.reasoning.
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: '', reasoning: 'Step 1: think carefully...' } }],
      usage: { prompt_tokens: 10, completion_tokens: 200, total_tokens: 210 },
    }));

    const result = await handlers.together_chat({
      prompt: 'Think step by step',
      model: 'zai-org/GLM-5',
    });

    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Step 1: think carefully/);
  });

  it('falls back to message.reasoning_content when content and reasoning are empty (DeepSeek format)', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: '', reasoning: '', reasoning_content: 'DeepSeek chain of thought' } }],
      usage: { prompt_tokens: 10, completion_tokens: 200, total_tokens: 210 },
    }));

    const result = await handlers.together_chat({
      prompt: 'Reason through this',
      model: 'deepseek-ai/DeepSeek-R1',
    });

    assert.match(result.content[0].text, /DeepSeek chain of thought/);
  });

  it('returns content with inline <think> tags when present (Qwen format)', async () => {
    const contentWithThink = '<think>Let me reason...</think>The final answer is 42.';
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: contentWithThink } }],
      usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
    }));

    const result = await handlers.together_chat({
      prompt: 'What is 6 * 7?',
      model: 'Qwen/Qwen3.5-397B-A17B',
    });

    // Full content including think tags is returned
    assert.match(result.content[0].text, /The final answer is 42/);
    assert.match(result.content[0].text, /<think>/);
  });

  it('throws when neither prompt nor messages is provided', async () => {
    await assert.rejects(
      () => handlers.together_chat({ model: 'test-model' }),
      /Either prompt or messages must be provided/
    );
  });

  it('throws when API returns empty choices array', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    }));

    await assert.rejects(
      () => handlers.together_chat({ prompt: 'hi', model: 'test' }),
      /API returned no choices/
    );
  });

  it('passes temperature and max_tokens to the API', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    await handlers.together_chat({
      prompt: 'hi',
      model: 'test-model',
      temperature: 0.2,
      max_tokens: 512,
    });

    const callArgs = client.chat.completions.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.temperature, 0.2);
    assert.equal(callArgs.max_tokens, 512);
  });

  it('includes token usage in response text', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'answer' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    }));

    const result = await handlers.together_chat({ prompt: 'hi', model: 'test' });

    assert.match(result.content[0].text, /prompt=7/);
    assert.match(result.content[0].text, /completion=3/);
    assert.match(result.content[0].text, /total=10/);
  });

  it('passes multi-turn messages array directly to the API', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'Final answer' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    }));

    const messages = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up' },
    ];

    await handlers.together_chat({ messages, model: 'test-model' });

    const callArgs = client.chat.completions.create.mock.calls[0].arguments[0];
    assert.deepEqual(callArgs.messages, messages);
  });

  it('prepends system message when system param is provided with prompt', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));

    await handlers.together_chat({
      prompt: 'User query',
      system: 'You are a helpful assistant.',
      model: 'test-model',
    });

    const callArgs = client.chat.completions.create.mock.calls[0].arguments[0];
    assert.deepEqual(callArgs.messages, [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'User query' },
    ]);
  });

  it('uses default model when not specified', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    await handlers.together_chat({ prompt: 'hi' });

    const callArgs = client.chat.completions.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.model, 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
  });

  it('uses default max_tokens of 8192 (required headroom for reasoning models)', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));

    await handlers.together_chat({ prompt: 'hi' });

    const callArgs = client.chat.completions.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.max_tokens, 8192);
  });

  it('handles gracefully when both content and reasoning are empty', async () => {
    client.chat.completions.create.mock.mockImplementation(async () => ({
      choices: [{ message: { content: '', reasoning: '' } }],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    }));

    const result = await handlers.together_chat({ prompt: 'hi' });
    // Should return empty text plus usage note — no crash
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Tokens used:/);
  });
});

// ─── together_generate_image ──────────────────────────────────────────────────

describe('together_generate_image', () => {
  let client;
  let mockFetch;
  let tmpDir;
  let handlers;

  beforeEach(() => {
    client = makeMockClient();
    mockFetch = mock.fn();
    tmpDir = path.join(os.tmpdir(), `tog-test-${Date.now()}`);
    // Do NOT pre-create tmpDir — test that handler creates it automatically
    handlers = createHandlers(client, tmpDir, mockFetch, 'test-api-key');
  });

  afterEach(() => {
    mock.restoreAll();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates output directory automatically if it does not exist', async () => {
    assert.equal(fs.existsSync(tmpDir), false, 'dir should not exist before call');

    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({ prompt: 'test', model: 'test-model' });

    assert.equal(fs.existsSync(tmpDir), true, 'handler should have created the dir');
  });

  it('saves PNG file to disk when b64_json is returned', async () => {
    const fakeImageBytes = Buffer.from('FAKE_PNG_DATA');
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeImageBytes.toString('base64') }] }),
    }));

    const result = await handlers.together_generate_image({
      prompt: 'A sunset over the ocean',
      model: 'black-forest-labs/FLUX.1-schnell',
    });

    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Image saved to:/);
    assert.match(result.content[0].text, /together-\d+\.png/);

    const savedPath = result.content[0].text.replace('Image saved to: ', '');
    assert.equal(fs.existsSync(savedPath), true, 'PNG file should exist on disk');
    assert.deepEqual(fs.readFileSync(savedPath), fakeImageBytes);
  });

  it('returns URL text when url is returned (no file write)', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.together.ai/images/abc123.png' }] }),
    }));

    const result = await handlers.together_generate_image({
      prompt: 'A mountain landscape',
      model: 'black-forest-labs/FLUX.1-dev',
    });

    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Image available at:/);
    assert.match(result.content[0].text, /cdn\.together\.ai/);
  });

  it('includes negative_prompt in request body when provided', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({
      prompt: 'A cat',
      negative_prompt: 'blurry, low quality, watermark',
      model: 'black-forest-labs/FLUX.1-schnell',
    });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.negative_prompt, 'blurry, low quality, watermark');
  });

  it('omits negative_prompt from request body when not provided', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({ prompt: 'A dog', model: 'test-model' });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'negative_prompt'), false);
  });

  it('throws when API returns non-OK status', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Bad request' } }),
    }));

    await assert.rejects(
      () => handlers.together_generate_image({ prompt: 'bad', model: 'test' }),
      /Image generation failed: HTTP 400/
    );
  });

  it('throws when API returns empty data array', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));

    await assert.rejects(
      () => handlers.together_generate_image({ prompt: 'test', model: 'test' }),
      /Image generation returned empty data/
    );
  });

  it('sends correct dimensions and steps to the API', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({
      prompt: 'Portrait',
      model: 'black-forest-labs/FLUX.1-dev',
      width: 768,
      height: 1344,
      steps: 20,
    });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.width, 768);
    assert.equal(body.height, 1344);
    assert.equal(body.steps, 20);
  });

  it('sends the injected API key in the Authorization header', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({ prompt: 'test', model: 'test-model' });

    const [, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(options.headers.Authorization, 'Bearer test-api-key');
  });

  it('calls the correct Together AI endpoint', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
    }));

    await handlers.together_generate_image({ prompt: 'test', model: 'test-model' });

    const [url] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, 'https://api.together.xyz/v1/images/generations');
  });
});

// ─── together_vision ──────────────────────────────────────────────────────────
// Vision now uses raw fetch (same as image generation) so all tests use mockFetch.

describe('together_vision', () => {
  let client;
  let mockFetch;
  let tmpDir;
  let handlers;

  function mockVisionResponse(text) {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: text } }] }),
    }));
  }

  beforeEach(() => {
    client = makeMockClient();
    mockFetch = mock.fn();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tog-vision-'));
    handlers = createHandlers(client, tmpDir, mockFetch, 'test-key');
  });

  afterEach(() => {
    mock.restoreAll();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('sends image_url in the correct message content structure', async () => {
    mockVisionResponse('I see a red sports car.');

    const result = await handlers.together_vision({
      prompt: 'What is in this image?',
      image_url: 'https://example.com/car.jpg',
      model: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
    });

    assert.equal(result.content[0].type, 'text');
    assert.equal(result.content[0].text, 'I see a red sports car.');

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages[0].content, [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'https://example.com/car.jpg' } },
    ]);
    assert.equal(body.model, 'meta-llama/Llama-3.2-11B-Vision-Instruct');
  });

  it('sends stream:false in the request body', async () => {
    mockVisionResponse('ok');

    await handlers.together_vision({
      prompt: 'Describe.',
      image_url: 'https://example.com/img.jpg',
    });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.stream, false);
  });

  it('posts to the correct Together AI chat completions endpoint', async () => {
    mockVisionResponse('ok');

    await handlers.together_vision({
      prompt: 'Describe.',
      image_url: 'https://example.com/img.jpg',
    });

    const [url] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, 'https://api.together.xyz/v1/chat/completions');
  });

  it('reads a PNG file and creates correct data:image/png data URL', async () => {
    mockVisionResponse('A test image.');

    const fakeImagePath = path.join(tmpDir, 'test-image.png');
    const fakeImageData = Buffer.from('FAKE_PNG_BYTES');
    fs.writeFileSync(fakeImagePath, fakeImageData);

    await handlers.together_vision({
      prompt: 'Describe this.',
      image_path: fakeImagePath,
    });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    const imageContent = body.messages[0].content[1];
    assert.equal(imageContent.type, 'image_url');
    const expectedB64 = fakeImageData.toString('base64');
    assert.equal(imageContent.image_url.url, `data:image/png;base64,${expectedB64}`);
  });

  it('uses image/jpeg MIME type for .jpg files (not hardcoded to png)', async () => {
    mockVisionResponse('A JPEG image.');

    const jpegPath = path.join(tmpDir, 'photo.jpg');
    fs.writeFileSync(jpegPath, Buffer.from('FAKE_JPEG_DATA'));

    await handlers.together_vision({ prompt: 'Describe.', image_path: jpegPath });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    const imageContent = body.messages[0].content[1];
    assert.match(imageContent.image_url.url, /^data:image\/jpeg;base64,/);
  });

  it('uses image/webp MIME type for .webp files', async () => {
    mockVisionResponse('A WebP image.');

    const webpPath = path.join(tmpDir, 'image.webp');
    fs.writeFileSync(webpPath, Buffer.from('FAKE_WEBP_DATA'));

    await handlers.together_vision({ prompt: 'Describe.', image_path: webpPath });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    const imageContent = body.messages[0].content[1];
    assert.match(imageContent.image_url.url, /^data:image\/webp;base64,/);
  });

  it('returns the model response text', async () => {
    mockVisionResponse('This is a golden retriever.');

    const result = await handlers.together_vision({
      prompt: 'What breed of dog?',
      image_url: 'https://example.com/dog.jpg',
    });

    assert.equal(result.content[0].text, 'This is a golden retriever.');
  });

  it('throws when neither image_url nor image_path is provided', async () => {
    await assert.rejects(
      () => handlers.together_vision({ prompt: 'What is this?' }),
      /Either image_url or image_path must be provided/
    );
  });

  it('throws with status and body snippet when API returns non-OK status', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: false,
      status: 422,
      text: async () => '{"error":{"message":"Model does not support vision"}}',
    }));

    await assert.rejects(
      () => handlers.together_vision({ prompt: 'test', image_url: 'https://example.com/img.jpg' }),
      /Vision API error 422/
    );
  });

  it('throws when API returns empty choices', async () => {
    mockFetch.mock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ choices: [] }),
    }));

    await assert.rejects(
      () => handlers.together_vision({ prompt: 'test', image_url: 'https://example.com/img.jpg' }),
      /Vision API returned no choices/
    );
  });

  it('passes max_tokens in the request body', async () => {
    mockVisionResponse('ok');

    await handlers.together_vision({
      prompt: 'Describe.',
      image_url: 'https://example.com/img.jpg',
      max_tokens: 512,
    });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 512);
  });
});

// ─── together_embed ───────────────────────────────────────────────────────────

describe('together_embed', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = makeMockClient();
    handlers = createHandlers(client, os.tmpdir(), undefined, 'test-key');
  });

  afterEach(() => mock.restoreAll());

  it('handles string input and returns truncated embedding', async () => {
    const fullEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: fullEmbedding }],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }));

    const result = await handlers.together_embed({
      input: 'Hello world',
      model: 'BAAI/bge-large-en-v1.5',
    });

    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.data[0].embedding.length, 5);
    assert.equal(parsed.data[0].embedding_full_length, 1024);
    assert.deepEqual(parsed.data[0].embedding, fullEmbedding.slice(0, 5));
  });

  it('handles array input (batch embeddings)', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      usage: { prompt_tokens: 8, total_tokens: 8 },
    }));

    await handlers.together_embed({
      input: ['First text', 'Second text'],
      model: 'BAAI/bge-large-en-v1.5',
    });

    const callArgs = client.embeddings.create.mock.calls[0].arguments[0];
    assert.deepEqual(callArgs.input, ['First text', 'Second text']);
  });

  it('includes token usage in response', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: [0.5, 0.6] }],
      usage: { prompt_tokens: 12, total_tokens: 12 },
    }));

    const result = await handlers.together_embed({ input: 'test' });

    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.usage, { prompt_tokens: 12, total_tokens: 12 });
  });

  it('passes model and input to the API correctly', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: [0.1] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }));

    await handlers.together_embed({
      input: 'embed this text',
      model: 'Snowflake/snowflake-arctic-embed-m',
    });

    const callArgs = client.embeddings.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.input, 'embed this text');
    assert.equal(callArgs.model, 'Snowflake/snowflake-arctic-embed-m');
  });

  it('uses default model when not specified', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: [0.1] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));

    await handlers.together_embed({ input: 'test' });

    const callArgs = client.embeddings.create.mock.calls[0].arguments[0];
    assert.equal(callArgs.model, 'BAAI/bge-large-en-v1.5');
  });

  it('handles short embeddings (fewer than 5 values) without error', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));

    const result = await handlers.together_embed({ input: 'short' });
    const parsed = JSON.parse(result.content[0].text);
    // slice(0,5) on a 2-element array should return all 2 elements
    assert.equal(parsed.data[0].embedding.length, 2);
    assert.equal(parsed.data[0].embedding_full_length, 2);
  });

  it('returns a truncation note in the response', async () => {
    client.embeddings.create.mock.mockImplementation(async () => ({
      data: [{ index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));

    const result = await handlers.together_embed({ input: 'test' });
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.note, 'Response should include a truncation note');
  });
});

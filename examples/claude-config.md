# Adding together-ai-mcp to Claude Desktop

Edit `claude_desktop_config.json` (found at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) and add the following entry inside the `"mcpServers"` object:

```json
{
  "mcpServers": {
    "together-ai": {
      "command": "node",
      "args": ["/absolute/path/to/together-ai-mcp/index.js"],
      "env": {
        "TOGETHER_API_KEY": "your_api_key_here",
        "IMAGE_OUTPUT_DIR": "/path/to/save/generated/images"
      }
    }
  }
}
```

Replace `/absolute/path/to/together-ai-mcp/` with the actual path to your clone of this repository, and update `IMAGE_OUTPUT_DIR` to wherever you want generated images saved.

Restart Claude Desktop after saving the config. You should see `together-ai` appear in the MCP tools list.

## VS Code (with MCP extension)

Add to your VS Code `settings.json`:

```json
{
  "mcp.servers": {
    "together-ai": {
      "command": "node",
      "args": ["/absolute/path/to/together-ai-mcp/index.js"],
      "env": {
        "TOGETHER_API_KEY": "your_api_key_here",
        "IMAGE_OUTPUT_DIR": "/path/to/save/generated/images"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json` in your project root, or to `~/.cursor/mcp.json` for global access:

```json
{
  "mcpServers": {
    "together-ai": {
      "command": "node",
      "args": ["/absolute/path/to/together-ai-mcp/index.js"],
      "env": {
        "TOGETHER_API_KEY": "your_api_key_here",
        "IMAGE_OUTPUT_DIR": "/path/to/save/generated/images"
      }
    }
  }
}
```

## Verifying the connection

Once configured, ask your MCP client: *"List the available Together AI tools"* or try a simple call:

```
Use together_chat to say hello using the default model.
```

The server logs to stderr on startup: `Together AI MCP server running`

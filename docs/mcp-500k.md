# MCP Result Size Override (500K)

## What Changed

MCP tool results can now persist up to 500,000 characters via the `_meta["anthropic/maxResultSizeChars"]` annotation. Previously, large results were truncated at much smaller limits.

## Impact on JARVIS

### Exec Bridge Results
The exec bridge (Memory Gateway → M1 Poller → execution) can now return much larger results:
- Full file contents instead of truncated previews
- Complete test output without tail truncation
- Large git diffs in a single response
- Full chatlog search results

### Session Handling
The JARVIS session (`src/session.ts`) uses the Claude Agent SDK V1 `query()` API, which handles MCP result sizes internally. The SDK respects the `_meta` annotation from MCP servers.

### Gateway Worker
The Memory Gateway worker (Cloudflare Worker) should be aware that:
- Responses from exec bridge tasks may now be significantly larger
- D1 storage limits still apply for persisted results
- Consider chunking for results approaching 500K

## Configuration

No code changes needed in JARVIS — the 500K limit is handled at the MCP protocol level between Claude Code and MCP servers. The annotation is set by the MCP server, not the client.

### For Custom MCP Servers
If building a custom MCP server that returns large results, include the annotation:
```json
{
  "content": [{"type": "text", "text": "...large result..."}],
  "_meta": {
    "anthropic/maxResultSizeChars": 500000
  }
}
```

## Limitations
- 500K is the maximum, not default — servers must opt in via `_meta`
- Large results consume more context window
- Network transfer time increases for large payloads
- D1 has its own row size limits for persistence

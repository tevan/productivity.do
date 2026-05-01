// MCP transport endpoint.
//
// Uses the Streamable HTTP transport from the official MCP SDK. Same
// endpoint handles GET (polling for server-to-client messages) and POST
// (client-to-server messages). The SDK manages session state — see
// `mcp/server.js` for the McpServer wiring.

import express from 'express';
import { handleMcpRequest } from '../mcp/server.js';

const router = express.Router();

router.all('/mcp', async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'MCP error' });
    }
  }
});

export default router;

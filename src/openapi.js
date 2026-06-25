function generateOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'agents-api',
      version: '0.2.7',
      description: 'Minimal HTTP API for running locally installed agent CLIs.',
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths: {
      '/api/runs': {
        post: {
          summary: 'Run a prompt with an agent',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Agent result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/RunResponse' },
                },
              },
            },
            400: { description: 'Invalid request' },
            404: { description: 'Project not found' },
            500: { description: 'Execution error' },
            503: { description: 'Agent unavailable' },
          },
        },
      },
      '/api/runs/stream': {
        post: {
          summary: 'Run a prompt with an agent and stream SSE events',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'SSE stream. responseMode normalized emits start, session, output, result, reasoning, tool_start, tool, usage, error, and exit. responseMode raw emits start, stdout, stderr, error, and exit.',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                },
              },
            },
            400: { description: 'Invalid request' },
            404: { description: 'Project not found' },
            500: { description: 'Execution error' },
            503: { description: 'Agent unavailable' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key',
        },
      },
      schemas: {
        RunRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            agent: {
              type: 'string',
              enum: ['codex', 'claude', 'antigravity'],
              description: 'Agent to use. If omitted, the configured default is used.',
            },
            provider: {
              type: 'string',
              enum: ['codex', 'claude', 'antigravity'],
              description: 'Alias for agent. If omitted, the configured default is used.',
            },
            prompt: {
              type: 'string',
              description: 'Prompt to pass to the agent.',
            },
            project: {
              type: 'string',
              description: 'Optional configured project ID. When present, the project working directory is used.',
            },
            sessionId: {
              type: 'string',
              description: 'Optional agent session ID to resume. It must belong to the same agent and machine.',
            },
            config: {
              type: 'string',
              description: 'Optional agent argument string. When present, it overrides project and shared configuration.',
            },
            responseMode: {
              type: 'string',
              enum: ['normalized', 'raw'],
              default: 'normalized',
              description: '`normalized` returns cleaned agent output. `raw` returns technical stdout, stderr, and args.',
            },
            timeoutMs: {
              type: 'integer',
              minimum: 1,
              description: 'Optional timeout in milliseconds for terminating the agent process.',
            },
            idleTimeoutMs: {
              type: 'integer',
              minimum: 1,
              description: 'Optional timeout in milliseconds for terminating the agent process when it stops producing output.',
            },
          },
          additionalProperties: false,
        },
        RunResponse: {
          oneOf: [
            { $ref: '#/components/schemas/NormalizedRunResponse' },
            { $ref: '#/components/schemas/RawRunResponse' },
          ],
        },
        NormalizedRunResponse: {
          type: 'object',
          properties: {
            responseMode: { const: 'normalized' },
            agent: { type: 'string', enum: ['codex', 'claude', 'antigravity'] },
            provider: { type: 'string', enum: ['codex', 'claude', 'antigravity'] },
            agentVersion: { type: 'string' },
            project: { type: ['string', 'null'] },
            ok: { type: 'boolean' },
            exitCode: { type: 'integer' },
            timedOut: { type: 'boolean' },
            idleTimedOut: { type: 'boolean' },
            output: { type: 'string' },
            sessionId: { type: ['string', 'null'] },
            usage: { type: ['object', 'null'] },
            errors: {
              type: 'array',
              items: { type: 'string' },
            },
            events: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
        RawRunResponse: {
          type: 'object',
          properties: {
            responseMode: { const: 'raw' },
            agent: { type: 'string', enum: ['codex', 'claude', 'antigravity'] },
            provider: { type: 'string', enum: ['codex', 'claude', 'antigravity'] },
            agentVersion: { type: 'string' },
            project: { type: ['string', 'null'] },
            sessionId: { type: ['string', 'null'] },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            config: { type: 'string' },
            timeoutMs: { type: ['integer', 'null'] },
            timedOut: { type: 'boolean' },
            idleTimeoutMs: { type: ['integer', 'null'] },
            idleTimedOut: { type: 'boolean' },
            exitCode: { type: 'integer' },
            stdout: { type: 'string' },
            stderr: { type: 'string' },
          },
        },
      },
    },
  };
}

function swaggerHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>agents-api</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui'
      });
    </script>
  </body>
</html>`;
}

module.exports = {
  generateOpenApiSpec,
  swaggerHtml,
};

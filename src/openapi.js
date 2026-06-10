function generateOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'agents-api',
      version: '0.2.1',
      description: 'HTTP API minimale per eseguire agenti CLI installati localmente.',
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    paths: {
      '/api/runs': {
        post: {
          summary: 'Esegue un prompt con un agente',
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
              description: 'Risultato agente',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/RunResponse' },
                },
              },
            },
            400: { description: 'Richiesta non valida' },
            404: { description: 'Progetto non trovato' },
            500: { description: 'Errore di esecuzione' },
            503: { description: 'Agente non disponibile' },
          },
        },
      },
      '/api/runs/stream': {
        post: {
          summary: 'Esegue un prompt con un agente e streamma gli eventi SSE',
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
              description: 'Stream SSE. In responseMode normalized emette start, session, output, result, reasoning, tool_start, tool, usage, error, exit. In responseMode raw emette start, stdout, stderr, error, exit.',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                },
              },
            },
            400: { description: 'Richiesta non valida' },
            404: { description: 'Progetto non trovato' },
            500: { description: 'Errore di esecuzione' },
            503: { description: 'Agente non disponibile' },
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
              enum: ['codex', 'claude', 'gemini'],
              description: 'Agente da usare. Se assente usa il default pronto o il primo agente pronto.',
            },
            provider: {
              type: 'string',
              enum: ['codex', 'claude', 'gemini'],
              description: 'Alias di agent mantenuto per compatibilita.',
            },
            prompt: {
              type: 'string',
              description: 'Prompt da passare all agente.',
            },
            project: {
              type: 'string',
              description: 'ID opzionale del progetto configurato. Se presente usa la working_dir del progetto.',
            },
            config: {
              type: 'string',
              description: 'Stringa opzionale di argomenti agente. Se presente sovrascrive config progetto o condivisa.',
            },
            responseMode: {
              type: 'string',
              enum: ['normalized', 'raw'],
              default: 'normalized',
              description: '`normalized` restituisce output agentico pulito. `raw` restituisce stdout/stderr/args tecnici.',
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
            agent: { type: 'string', enum: ['codex', 'claude', 'gemini'] },
            provider: { type: 'string', enum: ['codex', 'claude', 'gemini'] },
            project: { type: ['string', 'null'] },
            ok: { type: 'boolean' },
            exitCode: { type: 'integer' },
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
            agent: { type: 'string', enum: ['codex', 'claude', 'gemini'] },
            provider: { type: 'string', enum: ['codex', 'claude', 'gemini'] },
            project: { type: ['string', 'null'] },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            config: { type: 'string' },
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
<html lang="it">
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

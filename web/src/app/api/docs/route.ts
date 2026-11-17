const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API · Ultimate Agent Builder</title>
  <meta name="color-scheme" content="light dark" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>
    :root { --bg: #ffffff; --fg: #111318; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { --bg: #0e1116; --fg: #e6e8ec; }
    }
    :root[data-theme="dark"] { --bg: #0e1116; --fg: #e6e8ec; }
    html, body { margin: 0; background: var(--bg); color: var(--fg); }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .topbar { display: none; }
    .swagger-ui .info { margin: 24px 0 16px; }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .swagger-ui { filter: invert(0.92) hue-rotate(180deg); }
      :root:not([data-theme="light"]) .swagger-ui img { filter: invert(1) hue-rotate(180deg); }
    }
    :root[data-theme="dark"] .swagger-ui { filter: invert(0.92) hue-rotate(180deg); }
    :root[data-theme="dark"] .swagger-ui img { filter: invert(1) hue-rotate(180deg); }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.addEventListener("load", function () {
      window.ui = SwaggerUIBundle({
        url: "/api/v1/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
      });
    });
  </script>
</body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

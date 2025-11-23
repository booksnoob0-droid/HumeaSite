const express = require('express');
const fetch = require('node-fetch'); // v2 syntax
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (index.html, style.css, etc.)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Turn user input into a real URL.
 * - If it looks like a full URL (starts with http) → use it
 * - If it looks like "example.com" → add https://
 * - If it looks like a normal search query → use DuckDuckGo search
 */
function normalizeInput(input) {
  if (!input) return null;
  let text = input.trim();

  // Already a URL
  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  // Looks like a bare domain and not a search phrase
  if (text.includes('.') && !text.includes(' ')) {
    return 'https://' + text;
  }

  // Treat anything else as a DuckDuckGo search query
  const q = encodeURIComponent(text);
  return 'https://duckduckgo.com/html/?q=' + q;
}

/**
 * Rewrite links in HTML so that navigation keeps going through /proxy
 * This is a *simple* regex-based approach and won’t be perfect,
 * but it works for a lot of pages.
 */
function rewriteHtml(html, baseUrl) {
  // Rewrite href="" and src=""
  html = html.replace(/(href|src)="(.*?)"/gi, (match, attr, value) => {
    const v = value.trim();

    // Skip anchors, javascript, mailto, data URIs
    if (
      v.startsWith('#') ||
      v.toLowerCase().startsWith('javascript:') ||
      v.toLowerCase().startsWith('mailto:') ||
      v.toLowerCase().startsWith('data:')
    ) {
      return match;
    }

    try {
      const abs = new URL(v, baseUrl).toString();
      return `${attr}="/proxy?url=${encodeURIComponent(abs)}"`;
    } catch (e) {
      return match;
    }
  });

  // Optional: add a small banner at the top
  const banner = `
    <div style="
      position:fixed;
      top:0;left:0;right:0;
      z-index:999999;
      background:#111;
      color:#eee;
      font-family:system-ui, sans-serif;
      font-size:12px;
      padding:6px 10px;
      border-bottom:1px solid #333;
    ">
      🔒 You are viewing this page through <b>Duck Proxy</b>.
      <span style="opacity:0.7;">Type a new URL or search above to go somewhere else.</span>
    </div>
    <div style="height:28px;"></div>
  `;

  if (html.includes('<body')) {
    // Insert banner right after <body ...>
    html = html.replace(/<body([^>]*)>/i, (match, attrs) => {
      return `<body${attrs}>${banner}`;
    });
  } else {
    // Fallback: just prepend
    html = banner + html;
  }

  return html;
}

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
  const input = req.query.url;
  const target = normalizeInput(input);

  if (!target) {
    return res.status(400).send('Missing url parameter');
  }

  console.log('[Proxy] ->', target);

  try {
    const response = await fetch(target, {
      headers: {
        // Pretend to be a normal browser
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const contentType = response.headers.get('content-type') || '';

    // For HTML: rewrite links and inject banner
    if (contentType.includes('text/html')) {
      let text = await response.text();
      text = rewriteHtml(text, target);
      res.status(response.status);
      res.set('content-type', contentType);
      return res.send(text);
    }

    // Non-HTML (images, css, js, etc) → stream through
    res.status(response.status);
    response.headers.forEach((value, key) => {
      // Skip some hop-by-hop headers if needed
      if (['content-encoding', 'transfer-encoding'].includes(key.toLowerCase()))
        return;
      res.setHeader(key, value);
    });

    response.body.pipe(res);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send('Proxy error: ' + (err.message || 'Unknown error occurred'));
  }
});

// Fallback route: serve index.html for root
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Duck Proxy listening on http://localhost:${PORT}`);
});

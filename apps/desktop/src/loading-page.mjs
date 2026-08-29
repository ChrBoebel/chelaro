const html = String.raw`<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chelaro wird gestartet</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #f7f8f3; color: #171a17;
      }
      main { display: grid; justify-items: center; gap: 18px; text-align: center; }
      .mark { width: 58px; height: 58px; filter: drop-shadow(0 10px 15px rgba(22, 26, 22, .15)); }
      .mark svg { display: block; width: 100%; height: 100%; }
      h1 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
      p { margin: -8px 0 0; color: #666d64; font-size: 13px; }
      .loader { display: flex; gap: 6px; margin-top: 6px; }
      .loader span {
        width: 6px; height: 6px; border-radius: 50%; background: #2f6f69;
        animation: pulse 1.1s infinite ease-in-out;
      }
      .loader span:nth-child(2) { animation-delay: .15s; }
      .loader span:nth-child(3) { animation-delay: .3s; }
      @keyframes pulse { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
      @media (prefers-color-scheme: dark) {
        body { background: #171a17; color: #f7f8f3; }
        p { color: #a8aea5; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 512 512">
          <rect width="512" height="512" rx="112" fill="#171a17"/>
          <g fill="#f7f8f3">
            <path d="M256 46c-21 0-39 28-39 58 0 13 3 27 7 40 21-7 43-7 64 0 4-13 7-27 7-40 0-30-18-58-39-58Z"/>
            <path d="M84 171c19-31 57-47 93-36l17 7-35 40c-20 23-42 34-69 34-12 0-16-11-12-23l6-22ZM428 171c-19-31-57-47-93-36l-17 7 35 40c20 23 42 34 69 34 12 0 16-11 12-23l-6-22Z"/>
            <ellipse cx="256" cy="286" rx="108" ry="148"/>
            <path d="M124 366c-12 26-9 62 12 82 8 8 18 5 23-5l22-44-46-45-11 12ZM388 366c12 26 9 62-12 82-8 8-18 5-23-5l-22-44 46-45 11 12Z"/>
          </g>
          <g fill="#171a17">
            <rect x="148" y="218" width="216" height="14" rx="7"/><rect x="148" y="282" width="216" height="14" rx="7"/><rect x="148" y="346" width="216" height="14" rx="7"/>
          </g>
          <g stroke="#171a17" stroke-width="12">
            <rect x="278" y="196" width="50" height="50" rx="17" fill="#f7f8f3"/><rect x="184" y="260" width="50" height="50" rx="17" fill="#79b9b2"/><rect x="278" y="324" width="50" height="50" rx="17" fill="#f7f8f3"/>
          </g>
        </svg>
      </div>
      <h1>Chelaro wird gestartet</h1>
      <p>Dein lokaler Finanzarbeitsraum wird vorbereitet.</p>
      <div class="loader" aria-label="Wird geladen"><span></span><span></span><span></span></div>
    </main>
  </body>
</html>`;

export const loadingPageUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

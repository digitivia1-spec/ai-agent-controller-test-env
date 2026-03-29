(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var widgetKey = script && script.dataset ? (script.dataset.widgetKey || '') : '';
  var srcBase = script && script.src ? new URL(script.src, window.location.href) : new URL(window.location.href);
  var widgetUrl = new URL('chatwindow.html', srcBase.href);

  var config = {
    widgetKey: widgetKey,
    webhookUrl: script.dataset.webhookUrl || new URL('webhook/website_chat_digitivia', srcBase.origin + '/').href,
    title: script.dataset.title || '',
    subtitle: script.dataset.subtitle || '',
    firstMessage: script.dataset.firstMessage || '',
    defaultTheme: script.dataset.theme || '',
    position: script.dataset.position || '',
    forcedDir: script.dataset.dir || '',
    ctaLabel: script.dataset.ctaLabel || '',
    ctaUrl: script.dataset.ctaUrl || 'https://digitivia.com',
    poweredByLabel: script.dataset.poweredBy || 'Powered by Digitivia',
    hostOrigin: window.location.origin || '',
    hostPageUrl: window.location.href || '',
    embeddedFrame: true,
    previewMode: false
  };

  function injectFrame(html) {
    var frame = document.createElement('iframe');
    frame.setAttribute('title', 'Digitivia Website Widget');
    frame.setAttribute('aria-label', 'Digitivia Website Widget');
    frame.style.position = 'fixed';
    frame.style.inset = '0';
    frame.style.width = '100vw';
    frame.style.height = '100vh';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.style.pointerEvents = 'auto';
    frame.style.zIndex = '2147483000';
    frame.allow = 'clipboard-write';

    var configScript = '<script>window.DigitiviaChatWidgetConfig = ' + JSON.stringify(config) + ';<\/script>';
    var srcdoc = html.replace('<script>', configScript + '\n<script>');
    frame.srcdoc = srcdoc;
    document.body.appendChild(frame);
  }

  fetch(widgetUrl.href, { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load widget UI');
      return res.text();
    })
    .then(injectFrame)
    .catch(function (err) {
      console.error('Digitivia widget bootstrap failed:', err);
    });
})();

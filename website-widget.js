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
    
    // --- FIXED STYLING ---
    // Instead of taking up the whole screen, we bound the iframe to a corner 
    // using a standard chat window size, so the main website stays visible.
    var position = config.position || 'bottom-right';
    
    frame.style.position = 'fixed';
    frame.style.zIndex = '2147483000';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.style.pointerEvents = 'auto';
    frame.allow = 'clipboard-write';

    // Standard chat widget dimensions
    frame.style.width = '400px'; 
    frame.style.height = '750px';
    
    // Responsive constraints so it doesn't break on mobile screens
    frame.style.maxWidth = 'calc(100vw - 40px)';
    frame.style.maxHeight = 'calc(100vh - 40px)';

    // Dynamic Positioning based on configuration
    if (position.includes('left')) {
      frame.style.left = '20px';
    } else {
      frame.style.right = '20px';
    }
    
    if (position.includes('top')) {
      frame.style.top = '20px';
    } else {
      frame.style.bottom = '20px';
    }
    // ---------------------

    var configScript = '<script>window.DigitiviaChatWidgetConfig = ' + JSON.stringify(config) + ';</script>';
    
    // Fix: Ensure the closing script tag uses the proper format when injecting
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

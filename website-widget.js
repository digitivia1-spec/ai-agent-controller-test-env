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
    
    var position = config.position || 'bottom-right';
    
    frame.style.position = 'fixed';
    frame.style.zIndex = '2147483000';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.style.colorScheme = 'normal';
    
    // Start small so it only covers the launcher button
    frame.style.width = '120px';
    frame.style.height = '120px';
    frame.style.maxWidth = '100vw';
    frame.style.maxHeight = '100vh';

    if (position.includes('left')) {
      frame.style.left = '0px';
    } else {
      frame.style.right = '0px';
    }
    
    if (position.includes('top')) {
      frame.style.top = '0px';
    } else {
      frame.style.bottom = '0px';
    }

    // 1. Inject Config
    var configScript = '<script>window.DigitiviaChatWidgetConfig = ' + JSON.stringify(config) + ';<\/script>';
    
    // 2. Inject Dynamic Resizer & Background Fix into the Widget DOM
    var autoResizerScript = `
    <style>
      /* Force the ugly blurred background to be transparent */
      html, body {
        background: transparent !important;
        background-color: transparent !important;
        backdrop-filter: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    </style>
    <script>
      (function() {
        function updateParentIframe() {
          try {
            var parentFrame = window.parent.document.querySelector('iframe[title="Digitivia Website Widget"]');
            if (!parentFrame) return;

            var maxWidth = 0;
            var maxHeight = 0;

            // Measure only the ACTUAL visible elements (launcher button, chat box, etc.)
            var children = document.body.children;
            for (var i = 0; i < children.length; i++) {
              var el = children[i];
              if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
              
              var style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                var rect = el.getBoundingClientRect();
                if (rect.width > maxWidth) maxWidth = rect.width;
                if (rect.height > maxHeight) maxHeight = rect.height;
              }
            }

            // Shrink or expand the parent iframe dynamically!
            if (maxWidth > 0 && maxHeight > 0) {
              parentFrame.style.width = (maxWidth + 25) + 'px';
              parentFrame.style.height = (maxHeight + 25) + 'px';
            }
          } catch(err) {
            console.warn('Digitivia Widget Auto-Resize Error:', err);
          }
        }

        window.addEventListener('load', updateParentIframe);
        
        // Monitor the DOM so when the chat opens, it resizes instantly
        document.addEventListener('DOMContentLoaded', function() {
          var observer = new MutationObserver(updateParentIframe);
          observer.observe(document.body, { 
            childList: true, 
            subtree: true, 
            attributes: true, 
            attributeFilter: ['style', 'class'] 
          });
          
          updateParentIframe();
          setTimeout(updateParentIframe, 500); // Catch delayed rendering
        });
      })();
    <\/script>
    `;

    // Safely inject our config and resizer scripts
    var srcdoc = html.replace('<script>', configScript + '\\n' + autoResizerScript + '\\n<script>');
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

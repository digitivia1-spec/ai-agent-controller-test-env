(function () {
  'use strict';

  var MESSAGE_READY = 'DIGITIVIA_CHAT_READY';
  var MESSAGE_INIT = 'DIGITIVIA_CHAT_INIT';
  var MESSAGE_TOGGLED = 'DIGITIVIA_CHAT_TOGGLED';
  var CLOSED_WIDTH = 120;
  var CLOSED_HEIGHT = 120;
  var OPEN_WIDTH = 400;
  var OPEN_HEIGHT = 750;
  var VIEWPORT_MARGIN = 16;

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var widgetKey = script && script.dataset ? (script.dataset.widgetKey || '') : '';
  var srcBase = script && script.src ? new URL(script.src, window.location.href) : new URL(window.location.href);
  var widgetUrl = new URL('chatwindow.html', srcBase.href);
  var widgetOrigin = widgetUrl.origin;
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

  var frame = null;
  var isOpen = false;
  var hasRevealedFrame = false;

  function mountWidgetFrame() {
    if (frame || !document.body) return;

    frame = document.createElement('iframe');
    frame.setAttribute('title', 'Digitivia Website Widget');
    frame.setAttribute('aria-label', 'Digitivia Website Widget');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('allowtransparency', 'true');
    frame.src = widgetUrl.href;
    frame.style.position = 'fixed';
    frame.style.zIndex = '2147483000';
    frame.style.display = 'block';
    frame.style.border = '0';
    frame.style.background = 'transparent';
    frame.style.overflow = 'hidden';
    frame.style.colorScheme = 'normal';
    frame.style.maxWidth = '100vw';
    frame.style.maxHeight = '100vh';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.transition = 'opacity 120ms ease';
    applyFramePosition(frame);
    applyFrameSize(false);

    window.addEventListener('message', onWidgetMessage);
    window.addEventListener('resize', onViewportResize);
    frame.addEventListener('load', function () {
      applyFrameSize(isOpen);
    });

    document.body.appendChild(frame);
  }

  function applyFramePosition(targetFrame) {
    var position = config.position || 'bottom-right';

    if (position.indexOf('left') !== -1) {
      targetFrame.style.left = '0px';
      targetFrame.style.right = 'auto';
    } else {
      targetFrame.style.right = '0px';
      targetFrame.style.left = 'auto';
    }

    if (position.indexOf('top') !== -1) {
      targetFrame.style.top = '0px';
      targetFrame.style.bottom = 'auto';
    } else {
      targetFrame.style.bottom = '0px';
      targetFrame.style.top = 'auto';
    }
  }

  function onWidgetMessage(event) {
    if (!frame || event.source !== frame.contentWindow || !isAllowedWidgetOrigin(event.origin)) return;
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === MESSAGE_READY) {
      postInitConfig();
      revealFrame();
      applyFrameSize(isOpen);
      return;
    }

    if (event.data.type === MESSAGE_TOGGLED) {
      isOpen = !!event.data.isOpen;
      applyFrameSize(isOpen);
    }
  }

  function postInitConfig() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: MESSAGE_INIT,
      config: config
    }, getMessageTargetOrigin(widgetOrigin, widgetUrl.protocol));
  }

  function onViewportResize() {
    applyFrameSize(isOpen);
  }

  function applyFrameSize(openState) {
    if (!frame) return;
    var size = openState ? getOpenFrameSize() : getClosedFrameSize();
    frame.style.width = size.width + 'px';
    frame.style.height = size.height + 'px';
  }

  function getClosedFrameSize() {
    return {
      width: CLOSED_WIDTH,
      height: CLOSED_HEIGHT
    };
  }

  function getOpenFrameSize() {
    var viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    var viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

    return {
      width: clampDimension(OPEN_WIDTH, viewportWidth - VIEWPORT_MARGIN, CLOSED_WIDTH),
      height: clampDimension(OPEN_HEIGHT, viewportHeight - VIEWPORT_MARGIN, CLOSED_HEIGHT)
    };
  }

  function clampDimension(target, maxValue, minValue) {
    var upperBound = Math.max(minValue, maxValue);
    return Math.max(minValue, Math.min(target, upperBound));
  }

  function revealFrame() {
    if (!frame || hasRevealedFrame) return;
    hasRevealedFrame = true;
    frame.style.opacity = '1';
    frame.style.pointerEvents = 'auto';
  }

  function isAllowedWidgetOrigin(origin) {
    if (widgetUrl.protocol === 'file:') {
      return origin === 'null' || origin === '';
    }
    return origin === widgetOrigin;
  }

  function getMessageTargetOrigin(origin, protocol) {
    if (protocol === 'file:' || !origin || origin === 'null') {
      return '*';
    }
    return origin;
  }

  if (document.body) {
    mountWidgetFrame();
  } else {
    document.addEventListener('DOMContentLoaded', mountWidgetFrame, { once: true });
  }
})();

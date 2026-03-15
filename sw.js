self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function resolveTargetUrl(rawLink) {
  const scopeUrl = new URL(self.registration.scope);

  if (!rawLink) {
    return scopeUrl.href;
  }

  if (rawLink.startsWith('#')) {
    return `${scopeUrl.origin}${scopeUrl.pathname}${rawLink}`;
  }

  try {
    return new URL(rawLink, scopeUrl.href).href;
  } catch (_error) {
    return scopeUrl.href;
  }
}

async function parsePushPayload(event) {
  if (!event.data) return {};

  try {
    return await event.data.json();
  } catch (_jsonError) {
    try {
      return JSON.parse(await event.data.text());
    } catch (_textError) {
      return {};
    }
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = await parsePushPayload(event);
    const title = String(payload.title || 'Digitivia Notification');
    const body = String(payload.body || payload.message || '');
    const link = payload?.data?.link || payload.link || '#orders';
    const notificationId = payload?.data?.notificationId || payload.notification_id || null;
    const icon = payload.icon || payload.image || './cropped-White.png';
    const badge = payload.badge || icon;
    const tag = payload.tag || (notificationId ? `notification-${notificationId}` : 'digitivia-order-push');

    await self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: {
        link,
        notificationId,
        orgId: payload?.data?.orgId || payload.org_id || null
      }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const link = event.notification?.data?.link || '#orders';
    const notificationId = event.notification?.data?.notificationId || null;
    const targetUrl = resolveTargetUrl(link);
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    const existingClient = clientList.find((client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch (_error) {
        return false;
      }
    });

    if (existingClient) {
      if ('navigate' in existingClient && existingClient.url !== targetUrl) {
        try {
          await existingClient.navigate(targetUrl);
        } catch (_error) {
        }
      }

      await existingClient.focus();
      existingClient.postMessage({
        type: 'push-notification-click',
        link,
        notificationId
      });
      return;
    }

    const openedClient = await self.clients.openWindow(targetUrl);
    if (openedClient) {
      openedClient.postMessage({
        type: 'push-notification-click',
        link,
        notificationId
      });
    }
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    clientList.forEach((client) => {
      client.postMessage({ type: 'push-subscription-change' });
    });
  })());
});

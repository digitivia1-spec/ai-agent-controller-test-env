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

function buildTargetLink(payload = {}) {
  if (payload?.data?.link || payload.link) {
    return payload?.data?.link || payload.link;
  }

  const entity = payload?.data?.entity || payload.entity || null;
  const entityId = payload?.data?.entityId || payload.entity_id || null;
  const eventKey = payload?.data?.eventKey || payload.event_key || null;
  const notificationId = payload?.data?.notificationId || payload.notification_id || null;

  // Route CRM/lead entities
  if (entity === 'lead' || entity === 'crm' ||
      (eventKey && (eventKey.startsWith('crm_') || eventKey.startsWith('crm_followup')))) {
    const p = new URLSearchParams();
    if (entityId) p.set('lead', entityId);
    if (eventKey) p.set('event', eventKey);
    if (notificationId) p.set('notification_id', notificationId);
    return `#crm?${p.toString()}`;
  }

  // Route task entities
  if (entity === 'task' || (eventKey && eventKey.startsWith('task_'))) {
    const p = new URLSearchParams();
    if (entityId) p.set('task', entityId);
    if (eventKey) p.set('event', eventKey);
    if (notificationId) p.set('notification_id', notificationId);
    return `#task-manager?${p.toString()}`;
  }

  const params = new URLSearchParams();
  if (entity) params.set('entity', entity);
  if (entityId) params.set('id', entityId);
  if (eventKey) params.set('event', eventKey);
  if (notificationId) params.set('notification_id', notificationId);

  const query = params.toString();
  return query ? `#orders?${query}` : '#orders';
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
    const link = buildTargetLink(payload);
    const notificationId = payload?.data?.notificationId || payload.notification_id || null;
    const entity = payload?.data?.entity || payload.entity || null;
    const entityId = payload?.data?.entityId || payload.entity_id || null;
    const eventKey = payload?.data?.eventKey || payload.event_key || null;
    const icon = payload.icon || payload.image || '/icon.png';
    const badge = payload.badge || '/icon.png';
    const tag = payload.tag || (notificationId ? `notification-${notificationId}` : `digitivia-${entity || 'push'}`);

    await self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: {
        link,
        notificationId,
        orgId: payload?.data?.orgId || payload.org_id || null,
        entity,
        entityId,
        eventKey
      }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const link = event.notification?.data?.link || '#orders';
    const notificationId = event.notification?.data?.notificationId || null;
    const entity = event.notification?.data?.entity || null;
    const entityId = event.notification?.data?.entityId || null;
    const eventKey = event.notification?.data?.eventKey || null;
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
        notificationId,
        entity,
        entityId,
        eventKey
      });
      return;
    }

    const openedClient = await self.clients.openWindow(targetUrl);
    if (openedClient) {
      openedClient.postMessage({
        type: 'push-notification-click',
        link,
        notificationId,
        entity,
        entityId,
        eventKey
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

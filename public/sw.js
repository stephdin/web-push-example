// Service worker: runs in the background, even when no tab of the site is open.

// Fired when the push service delivers a message from our server.
self.addEventListener('push', (event) => {
  // Payload is the JSON sent by /api/notify: { title, body }
  const data = event.data ? event.data.json() : {}
  // waitUntil keeps the worker alive until the notification is shown.
  // With userVisibleOnly: true, every push MUST show a notification,
  // otherwise browsers may revoke the permission.
  event.waitUntil(
    self.registration.showNotification(data.title || 'Push', { body: data.body || '' })
  )
})

// Fired when the user clicks the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Focus an existing tab of the site, or open a new one.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list[0]
      return client ? client.focus() : clients.openWindow('/')
    })
  )
})

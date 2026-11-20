// Scout's service worker: shows "Your brief is ready" pushes and opens the
// app when one is tapped. No offline caching. Registered under the site's base
// path (src/lib/hosted.ts), so every URL here is relative to its scope.

// Take over open tabs at once, so a tap can bring one to the brief.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let msg = { title: "Your brief is ready", body: "" };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    // No payload or not JSON: the default text still says it.
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: new URL("icon-192.png", self.registration.scope).href,
      tag: "brief-ready",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const today = new URL("app/", self.registration.scope).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((tabs) => {
        const tab = tabs.find((t) => t.url.startsWith(self.registration.scope));
        if (!tab) return self.clients.openWindow(today);
        return tab
          .focus()
          .then(() => tab.navigate(today))
          .catch(() => self.clients.openWindow(today));
      }),
  );
});

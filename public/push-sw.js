// Notification-only worker: does not cache private media or authenticated requests.
self.addEventListener("push", event => {
  let data;
  try { data = event.data.json(); } catch { data = {}; }
  event.waitUntil(self.registration.showNotification("GHGFlix", {
    body: typeof data.body === "string" ? data.body : "Neue Beiträge in deinen Kanälen",
    tag: "ghgflix-feeds", data: { url: "/#/kanaele" }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL("/#/kanaele", self.location.origin).href));
});

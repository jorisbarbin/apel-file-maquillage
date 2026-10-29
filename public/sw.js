
self.addEventListener("push", (event) => {
    let donnees = {};

    try {
        donnees = event.data?.json() || {};
    } catch {
        donnees = {
            title: "Le coin des petits lutins",
            body: "Une nouvelle information vous attend.",
        };
    }

    const titre = donnees.title || "Le coin des petits lutins";

    const options = {
        body: donnees.body || "Consultez votre file d'attente.",
        icon: "/logo-apel.jpeg",
        badge: "/logo-apel.jpeg",
        tag: donnees.tag || "apel-file-maquillage",
        data: {
            url: "/",
        },
    };

    event.waitUntil(
        self.registration.showNotification(titre, options)
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow("/")
    );
});

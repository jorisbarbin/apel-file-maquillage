
function convertirCleVapid(cleBase64) {
  const padding = "=".repeat((4 - (cleBase64.length % 4)) % 4);
  const base64 = (cleBase64 + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const donnees = atob(base64);

  return Uint8Array.from(donnees, (caractere) =>
    caractere.charCodeAt(0)
  );
}

export async function creerAbonnementPush() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    throw new Error(
      "Les notifications Push ne sont pas disponibles sur cet appareil."
    );
  }

  const clePublique = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  if (!clePublique) {
    throw new Error("La clé publique VAPID est manquante.");
  }

  const autorisation = await Notification.requestPermission();

  if (autorisation !== "granted") {
    throw new Error("Les notifications ne sont pas autorisées.");
  }

  const registration = await navigator.serviceWorker.ready;

  let abonnement = await registration.pushManager.getSubscription();

  if (!abonnement) {
    abonnement = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertirCleVapid(clePublique),
    });
  }

  return abonnement.toJSON();
}

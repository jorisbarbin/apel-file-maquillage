
let contexteAudio = null;

// À appeler après une interaction volontaire du parent.
export async function activerAudio() {
    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
        return false;
    }

    contexteAudio ??= new AudioContextClass();

    try {
        await contexteAudio.resume();
        return contexteAudio.state === "running";
    } catch {
        return false;
    }
}

// Petite mélodie originale de notification.
export function jouerAlerteSonore() {
    if (!contexteAudio || contexteAudio.state !== "running") {
        return false;
    }

    const maintenant = contexteAudio.currentTime;
    const notes = [659.25, 783.99, 1046.5];

    notes.forEach((frequence, index) => {
        const debut = maintenant + index * 0.18;
        const oscillateur = contexteAudio.createOscillator();
        const volume = contexteAudio.createGain();

        oscillateur.type = "sine";
        oscillateur.frequency.value = frequence;

        volume.gain.setValueAtTime(0, debut);
        volume.gain.linearRampToValueAtTime(0.12, debut + 0.025);
        volume.gain.exponentialRampToValueAtTime(
            0.001,
            debut + 0.28
        );

        oscillateur.connect(volume);
        volume.connect(contexteAudio.destination);

        oscillateur.start(debut);
        oscillateur.stop(debut + 0.3);
    });

    return true;
}

export async function listAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  return { inputs, outputs };
}

export function loadSavedDevice(key) {
  return sessionStorage.getItem(key) || "";
}

export function saveDevice(key, deviceId) {
  if (deviceId) sessionStorage.setItem(key, deviceId);
  else sessionStorage.removeItem(key);
}

export async function applySinkId(audioEl, deviceId) {
  if (!audioEl?.setSinkId) return;
  try {
    await audioEl.setSinkId(deviceId || "");
  } catch {
    /* thiết bị không hợp lệ — bỏ qua */
  }
}

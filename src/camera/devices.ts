const STORAGE_KEY = 'timeguesser.cameraDeviceId'

const BUILTIN_PATTERNS = [
  /facetime/i,
  /built[- ]?in/i,
  /integrated/i,
  /isight/i,
  /macbook/i,
  /default/i,
]

export type CameraDevice = {
  deviceId: string
  label: string
}

export function loadSavedDeviceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveDeviceId(deviceId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId)
  } catch {
    // ignore quota / private mode
  }
}

function isBuiltinLabel(label: string): boolean {
  return BUILTIN_PATTERNS.some((re) => re.test(label))
}

/** Prefer saved device, else first non-builtin (USB), else first available. */
export function pickDefaultDeviceId(
  devices: CameraDevice[],
  savedId: string | null,
): string | null {
  if (devices.length === 0) return null
  if (savedId && devices.some((d) => d.deviceId === savedId)) {
    return savedId
  }
  const usb = devices.find((d) => d.label && !isBuiltinLabel(d.label))
  return (usb ?? devices[0]).deviceId
}

export async function ensureCameraPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  })
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

export async function listVideoDevices(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Kamera ${i + 1}`,
    }))
}

export async function openCamera(
  deviceId: string | null,
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

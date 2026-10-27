import { usb, type UsbDevice } from 'usb'

/** GEZHI / POS80L USB identity (system_profiler + node-usb) */
const VENDOR_ID = 0x28e9
const PRODUCT_ID = 0x0289

let printChain: Promise<unknown> = Promise.resolve()

function ascii(s: string): string {
  // ESC/POS default code page is ASCII-ish; strip non-printable
  return s.replace(/[^\x20-\x7E\n]/g, '?')
}

/** Minimal ESC/POS: init + centered text + feed past tear bar */
export function buildEscPosReceipt(text: string): Buffer {
  const line = ascii(text.replace(/\r\n/g, '\n').trim()) || 'Hello World'
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]), // ESC @ init
    Buffer.from([0x1b, 0x61, 0x01]), // ESC a 1 center
    Buffer.from([0x1d, 0x21, 0x11]), // GS ! double width+height
    Buffer.from(`${line}\n`, 'ascii'),
    Buffer.from([0x1d, 0x21, 0x00]), // GS ! normal
    Buffer.from([0x1b, 0x61, 0x00]), // ESC a 0 left
    Buffer.from('\n\n\n\n', 'ascii'),
    Buffer.from([0x1d, 0x56, 0x00]), // GS V full cut
  ])
}

export type ScoreReceipt = {
  score: number
  totalScore: number
  round: number
  rounds: number
}

/** Round-score receipt for the fasit screen */
export function buildScoreReceipt(r: ScoreReceipt): Buffer {
  const score = String(Math.max(0, Math.round(r.score)))
  const total = String(Math.max(0, Math.round(r.totalScore)))
  const roundLine = ascii(`Runde ${r.round}/${r.rounds}`)
  const totalLine = ascii(`Totalt: ${total}`)

  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x01]), // center
    Buffer.from('TimeGuesser\n', 'ascii'),
    Buffer.from(`${roundLine}\n`, 'ascii'),
    Buffer.from('----------------\n', 'ascii'),
    Buffer.from([0x1d, 0x21, 0x11]), // double size
    Buffer.from(`${score}\n`, 'ascii'),
    Buffer.from([0x1d, 0x21, 0x00]),
    Buffer.from('poeng\n', 'ascii'),
    Buffer.from('----------------\n', 'ascii'),
    Buffer.from(`${totalLine}\n`, 'ascii'),
    Buffer.from([0x1b, 0x61, 0x00]),
    Buffer.from('\n\n\n\n', 'ascii'),
    Buffer.from([0x1d, 0x56, 0x00]),
  ])
}

async function findPrinter(): Promise<UsbDevice> {
  const device = await usb.findDeviceByIds(VENDOR_ID, PRODUCT_ID)
  if (device) return device
  throw new Error(
    `Finner ikke USB-printer (vid=0x${VENDOR_ID.toString(16)} pid=0x${PRODUCT_ID.toString(16)}). Sjekk kabel/strøm.`,
  )
}

async function writeUsb(data: Buffer): Promise<{ bytesWritten: number }> {
  const device = await findPrinter()
  await device.open()
  try {
    if (device.configuration === undefined) {
      await device.selectConfiguration(1)
    }
    const iface =
      device.configuration.interfaces.find(
        (i) =>
          i.alternate.interfaceClass === 7 ||
          i.alternate.endpoints.some(
            (e) => e.direction === 'out' && e.type === 'bulk',
          ),
      ) ?? device.configuration.interfaces[0]
    if (!iface) throw new Error('Ingen USB-interface på printeren')

    await device.claimInterface(iface.interfaceNumber)
    try {
      const outEp = iface.alternate.endpoints.find(
        (e) => e.direction === 'out' && e.type === 'bulk',
      )
      if (!outEp) throw new Error('Ingen bulk OUT-endpoint')

      // Chunk bulk OUT — full receipt rasters exceed one USB packet.
      const CHUNK = 4096
      let written = 0
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const slice = new Uint8Array(
          data.buffer,
          data.byteOffset + offset,
          Math.min(CHUNK, data.length - offset),
        )
        const result = await device.transferOut(outEp.endpointNumber, slice)
        if (result.status !== 'ok') {
          throw new Error(`USB transfer status: ${result.status}`)
        }
        written += result.bytesWritten
      }
      return { bytesWritten: written }
    } finally {
      await device.releaseInterface(iface.interfaceNumber)
    }
  } finally {
    await device.close()
  }
}

/** Queue prints so concurrent requests don't fight over the USB interface. */
export function printEscPos(data: Buffer): Promise<{ bytesWritten: number }> {
  const job = printChain.then(() => writeUsb(data))
  printChain = job.then(
    () => undefined,
    () => undefined,
  )
  return job
}

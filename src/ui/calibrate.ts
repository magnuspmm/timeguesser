import {
  ensureCameraPermission,
  listVideoDevices,
  loadSavedDeviceId,
  openCamera,
  pickDefaultDeviceId,
  saveDeviceId,
  stopStream,
  type CameraDevice,
} from '../camera/devices'
import {
  defaultStone,
  isStoneCalibrated,
  isYearFieldCalibrated,
  loadCalibration,
  saveCalibration,
  yearRangeFromCalib,
} from '../calibration/store'
import {
  CORNER_LABELS,
  MAP_CORNERS,
  MAP_TRACK_BUFFER,
  computeHomography,
  isInsideMap,
  mapRoiCameraCorners,
  pixelToMap,
  type Point2,
} from '../vision/homography'
import {
  drawVideoFrame,
  sampleHsvAt,
  trackColor,
  type TrackResult,
} from '../vision/colorTrack'
import {
  isStoneReady,
  rectFromCorners,
  roiDiff,
  sampleRoiLuma,
  type StoneRect,
} from '../vision/stoneTouch'
import {
  computeYearHomography,
  normalizeYearRange,
  yearFieldOutline,
  yearTimelineCenterLine,
  yearTimelineTicks,
} from '../vision/yearField'
import { mountMapView, type MapView } from './mapView'
import { renderNav } from './nav'

type Mode =
  | 'idle'
  | 'calibrateCorners'
  | 'calibrateYear'
  | 'calibrateStone'
  | 'sampleColor'

type LockedPose = {
  pixel: Point2
  map: Point2 | null
} | null

export function mountCalibrate(root: HTMLElement): void {
  let stream: MediaStream | null = null
  let devices: CameraDevice[] = []
  let calib = loadCalibration()
  let mode: Mode = 'idle'
  let cornerIndex = 0
  let draftCorners: Point2[] = []
  let yearCornerIndex = 0
  let draftYearCorners: Point2[] = []
  let stoneCornerIndex = 0
  let draftStoneCorners: Point2[] = []
  let locked: LockedPose = null
  let lastTrack: TrackResult | null = null
  let lastMap: Point2 | null = null
  let lastStoneDiff = 0
  let lastStoneCovered = false
  let fps = 0
  let frameCount = 0
  let fpsTimer = performance.now()
  let raf = 0
  let mapView: MapView | null = null

  const processCanvas = document.createElement('canvas')
  const maskCanvas = document.createElement('canvas')

  root.innerHTML = `
    <div class="app">
      <header class="header">
        <div class="brand">
          <h1>TimeGuesser</h1>
          <p class="tagline">Kalibrering</p>
        </div>
        <div class="header-meta">
          ${renderNav('calibrate')}
          <span id="fps">0 FPS</span>
          <span id="status" class="status">Starter…</span>
        </div>
      </header>

      <div class="layout">
        <section class="stage">
          <div class="video-wrap" id="videoWrap">
            <video id="video" playsinline autoplay muted></video>
            <canvas id="overlay"></canvas>
          </div>
          <p id="hint" class="hint"></p>
        </section>

        <aside class="sidebar">
          <div class="panel">
            <h2>Kamera</h2>
            <label class="field">
              <span>Enhet</span>
              <select id="cameraSelect"></select>
            </label>
            <button type="button" class="btn secondary" id="refreshCameras">Oppdater liste</button>
          </div>

          <div class="panel">
            <h2>Kvittering</h2>
            <label class="check">
              <input type="checkbox" id="printEnabled" ${calib.printEnabled ? 'checked' : ''} />
              Skriv ut poeng ved fasit
            </label>
          </div>

          <div class="panel">
            <h2>Kartkalibrering</h2>
            <p class="help">Klikk fire hjørner i videoen: NV → NØ → SØ → SV. Sporing skjer kun innenfor kartet (+ liten buffer).</p>
            <div class="row">
              <button type="button" class="btn" id="startCalib">Kalibrer hjørner</button>
              <button type="button" class="btn secondary" id="clearCalib">Nullstill</button>
            </div>
            <p id="calibStatus" class="meta"></p>
          </div>

          <div class="panel">
            <h2>Tidslinje</h2>
            <p class="help">
              Sett årsspenn (venstre = laveste, høyre = høyeste), deretter marker
              fire hjørner rundt den fysiske tidslinjen (NV → NØ → SØ → SV).
              Plasser en brikke (samme farge) langs linjen for å velge år.
            </p>
            <div class="row year-range-fields">
              <label class="field">
                <span>Fra år</span>
                <input type="number" id="yearMinInput" min="1000" max="9998" step="1" value="${calib.yearField.yearMin}" />
              </label>
              <label class="field">
                <span>Til år</span>
                <input type="number" id="yearMaxInput" min="1001" max="9999" step="1" value="${calib.yearField.yearMax}" />
              </label>
            </div>
            <p id="yearRangeStatus" class="meta"></p>
            <div class="row">
              <button type="button" class="btn" id="startYearCalib">Kalibrer tidslinje</button>
              <button type="button" class="btn secondary" id="clearYearCalib">Nullstill</button>
            </div>
            <p id="yearCalibStatus" class="meta"></p>
          </div>

          <div class="panel">
            <h2>Låsestein</h2>
            <p class="help">
              Marker et rektangel rundt steinen (to klikk: øvre-venstre → nedre-høyre),
              ta deretter baseline mens steinen er fri. Hånd på steinen under spill
              starter 3s nedtelling før svaret låses.
            </p>
            <div class="row">
              <button type="button" class="btn" id="startStoneCalib">Marker stein</button>
              <button type="button" class="btn secondary" id="clearStoneCalib">Nullstill</button>
            </div>
            <button type="button" class="btn" id="captureStoneBaseline">Ta baseline</button>
            <p id="stoneCalibStatus" class="meta"></p>
            <label class="field">
              <span>Følsomhet (diff-terskel) <output id="stoneTolOut">${calib.stone.diffThreshold}</output></span>
              <input type="range" id="stoneTol" min="8" max="80" value="${calib.stone.diffThreshold}" />
            </label>
            <p id="stoneLiveDiff" class="meta">Diff: —</p>
          </div>

          <div class="panel">
            <h2>Brikke (farge)</h2>
            <p class="help">Klikk på brikken i videoen, eller juster HSV manuelt.</p>
            <button type="button" class="btn" id="sampleColor">Prøv farge fra klikk</button>
            <label class="field">
              <span>Hue <output id="hOut">${calib.hsv.h}</output>°</span>
              <input type="range" id="h" min="0" max="360" value="${calib.hsv.h}" />
            </label>
            <label class="field">
              <span>Hue-toleranse <output id="hTolOut">${calib.hsv.hTol}</output>°</span>
              <input type="range" id="hTol" min="2" max="60" value="${calib.hsv.hTol}" />
            </label>
            <label class="field">
              <span>Min. metning <output id="sMinOut">${calib.hsv.sMin.toFixed(2)}</output></span>
              <input type="range" id="sMin" min="0" max="100" value="${Math.round(calib.hsv.sMin * 100)}" />
            </label>
            <label class="field">
              <span>Min. lysstyrke <output id="vMinOut">${calib.hsv.vMin.toFixed(2)}</output></span>
              <input type="range" id="vMin" min="0" max="100" value="${Math.round(calib.hsv.vMin * 100)}" />
            </label>
            <label class="check">
              <input type="checkbox" id="showMask" ${calib.showMask ? 'checked' : ''} />
              Vis sporemaske
            </label>
          </div>

          <div class="panel">
            <h2>Posisjon (test)</h2>
            <dl class="coords" id="coords">
              <div><dt>Pixel</dt><dd>—</dd></div>
              <div><dt>Kart u,v</dt><dd>—</dd></div>
              <div><dt>Areal</dt><dd>—</dd></div>
            </dl>
            <button type="button" class="btn primary" id="lockBtn">Lås posisjon</button>
            <p id="lockStatus" class="meta"></p>
          </div>

          <div class="panel map-panel">
            <h2>Kart-overlay</h2>
            <div class="map" id="map">
              <canvas id="mapCanvas" width="320" height="179"></canvas>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `

  const video = root.querySelector<HTMLVideoElement>('#video')!
  const overlay = root.querySelector<HTMLCanvasElement>('#overlay')!
  const overlayCtx = overlay.getContext('2d')!
  const videoWrap = root.querySelector<HTMLElement>('#videoWrap')!
  const cameraSelect = root.querySelector<HTMLSelectElement>('#cameraSelect')!
  const statusEl = root.querySelector<HTMLElement>('#status')!
  const fpsEl = root.querySelector<HTMLElement>('#fps')!
  const hintEl = root.querySelector<HTMLElement>('#hint')!
  const calibStatus = root.querySelector<HTMLElement>('#calibStatus')!
  const yearCalibStatus = root.querySelector<HTMLElement>('#yearCalibStatus')!
  const yearRangeStatus = root.querySelector<HTMLElement>('#yearRangeStatus')!
  const yearMinInput = root.querySelector<HTMLInputElement>('#yearMinInput')!
  const yearMaxInput = root.querySelector<HTMLInputElement>('#yearMaxInput')!
  const stoneCalibStatus = root.querySelector<HTMLElement>('#stoneCalibStatus')!
  const stoneLiveDiff = root.querySelector<HTMLElement>('#stoneLiveDiff')!
  const stoneTolInput = root.querySelector<HTMLInputElement>('#stoneTol')!
  const coordsEl = root.querySelector<HTMLElement>('#coords')!
  const lockStatus = root.querySelector<HTMLElement>('#lockStatus')!
  const mapCanvas = root.querySelector<HTMLCanvasElement>('#mapCanvas')!

  const hInput = root.querySelector<HTMLInputElement>('#h')!
  const hTolInput = root.querySelector<HTMLInputElement>('#hTol')!
  const sMinInput = root.querySelector<HTMLInputElement>('#sMin')!
  const vMinInput = root.querySelector<HTMLInputElement>('#vMin')!
  const showMaskInput = root.querySelector<HTMLInputElement>('#showMask')!
  const printEnabledInput = root.querySelector<HTMLInputElement>('#printEnabled')!

  function setStatus(text: string): void {
    statusEl.textContent = text
  }

  function persist(): void {
    saveCalibration(calib)
    updateCalibStatus()
  }

  function updateCalibStatus(): void {
    if (calib.cameraToMap && calib.cameraCorners) {
      calibStatus.textContent = 'Kalibrert · 4 hjørner lagret'
    } else {
      calibStatus.textContent = 'Ikke kalibrert'
    }
    const range = yearRangeFromCalib(calib)
    if (isYearFieldCalibrated(calib)) {
      yearCalibStatus.textContent = `Kalibrert · ${range.min}–${range.max}`
    } else {
      yearCalibStatus.textContent = `Ikke kalibrert · spenn ${range.min}–${range.max}`
    }
    if (isStoneCalibrated(calib)) {
      stoneCalibStatus.textContent = 'Klar · ROI + baseline lagret'
    } else if (calib.stone.rect) {
      stoneCalibStatus.textContent = 'ROI satt · ta baseline uten hånd'
    } else {
      stoneCalibStatus.textContent = 'Ikke satt'
    }
  }

  function applyYearRangeFromInputs(): boolean {
    const range = normalizeYearRange(
      Number(yearMinInput.value),
      Number(yearMaxInput.value),
    )
    if (!range) {
      yearRangeStatus.textContent =
        'Ugyldig spenn (fra < til, begge mellom 1000 og 9999)'
      yearRangeStatus.classList.add('status-error')
      return false
    }
    yearMinInput.value = String(range.min)
    yearMaxInput.value = String(range.max)
    calib = {
      ...calib,
      yearField: {
        ...calib.yearField,
        yearMin: range.min,
        yearMax: range.max,
      },
    }
    yearRangeStatus.textContent = ''
    yearRangeStatus.classList.remove('status-error')
    persist()
    return true
  }

  function updateHint(): void {
    if (mode === 'calibrateCorners') {
      hintEl.textContent = `Klikk hjørne ${cornerIndex + 1}/4 (${CORNER_LABELS[cornerIndex]})`
    } else if (mode === 'calibrateYear') {
      hintEl.textContent = `Tidslinje: klikk hjørne ${yearCornerIndex + 1}/4 (${CORNER_LABELS[yearCornerIndex]})`
    } else if (mode === 'calibrateStone') {
      hintEl.textContent =
        stoneCornerIndex === 0
          ? 'Stein: klikk øvre-venstre hjørne'
          : 'Stein: klikk nedre-høyre hjørne'
    } else if (mode === 'sampleColor') {
      hintEl.textContent = 'Klikk på spillbrikken i videoen for å hente farge'
    } else if (!calib.cameraToMap) {
      hintEl.textContent = 'Start med å kalibrere kartets fire hjørner'
    } else if (!isYearFieldCalibrated(calib)) {
      hintEl.textContent = 'Valgfritt: kalibrer tidslinjen for årstall'
    } else if (!isStoneCalibrated(calib)) {
      hintEl.textContent = 'Valgfritt: marker låsestein og ta baseline'
    } else {
      hintEl.textContent =
        'Plasser brikken på kartet · hånd på steinen eller «Lås svar»'
    }
  }

  function finishStoneCalibration(corners: Point2[]): void {
    const rect = rectFromCorners(corners[0], corners[1])
    if (!rect) {
      setStatus('Stein-ROI for liten – prøv igjen')
      mode = 'idle'
      draftStoneCorners = []
      stoneCornerIndex = 0
      updateHint()
      return
    }
    calib = {
      ...calib,
      stone: {
        ...calib.stone,
        rect,
        baseline: null,
        baselineW: 0,
        baselineH: 0,
      },
    }
    persist()
    mode = 'idle'
    draftStoneCorners = []
    stoneCornerIndex = 0
    setStatus('Stein-ROI satt · ta baseline')
    updateHint()
  }

  function captureStoneBaseline(): void {
    if (!calib.stone.rect) {
      stoneCalibStatus.textContent = 'Marker steinen først'
      return
    }
    if (video.readyState < 2) {
      stoneCalibStatus.textContent = 'Kamera ikke klart'
      return
    }
    const { imageData, scaleX, scaleY } = drawVideoFrame(video, processCanvas, 480)
    const sample = sampleRoiLuma(imageData, calib.stone.rect, scaleX, scaleY)
    if (!sample) {
      stoneCalibStatus.textContent = 'Kunne ikke sample ROI'
      return
    }
    calib = {
      ...calib,
      stone: {
        ...calib.stone,
        baseline: Array.from(sample.data),
        baselineW: sample.baselineW,
        baselineH: sample.baselineH,
      },
    }
    persist()
    setStatus('Stein-baseline lagret')
    updateHint()
  }

  function syncHsvOutputs(): void {
    root.querySelector('#hOut')!.textContent = String(Math.round(calib.hsv.h))
    root.querySelector('#hTolOut')!.textContent = String(Math.round(calib.hsv.hTol))
    root.querySelector('#sMinOut')!.textContent = calib.hsv.sMin.toFixed(2)
    root.querySelector('#vMinOut')!.textContent = calib.hsv.vMin.toFixed(2)
  }

  function fillCameraSelect(selectedId: string | null): void {
    cameraSelect.innerHTML = ''
    if (devices.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'Ingen kamera funnet'
      cameraSelect.appendChild(opt)
      return
    }
    for (const d of devices) {
      const opt = document.createElement('option')
      opt.value = d.deviceId
      opt.textContent = d.label
      cameraSelect.appendChild(opt)
    }
    if (selectedId) cameraSelect.value = selectedId
  }

  async function refreshDevicesAndStart(preferredId?: string | null): Promise<void> {
    try {
      setStatus('Ber om kameratilgang…')
      await ensureCameraPermission()
      devices = await listVideoDevices()
      const saved = preferredId ?? loadSavedDeviceId()
      const id = pickDefaultDeviceId(devices, saved)
      fillCameraSelect(id)
      if (id) {
        await startCamera(id)
      } else {
        setStatus('Ingen kamera tilgjengelig')
      }
    } catch (err) {
      console.error(err)
      setStatus('Kameratilgang feilet')
      hintEl.textContent =
        'Tillat kamera i nettleseren (helst localhost / HTTPS) og prøv igjen.'
    }
  }

  async function startCamera(deviceId: string): Promise<void> {
    stopStream(stream)
    stream = null
    setStatus('Starter kamera…')
    try {
      stream = await openCamera(deviceId)
      video.srcObject = stream
      await video.play()
      saveDeviceId(deviceId)
      setStatus('Kamera aktivt')
      sizeOverlay()
    } catch (err) {
      console.error(err)
      setStatus('Kunne ikke starte kamera')
    }
  }

  function sizeOverlay(): void {
    const rect = videoWrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    overlay.width = Math.round(rect.width * dpr)
    overlay.height = Math.round(rect.height * dpr)
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function videoPointFromClick(ev: MouseEvent): Point2 | null {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return null
    const rect = video.getBoundingClientRect()
    const scale = Math.min(rect.width / vw, rect.height / vh)
    const dispW = vw * scale
    const dispH = vh * scale
    const offsetX = (rect.width - dispW) / 2
    const offsetY = (rect.height - dispH) / 2
    const x = (ev.clientX - rect.left - offsetX) / scale
    const y = (ev.clientY - rect.top - offsetY) / scale
    if (x < 0 || y < 0 || x > vw || y > vh) return null
    return { x, y }
  }

  function finishCornerCalibration(corners: Point2[]): void {
    const h = computeHomography(corners, MAP_CORNERS)
    if (!h) {
      setStatus('Homografi feilet – prøv igjen')
      mode = 'idle'
      updateHint()
      return
    }
    calib = {
      ...calib,
      cameraCorners: corners.map((c) => ({ ...c })),
      cameraToMap: h,
    }
    persist()
    mode = 'idle'
    draftCorners = []
    cornerIndex = 0
    setStatus('Kart kalibrert')
    updateHint()
  }

  function finishYearCalibration(corners: Point2[]): void {
    const h = computeYearHomography(corners)
    if (!h) {
      setStatus('Tidslinje-homografi feilet – prøv igjen')
      mode = 'idle'
      updateHint()
      return
    }
    calib = {
      ...calib,
      yearField: {
        ...calib.yearField,
        cameraCorners: corners.map((c) => ({ ...c })),
        cameraToYear: h,
      },
    }
    persist()
    mode = 'idle'
    draftYearCorners = []
    yearCornerIndex = 0
    setStatus('Tidslinje kalibrert')
    updateHint()
  }

  videoWrap.addEventListener('click', (ev) => {
    const pt = videoPointFromClick(ev)
    if (!pt) return

    if (mode === 'calibrateCorners') {
      draftCorners.push(pt)
      cornerIndex++
      if (draftCorners.length === 4) {
        finishCornerCalibration(draftCorners)
      } else {
        updateHint()
      }
      return
    }

    if (mode === 'calibrateYear') {
      draftYearCorners.push(pt)
      yearCornerIndex++
      if (draftYearCorners.length === 4) {
        finishYearCalibration(draftYearCorners)
      } else {
        updateHint()
      }
      return
    }

    if (mode === 'calibrateStone') {
      draftStoneCorners.push(pt)
      stoneCornerIndex++
      if (draftStoneCorners.length === 2) {
        finishStoneCalibration(draftStoneCorners)
      } else {
        updateHint()
      }
      return
    }

    if (mode === 'sampleColor') {
      const { imageData, scaleX, scaleY } = drawVideoFrame(video, processCanvas, 640)
      const sx = pt.x / scaleX
      const sy = pt.y / scaleY
      const hsv = sampleHsvAt(imageData, sx, sy)
      if (hsv) {
        calib = {
          ...calib,
          hsv: {
            ...calib.hsv,
            h: Math.round(hsv.h),
            sMin: Math.max(0.15, hsv.s * 0.55),
            vMin: Math.max(0.12, hsv.v * 0.45),
          },
        }
        hInput.value = String(calib.hsv.h)
        sMinInput.value = String(Math.round(calib.hsv.sMin * 100))
        vMinInput.value = String(Math.round(calib.hsv.vMin * 100))
        syncHsvOutputs()
        persist()
        setStatus(`Farge hentet · H=${calib.hsv.h}°`)
      }
      mode = 'idle'
      updateHint()
    }
  })

  root.querySelector('#startCalib')!.addEventListener('click', () => {
    mode = 'calibrateCorners'
    cornerIndex = 0
    draftCorners = []
    locked = null
    lockStatus.textContent = ''
    updateHint()
    setStatus('Kalibreringsmodus')
  })

  root.querySelector('#clearCalib')!.addEventListener('click', () => {
    calib = { ...calib, cameraCorners: null, cameraToMap: null }
    persist()
    mode = 'idle'
    draftCorners = []
    updateHint()
    setStatus('Kalibrering nullstilt')
  })

  yearMinInput.addEventListener('change', () => {
    applyYearRangeFromInputs()
  })
  yearMaxInput.addEventListener('change', () => {
    applyYearRangeFromInputs()
  })

  root.querySelector('#startYearCalib')!.addEventListener('click', () => {
    if (!applyYearRangeFromInputs()) return
    mode = 'calibrateYear'
    yearCornerIndex = 0
    draftYearCorners = []
    locked = null
    lockStatus.textContent = ''
    updateHint()
    setStatus('Tidslinje-kalibrering')
  })

  root.querySelector('#clearYearCalib')!.addEventListener('click', () => {
    const range = yearRangeFromCalib(calib)
    calib = {
      ...calib,
      yearField: {
        cameraCorners: null,
        cameraToYear: null,
        yearMin: range.min,
        yearMax: range.max,
      },
    }
    persist()
    mode = 'idle'
    draftYearCorners = []
    yearCornerIndex = 0
    updateHint()
    setStatus('Tidslinje nullstilt')
  })

  root.querySelector('#startStoneCalib')!.addEventListener('click', () => {
    mode = 'calibrateStone'
    stoneCornerIndex = 0
    draftStoneCorners = []
    locked = null
    lockStatus.textContent = ''
    updateHint()
    setStatus('Stein-kalibrering')
  })

  root.querySelector('#clearStoneCalib')!.addEventListener('click', () => {
    calib = {
      ...calib,
      stone: {
        ...defaultStone(),
        diffThreshold: calib.stone.diffThreshold,
      },
    }
    persist()
    mode = 'idle'
    draftStoneCorners = []
    stoneCornerIndex = 0
    lastStoneDiff = 0
    lastStoneCovered = false
    updateHint()
    setStatus('Stein nullstilt')
  })

  root.querySelector('#captureStoneBaseline')!.addEventListener('click', () => {
    captureStoneBaseline()
  })

  stoneTolInput.addEventListener('input', () => {
    calib.stone.diffThreshold = Number(stoneTolInput.value)
    root.querySelector('#stoneTolOut')!.textContent = String(
      Math.round(calib.stone.diffThreshold),
    )
    persist()
  })

  root.querySelector('#sampleColor')!.addEventListener('click', () => {
    mode = 'sampleColor'
    updateHint()
  })

  root.querySelector('#refreshCameras')!.addEventListener('click', () => {
    void refreshDevicesAndStart(cameraSelect.value || null)
  })

  cameraSelect.addEventListener('change', () => {
    const id = cameraSelect.value
    if (id) void startCamera(id)
  })

  hInput.addEventListener('input', () => {
    calib.hsv.h = Number(hInput.value)
    syncHsvOutputs()
    persist()
  })
  hTolInput.addEventListener('input', () => {
    calib.hsv.hTol = Number(hTolInput.value)
    syncHsvOutputs()
    persist()
  })
  sMinInput.addEventListener('input', () => {
    calib.hsv.sMin = Number(sMinInput.value) / 100
    syncHsvOutputs()
    persist()
  })
  vMinInput.addEventListener('input', () => {
    calib.hsv.vMin = Number(vMinInput.value) / 100
    syncHsvOutputs()
    persist()
  })
  showMaskInput.addEventListener('change', () => {
    calib.showMask = showMaskInput.checked
    persist()
  })
  printEnabledInput.addEventListener('change', () => {
    calib.printEnabled = printEnabledInput.checked
    persist()
  })

  root.querySelector('#lockBtn')!.addEventListener('click', () => {
    if (locked) {
      locked = null
      lockStatus.textContent = ''
      setStatus('Lås opphevet')
      return
    }
    if (!lastTrack?.found) {
      lockStatus.textContent = 'Ingen brikke funnet'
      return
    }
    locked = {
      pixel: { x: lastTrack.x, y: lastTrack.y },
      map: lastMap ? { ...lastMap } : null,
    }
    const mapTxt = locked.map
      ? `u=${locked.map.x.toFixed(3)}, v=${locked.map.y.toFixed(3)}`
      : 'kart ikke kalibrert'
    lockStatus.textContent = `Låst · ${mapTxt}`
    setStatus('Svar låst')
  })

  function updateCoordsDisplay(
    track: TrackResult | null,
    mapUv: Point2 | null,
  ): void {
    const dds = coordsEl.querySelectorAll('dd')
    if (!track?.found) {
      dds[0].textContent = '—'
      dds[1].textContent = '—'
      dds[2].textContent = '—'
      return
    }
    dds[0].textContent = `${track.x.toFixed(0)}, ${track.y.toFixed(0)}`
    dds[1].textContent = mapUv
      ? `${mapUv.x.toFixed(3)}, ${mapUv.y.toFixed(3)}${isInsideMap(mapUv) ? '' : ' (utenfor)'}`
      : '—'
    dds[2].textContent = String(Math.round(track.area))
  }

  function drawVideoOverlay(
    track: TrackResult | null,
    displayTrack: Point2 | null,
    mask: Uint8ClampedArray | null,
    procW: number,
    procH: number,
  ): void {
    const rect = videoWrap.getBoundingClientRect()
    overlayCtx.clearRect(0, 0, rect.width, rect.height)

    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return

    const scale = Math.min(rect.width / vw, rect.height / vh)
    const dispW = vw * scale
    const dispH = vh * scale
    const ox = (rect.width - dispW) / 2
    const oy = (rect.height - dispH) / 2

    const toDisplay = (p: Point2) => ({
      x: ox + p.x * scale,
      y: oy + p.y * scale,
    })

    if (calib.showMask && mask) {
      maskCanvas.width = procW
      maskCanvas.height = procH
      const mctx = maskCanvas.getContext('2d')!
      const img = mctx.createImageData(procW, procH)
      for (let i = 0; i < mask.length; i++) {
        const v = mask[i]
        img.data[i * 4] = v
        img.data[i * 4 + 1] = 0
        img.data[i * 4 + 2] = 0
        img.data[i * 4 + 3] = v ? 90 : 0
      }
      mctx.putImageData(img, 0, 0)
      overlayCtx.drawImage(maskCanvas, ox, oy, dispW, dispH)
    }

    // Map corner markers
    const corners =
      mode === 'calibrateCorners'
        ? draftCorners
        : (calib.cameraCorners ?? [])
    corners.forEach((c, i) => {
      const d = toDisplay(c)
      overlayCtx.beginPath()
      overlayCtx.arc(d.x, d.y, 6, 0, Math.PI * 2)
      overlayCtx.fillStyle = '#e8c547'
      overlayCtx.fill()
      overlayCtx.fillStyle = '#fff'
      overlayCtx.font = '12px "IBM Plex Sans", system-ui, sans-serif'
      overlayCtx.fillText(CORNER_LABELS[i] ?? String(i + 1), d.x + 8, d.y - 8)
    })

    if (corners.length === 4) {
      overlayCtx.beginPath()
      const first = toDisplay(corners[0])
      overlayCtx.moveTo(first.x, first.y)
      for (let i = 1; i < 4; i++) {
        const p = toDisplay(corners[i])
        overlayCtx.lineTo(p.x, p.y)
      }
      overlayCtx.closePath()
      overlayCtx.strokeStyle = 'rgba(232, 197, 71, 0.7)'
      overlayCtx.lineWidth = 2
      overlayCtx.stroke()
    }

    // Year-field corners / slots
    const yearCorners =
      mode === 'calibrateYear'
        ? draftYearCorners
        : (calib.yearField.cameraCorners ?? [])
    yearCorners.forEach((c, i) => {
      const d = toDisplay(c)
      overlayCtx.beginPath()
      overlayCtx.arc(d.x, d.y, 6, 0, Math.PI * 2)
      overlayCtx.fillStyle = '#7ec8a3'
      overlayCtx.fill()
      overlayCtx.fillStyle = '#fff'
      overlayCtx.font = '12px "IBM Plex Sans", system-ui, sans-serif'
      overlayCtx.fillText(`T${CORNER_LABELS[i] ?? i + 1}`, d.x + 8, d.y - 8)
    })

    if (mode !== 'calibrateYear' && calib.yearField.cameraToYear) {
      const outline = yearFieldOutline(calib.yearField.cameraToYear)
      if (outline) {
        overlayCtx.beginPath()
        const o0 = toDisplay(outline[0])
        overlayCtx.moveTo(o0.x, o0.y)
        for (let i = 1; i < 4; i++) {
          const p = toDisplay(outline[i])
          overlayCtx.lineTo(p.x, p.y)
        }
        overlayCtx.closePath()
        overlayCtx.strokeStyle = 'rgba(126, 200, 163, 0.85)'
        overlayCtx.lineWidth = 2
        overlayCtx.stroke()
      }
      const line = yearTimelineCenterLine(calib.yearField.cameraToYear)
      if (line) {
        const a = toDisplay(line.start)
        const b = toDisplay(line.end)
        overlayCtx.beginPath()
        overlayCtx.moveTo(a.x, a.y)
        overlayCtx.lineTo(b.x, b.y)
        overlayCtx.strokeStyle = 'rgba(232, 197, 71, 0.75)'
        overlayCtx.lineWidth = 2
        overlayCtx.stroke()
      }
      overlayCtx.fillStyle = 'rgba(232, 197, 71, 0.95)'
      overlayCtx.font = '11px "IBM Plex Sans", system-ui, sans-serif'
      for (const tick of yearTimelineTicks(
        calib.yearField.cameraToYear,
        yearRangeFromCalib(calib),
      )) {
        const d = toDisplay(tick.pixel)
        overlayCtx.beginPath()
        overlayCtx.moveTo(d.x, d.y - 6)
        overlayCtx.lineTo(d.x, d.y + 6)
        overlayCtx.strokeStyle = 'rgba(232, 197, 71, 0.8)'
        overlayCtx.lineWidth = 1.5
        overlayCtx.stroke()
        overlayCtx.fillText(String(tick.year), d.x - 14, d.y - 10)
      }
    } else if (yearCorners.length >= 2) {
      overlayCtx.beginPath()
      const y0 = toDisplay(yearCorners[0])
      overlayCtx.moveTo(y0.x, y0.y)
      for (let i = 1; i < yearCorners.length; i++) {
        const p = toDisplay(yearCorners[i])
        overlayCtx.lineTo(p.x, p.y)
      }
      if (yearCorners.length === 4) overlayCtx.closePath()
      overlayCtx.strokeStyle = 'rgba(126, 200, 163, 0.85)'
      overlayCtx.lineWidth = 2
      overlayCtx.stroke()
    }

    // Buffered search ROI (outside map frame, dashed)
    if (calib.cameraToMap && mode !== 'calibrateCorners' && mode !== 'calibrateYear') {
      const roiCorners = mapRoiCameraCorners(calib.cameraToMap, MAP_TRACK_BUFFER)
      if (roiCorners) {
        overlayCtx.beginPath()
        const r0 = toDisplay(roiCorners[0])
        overlayCtx.moveTo(r0.x, r0.y)
        for (let i = 1; i < 4; i++) {
          const p = toDisplay(roiCorners[i])
          overlayCtx.lineTo(p.x, p.y)
        }
        overlayCtx.closePath()
        overlayCtx.setLineDash([6, 5])
        overlayCtx.strokeStyle = 'rgba(126, 200, 163, 0.65)'
        overlayCtx.lineWidth = 1.5
        overlayCtx.stroke()
        overlayCtx.setLineDash([])
      }
    }

    // Stone ROI
    const stoneRect: StoneRect | null =
      mode === 'calibrateStone' && draftStoneCorners.length === 2
        ? rectFromCorners(draftStoneCorners[0], draftStoneCorners[1])
        : mode === 'calibrateStone' && draftStoneCorners.length === 1
          ? null
          : calib.stone.rect

    if (mode === 'calibrateStone' && draftStoneCorners.length >= 1) {
      draftStoneCorners.forEach((c, i) => {
        const d = toDisplay(c)
        overlayCtx.beginPath()
        overlayCtx.arc(d.x, d.y, 6, 0, Math.PI * 2)
        overlayCtx.fillStyle = '#c4a7e7'
        overlayCtx.fill()
        overlayCtx.fillStyle = '#fff'
        overlayCtx.font = '12px "IBM Plex Sans", system-ui, sans-serif'
        overlayCtx.fillText(i === 0 ? 'S1' : 'S2', d.x + 8, d.y - 8)
      })
      if (draftStoneCorners.length === 2 && stoneRect) {
        const a = toDisplay({ x: stoneRect.x, y: stoneRect.y })
        const b = toDisplay({
          x: stoneRect.x + stoneRect.w,
          y: stoneRect.y + stoneRect.h,
        })
        overlayCtx.strokeStyle = 'rgba(196, 167, 231, 0.9)'
        overlayCtx.lineWidth = 2
        overlayCtx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      }
    } else if (stoneRect) {
      const a = toDisplay({ x: stoneRect.x, y: stoneRect.y })
      const b = toDisplay({
        x: stoneRect.x + stoneRect.w,
        y: stoneRect.y + stoneRect.h,
      })
      const dw = b.x - a.x
      const dh = b.y - a.y
      if (lastStoneCovered) {
        overlayCtx.fillStyle = 'rgba(196, 167, 231, 0.35)'
        overlayCtx.fillRect(a.x, a.y, dw, dh)
      }
      overlayCtx.strokeStyle = lastStoneCovered
        ? 'rgba(240, 113, 103, 0.95)'
        : 'rgba(196, 167, 231, 0.9)'
      overlayCtx.lineWidth = 2
      overlayCtx.strokeRect(a.x, a.y, dw, dh)
    }

    if (displayTrack && track?.found) {
      const d = toDisplay(displayTrack)
      overlayCtx.beginPath()
      overlayCtx.arc(d.x, d.y, locked ? 14 : 10, 0, Math.PI * 2)
      overlayCtx.strokeStyle = locked ? '#f07167' : '#7ec8a3'
      overlayCtx.lineWidth = 3
      overlayCtx.stroke()
      overlayCtx.beginPath()
      overlayCtx.moveTo(d.x - 12, d.y)
      overlayCtx.lineTo(d.x + 12, d.y)
      overlayCtx.moveTo(d.x, d.y - 12)
      overlayCtx.lineTo(d.x, d.y + 12)
      overlayCtx.stroke()
    }
  }

  function tick(): void {
    raf = requestAnimationFrame(tick)
    frameCount++
    const now = performance.now()
    if (now - fpsTimer >= 1000) {
      fps = frameCount
      frameCount = 0
      fpsTimer = now
      fpsEl.textContent = `${fps} FPS`
    }

    if (video.readyState < 2) {
      mapView?.setMarker(null)
      return
    }

    const { imageData, scaleX, scaleY } = drawVideoFrame(video, processCanvas, 480)
    const mask = calib.showMask
      ? new Uint8ClampedArray(imageData.width * imageData.height)
      : undefined

    if (
      isStoneReady(calib.stone) &&
      calib.stone.rect &&
      calib.stone.baseline
    ) {
      const sample = sampleRoiLuma(
        imageData,
        calib.stone.rect,
        scaleX,
        scaleY,
        calib.stone.baselineW,
        calib.stone.baselineH,
      )
      if (sample) {
        lastStoneDiff = roiDiff(
          Float32Array.from(calib.stone.baseline),
          sample.data,
        )
        lastStoneCovered = lastStoneDiff >= calib.stone.diffThreshold
        stoneLiveDiff.textContent = `Diff: ${lastStoneDiff.toFixed(1)} / ${calib.stone.diffThreshold}${
          lastStoneCovered ? ' · dekket' : ''
        }`
      }
    } else {
      lastStoneDiff = 0
      lastStoneCovered = false
      stoneLiveDiff.textContent = calib.stone.rect
        ? 'Diff: — (ta baseline)'
        : 'Diff: —'
    }

    const mapRoi =
      calib.cameraToMap && mode !== 'calibrateCorners'
        ? {
            cameraToMap: calib.cameraToMap,
            scaleX,
            scaleY,
            buffer: MAP_TRACK_BUFFER,
          }
        : null

    let track = trackColor(imageData, calib.hsv, mask, mapRoi)
    if (track.found) {
      track = {
        ...track,
        x: track.x * scaleX,
        y: track.y * scaleY,
      }
    }

    let displayPixel: Point2 | null = track.found
      ? { x: track.x, y: track.y }
      : null
    let mapUv: Point2 | null = null

    if (locked) {
      displayPixel = locked.pixel
      mapUv = locked.map
      lastTrack = {
        found: true,
        x: locked.pixel.x,
        y: locked.pixel.y,
        area: lastTrack?.area ?? 0,
      }
    } else {
      lastTrack = track
      if (track.found && calib.cameraToMap) {
        mapUv = pixelToMap(calib.cameraToMap, { x: track.x, y: track.y })
      }
      lastMap = mapUv
    }

    updateCoordsDisplay(
      locked
        ? { found: true, x: locked.pixel.x, y: locked.pixel.y, area: lastTrack?.area ?? 0 }
        : track,
      mapUv,
    )
    drawVideoOverlay(
      track,
      displayPixel,
      mask ?? null,
      imageData.width,
      imageData.height,
    )
    if (mapUv) {
      mapView?.setMarker(mapUv, locked ? 'locked' : 'live')
    } else {
      mapView?.setMarker(null)
    }
  }

  window.addEventListener('resize', sizeOverlay)

  mapView = mountMapView(mapCanvas)

  updateCalibStatus()
  updateHint()
  syncHsvOutputs()
  void refreshDevicesAndStart()
  raf = requestAnimationFrame(tick)

  // Expose cleanup for HMR / route changes
  ;(window as unknown as { __tgCleanup?: () => void }).__tgCleanup = () => {
    cancelAnimationFrame(raf)
    stopStream(stream)
    mapView?.destroy()
    window.removeEventListener('resize', sizeOverlay)
  }
}

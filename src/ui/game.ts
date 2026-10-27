import {
  ensureCameraPermission,
  listVideoDevices,
  loadSavedDeviceId,
  openCamera,
  pickDefaultDeviceId,
  saveDeviceId,
  stopStream,
} from '../camera/devices'
import {
  isStoneCalibrated,
  isYearFieldCalibrated,
  loadCalibration,
  yearRangeFromCalib,
} from '../calibration/store'
import { fetchChallenges } from '../challenges/store'
import { hasYearAnswer, type Challenge } from '../challenges/types'
import {
  MAX_SCORE,
  combineRoundScore,
  scoreGuess,
  scoreYear,
} from '../game/score'
import {
  MAP_TRACK_BUFFER,
  pixelToMap,
  type Point2,
} from '../vision/homography'
import {
  drawVideoFrame,
  trackColor,
  type TrackResult,
} from '../vision/colorTrack'
import {
  StoneTouchDetector,
  roiDiff,
  sampleRoiLuma,
  type StoneTouchSnapshot,
} from '../vision/stoneTouch'
import {
  YEAR_TRACK_BUFFER,
  pixelToYear,
  yearFieldOutline,
  yearTimelineCenterLine,
  yearTimelineTicks,
} from '../vision/yearField'
import { printRoundScore } from '../print/client'
import { mountMapView, type MapView } from './mapView'
import { renderNav } from './nav'

type Phase = 'playing' | 'revealed' | 'done'

export function mountGame(root: HTMLElement): void {
  let stream: MediaStream | null = null
  let calib = loadCalibration()
  let challenges: Challenge[] = []
  let index = 0
  let phase: Phase = 'playing'
  let lastTrack: TrackResult | null = null
  let lastMap: Point2 | null = null
  let lastYearTrack: TrackResult | null = null
  let lastYear: number | null = null
  let lockedPlayer: Point2 | null = null
  let lockedYear: number | null = null
  let lastRoundScore = 0
  let totalScore = 0
  let raf = 0
  let mapView: MapView | null = null
  let stoneSnapshot: StoneTouchSnapshot | null = null
  const stoneDetector = new StoneTouchDetector()

  const processCanvas = document.createElement('canvas')

  root.innerHTML = `
    <div class="app game-app" id="gameApp">
      <header class="header">
        <div class="brand">
          <h1>TimeGuesser</h1>
          <p class="tagline" id="pageTagline">Spill</p>
        </div>
        <div class="header-meta">
          ${renderNav('play')}
          <span id="status" class="status">Laster…</span>
        </div>
      </header>

      <p id="calibWarn" class="banner banner-warn" hidden>
        Kamerakalibrering mangler.
        <a href="#/calibrate">Gå til Kalibrering</a>
      </p>
      <p id="yearCalibWarn" class="banner banner-warn" hidden>
        Tidslinjen er ikke kalibrert (trengs for årstall).
        <a href="#/calibrate">Kalibrer tidslinje</a>
      </p>
      <p id="emptyWarn" class="banner banner-warn" hidden>
        Ingen utfordringer ennå.
        <a href="#/challenges">Opprett utfordringer</a>
      </p>

      <div class="game-play" id="playView">
        <div class="game-layout">
          <section class="game-main">
            <div class="challenge-hero panel">
              <div class="row challenge-progress">
                <h2 id="challengeTitle">Utfordring</h2>
                <span class="meta" id="progressMeta"></span>
              </div>
              <div class="challenge-image-wrap">
                <img id="challengeImage" alt="Utfordringsbilde" hidden />
                <p class="meta" id="challengePlaceholder">Ingen utfordring</p>
              </div>
            </div>
          </section>

          <aside class="sidebar game-sidebar">
            <div class="panel">
              <h2>Kamera</h2>
              <div class="video-wrap video-wrap-compact" id="videoWrap">
                <video id="video" playsinline autoplay muted></video>
                <canvas id="overlay"></canvas>
              </div>
              <p id="hint" class="hint"></p>
            </div>

            <div class="panel" id="yearPanel" hidden>
              <h2>Tidslinje</h2>
              <p class="year-slider-value" id="yearValue">—</p>
              <p class="meta" id="yearMeta"></p>
            </div>

            <div class="panel map-panel">
              <h2>Kart</h2>
              <div class="map map-preview" id="playMapSlot"></div>
            </div>

            <div class="panel">
              <button type="button" class="btn primary" id="lockBtn">Lås svar</button>
              <p id="stoneStatus" class="meta stone-status"></p>
              <p id="playStatus" class="meta"></p>
            </div>
          </aside>
        </div>
      </div>

      <div class="game-result" id="resultView" hidden>
        <div class="result-layout">
          <section class="result-map-panel panel">
            <div class="row challenge-progress">
              <h2>Resultat</h2>
              <span class="meta" id="resultProgress"></span>
            </div>
            <div class="map map-result" id="resultMapSlot"></div>
            <p class="meta map-legend">
              <span class="legend-swatch legend-you"></span> Ditt svar
              <span class="legend-swatch legend-fasit"></span> Fasit
            </p>
          </section>

          <aside class="sidebar result-sidebar">
            <div class="panel result-score-panel">
              <p class="score-label">Poeng denne runden</p>
              <p class="score-value" id="roundScore">0</p>
              <p class="meta" id="scoreDetail"></p>
              <p class="meta" id="totalScoreMeta"></p>
            </div>

            <div class="panel" id="yearResultPanel" hidden>
              <h2>Årstall</h2>
              <div class="year-result-compare">
                <div class="year-result-col">
                  <p class="score-label">Ditt svar</p>
                  <p class="year-slider-value is-active" id="yearGuessEl">—</p>
                </div>
                <div class="year-result-col">
                  <p class="score-label">Fasit</p>
                  <p class="year-slider-value year-fasit-value" id="yearFasitEl">—</p>
                </div>
              </div>
              <p class="meta" id="yearResultMeta"></p>
            </div>

            <div class="panel">
              <h2 id="resultChallengeTitle">Utfordring</h2>
              <div class="challenge-image-wrap challenge-image-wrap-sm">
                <img id="resultChallengeImage" alt="" />
              </div>
            </div>

            <div class="panel">
              <button type="button" class="btn primary" id="nextBtn">Neste utfordring</button>
            </div>
          </aside>
        </div>
      </div>

      <div class="game-done panel" id="doneView" hidden>
        <h2>Ferdig</h2>
        <p class="score-value" id="finalScore">0</p>
        <p class="meta" id="finalScoreMeta"></p>
        <button type="button" class="btn primary" id="restartBtn">Spill på nytt</button>
      </div>

      <canvas id="mapCanvas" width="320" height="179" hidden></canvas>
    </div>
  `

  const gameApp = root.querySelector<HTMLElement>('#gameApp')!
  const pageTagline = root.querySelector<HTMLElement>('#pageTagline')!
  const statusEl = root.querySelector<HTMLElement>('#status')!
  const calibWarn = root.querySelector<HTMLElement>('#calibWarn')!
  const yearCalibWarn = root.querySelector<HTMLElement>('#yearCalibWarn')!
  const emptyWarn = root.querySelector<HTMLElement>('#emptyWarn')!
  const playView = root.querySelector<HTMLElement>('#playView')!
  const resultView = root.querySelector<HTMLElement>('#resultView')!
  const doneView = root.querySelector<HTMLElement>('#doneView')!
  const challengeTitle = root.querySelector<HTMLElement>('#challengeTitle')!
  const progressMeta = root.querySelector<HTMLElement>('#progressMeta')!
  const challengeImage = root.querySelector<HTMLImageElement>('#challengeImage')!
  const challengePlaceholder = root.querySelector<HTMLElement>('#challengePlaceholder')!
  const video = root.querySelector<HTMLVideoElement>('#video')!
  const overlay = root.querySelector<HTMLCanvasElement>('#overlay')!
  const overlayCtx = overlay.getContext('2d')!
  const videoWrap = root.querySelector<HTMLElement>('#videoWrap')!
  const hintEl = root.querySelector<HTMLElement>('#hint')!
  const yearPanel = root.querySelector<HTMLElement>('#yearPanel')!
  const yearValueEl = root.querySelector<HTMLElement>('#yearValue')!
  const yearMeta = root.querySelector<HTMLElement>('#yearMeta')!
  const playMapSlot = root.querySelector<HTMLElement>('#playMapSlot')!
  const resultMapSlot = root.querySelector<HTMLElement>('#resultMapSlot')!
  const mapCanvas = root.querySelector<HTMLCanvasElement>('#mapCanvas')!
  const lockBtn = root.querySelector<HTMLButtonElement>('#lockBtn')!
  const nextBtn = root.querySelector<HTMLButtonElement>('#nextBtn')!
  const restartBtn = root.querySelector<HTMLButtonElement>('#restartBtn')!
  const stoneStatus = root.querySelector<HTMLElement>('#stoneStatus')!
  const playStatus = root.querySelector<HTMLElement>('#playStatus')!
  const resultProgress = root.querySelector<HTMLElement>('#resultProgress')!
  const resultChallengeTitle = root.querySelector<HTMLElement>('#resultChallengeTitle')!
  const resultChallengeImage = root.querySelector<HTMLImageElement>('#resultChallengeImage')!
  const roundScoreEl = root.querySelector<HTMLElement>('#roundScore')!
  const scoreDetail = root.querySelector<HTMLElement>('#scoreDetail')!
  const yearResultPanel = root.querySelector<HTMLElement>('#yearResultPanel')!
  const yearGuessEl = root.querySelector<HTMLElement>('#yearGuessEl')!
  const yearFasitEl = root.querySelector<HTMLElement>('#yearFasitEl')!
  const yearResultMeta = root.querySelector<HTMLElement>('#yearResultMeta')!
  const totalScoreMeta = root.querySelector<HTMLElement>('#totalScoreMeta')!
  const finalScoreEl = root.querySelector<HTMLElement>('#finalScore')!
  const finalScoreMeta = root.querySelector<HTMLElement>('#finalScoreMeta')!

  function setStatus(text: string): void {
    statusEl.textContent = text
  }

  function isMapCalibrated(): boolean {
    return Boolean(calib.cameraToMap && calib.cameraCorners)
  }

  function currentChallenge(): Challenge | null {
    return challenges[index] ?? null
  }

  function challengeNeedsYear(c: Challenge | null): boolean {
    return Boolean(c && hasYearAnswer(c))
  }

  function placeMap(slot: HTMLElement): void {
    mapCanvas.hidden = false
    slot.appendChild(mapCanvas)
    mapView?.redraw()
  }

  function renderYearValue(year: number | null): void {
    const range = yearRangeFromCalib(calib)
    yearValueEl.textContent = year === null ? '—' : String(year)
    yearValueEl.classList.toggle('is-active', year !== null)
    yearMeta.textContent =
      year === null
        ? `Plasser brikke på tidslinjen (${range.min}–${range.max})`
        : `${range.min}–${range.max}`
  }

  function showPhaseViews(): void {
    playView.hidden = phase !== 'playing'
    resultView.hidden = phase !== 'revealed'
    doneView.hidden = phase !== 'done'
    gameApp.classList.toggle('is-result', phase === 'revealed')
    gameApp.classList.toggle('is-done', phase === 'done')

    if (phase === 'playing') {
      pageTagline.textContent = 'Spill'
      placeMap(playMapSlot)
      mapView?.setLine(null, null)
    } else if (phase === 'revealed') {
      pageTagline.textContent = 'Fasit'
      placeMap(resultMapSlot)
    } else {
      pageTagline.textContent = 'Ferdig'
    }
  }

  function updateChrome(): void {
    const c = currentChallenge()
    const total = challenges.length
    const needsYear = challengeNeedsYear(c)
    calibWarn.hidden = isMapCalibrated() || total === 0 || phase !== 'playing'
    yearCalibWarn.hidden =
      !needsYear ||
      isYearFieldCalibrated(calib) ||
      total === 0 ||
      phase !== 'playing'
    emptyWarn.hidden = total > 0 || phase !== 'playing'
    yearPanel.hidden = !needsYear || phase !== 'playing'

    showPhaseViews()

    if (phase === 'playing') {
      if (!c) {
        challengeTitle.textContent = 'Utfordring'
        progressMeta.textContent = ''
        challengeImage.hidden = true
        challengeImage.removeAttribute('src')
        challengePlaceholder.hidden = false
        challengePlaceholder.textContent = 'Ingen utfordring'
      } else {
        challengeTitle.textContent = c.id
        progressMeta.textContent = `${index + 1} / ${total}`
        challengePlaceholder.hidden = true
        challengeImage.hidden = false
        challengeImage.src = `/${c.image}`
      }

      const yearReady = !needsYear || isYearFieldCalibrated(calib)
      lockBtn.disabled = !isMapCalibrated() || !yearReady || !c

      if (!isMapCalibrated()) {
        hintEl.textContent = 'Kalibrer kameraet før du spiller'
      } else if (needsYear && !isYearFieldCalibrated(calib)) {
        hintEl.textContent = 'Kalibrer tidslinjen for årstall'
      } else if (!c) {
        hintEl.textContent = 'Opprett utfordringer for å spille'
      } else if (needsYear) {
        hintEl.textContent = isStoneCalibrated(calib)
          ? 'Plasser brikker på kart og tidslinje · hånd på steinen i 3 s for å låse'
          : 'Plasser én brikke på kartet og én på tidslinjen, deretter lås'
      } else {
        hintEl.textContent = isStoneCalibrated(calib)
          ? 'Plasser brikken på kartet · hånd på steinen i 3 s for å låse'
          : 'Plasser brikken på kartet og lås svaret'
      }

      if (!isStoneCalibrated(calib)) {
        stoneStatus.textContent = ''
      } else if (
        stoneSnapshot?.phase === 'countdown' &&
        stoneSnapshot.countdownSec !== null
      ) {
        stoneStatus.textContent = `Låser om ${stoneSnapshot.countdownSec}…`
      } else if (stoneSnapshot?.covered) {
        stoneStatus.textContent = 'Holder…'
      } else {
        stoneStatus.textContent = 'Stein klar · legg hånden på for å låse'
      }

      if (needsYear) renderYearValue(lastYear)
      return
    }

    if (phase === 'revealed' && c) {
      resultProgress.textContent = `${index + 1} / ${total}`
      resultChallengeTitle.textContent = c.id
      resultChallengeImage.src = `/${c.image}`
      nextBtn.textContent =
        index + 1 >= challenges.length ? 'Se totalsum' : 'Neste utfordring'
      return
    }

    if (phase === 'done') {
      finalScoreEl.textContent = String(totalScore)
      finalScoreMeta.textContent = `${total} utfordring${total === 1 ? '' : 'er'} · maks ${total * MAX_SCORE}`
    }
  }

  function showPlayingMarkers(): void {
    if (phase !== 'playing') return
    mapView?.setLine(null, null)
    if (lastMap) {
      mapView?.setMarker(lastMap, 'live')
    } else {
      mapView?.setMarkers([])
    }
  }

  function showReveal(
    player: Point2,
    challenge: Challenge,
    yearGuess: number | null,
  ): void {
    const fasit = { x: challenge.answer.u, y: challenge.answer.v }
    const location = scoreGuess(player, fasit)
    const parts = [location.score]

    const showYear =
      hasYearAnswer(challenge) &&
      yearGuess !== null &&
      challenge.answer.year != null

    yearResultPanel.hidden = !showYear
    if (showYear) {
      const fasitYear = challenge.answer.year!
      const yr = scoreYear(yearGuess!, fasitYear)
      parts.push(yr.score)
      yearGuessEl.textContent = String(yearGuess)
      yearFasitEl.textContent = String(fasitYear)
      yearResultMeta.textContent =
        yr.yearDelta === 0
          ? `Treff · ${yr.score} poeng`
          : `${yr.yearDelta} år unna · ${yr.score} poeng`
    } else {
      yearGuessEl.textContent = '—'
      yearFasitEl.textContent = '—'
      yearResultMeta.textContent = ''
    }

    const score = combineRoundScore(parts)
    lastRoundScore = score
    totalScore += score

    mapView?.setMarkers([
      { uv: player, style: 'locked', label: 'Du' },
      { uv: fasit, style: 'answer', label: 'Fasit' },
    ])
    mapView?.setLine(player, fasit)

    roundScoreEl.textContent = String(score)
    scoreDetail.textContent = `Sted: avstand ${location.distance.toFixed(3)} · ${location.score} poeng`
    totalScoreMeta.textContent = `Totalt så langt: ${totalScore}`

    printRoundScore({
      score,
      totalScore,
      round: index + 1,
      rounds: challenges.length,
      player: { x: player.x, y: player.y },
      fasit: { x: fasit.x, y: fasit.y },
      yearGuess: showYear ? yearGuess : null,
      yearFasit: showYear ? challenge.answer.year! : null,
    })
  }

  function sizeOverlay(): void {
    if (playView.hidden) return
    const rect = videoWrap.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dpr = window.devicePixelRatio || 1
    overlay.width = Math.round(rect.width * dpr)
    overlay.height = Math.round(rect.height * dpr)
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  async function startCamera(): Promise<void> {
    try {
      setStatus('Ber om kameratilgang…')
      await ensureCameraPermission()
      const devices = await listVideoDevices()
      const id = pickDefaultDeviceId(devices, loadSavedDeviceId())
      if (!id) {
        setStatus('Ingen kamera tilgjengelig')
        return
      }
      stopStream(stream)
      stream = await openCamera(id)
      video.srcObject = stream
      await video.play()
      saveDeviceId(id)
      setStatus('Klar')
      sizeOverlay()
    } catch (err) {
      console.error(err)
      setStatus('Kameratilgang feilet')
      hintEl.textContent = 'Tillat kamera i nettleseren og prøv igjen.'
    }
  }

  function drawCrosshair(
    d: Point2,
    color: string,
    radius = 10,
  ): void {
    overlayCtx.beginPath()
    overlayCtx.arc(d.x, d.y, radius, 0, Math.PI * 2)
    overlayCtx.strokeStyle = color
    overlayCtx.lineWidth = 3
    overlayCtx.stroke()
    overlayCtx.beginPath()
    overlayCtx.moveTo(d.x - 12, d.y)
    overlayCtx.lineTo(d.x + 12, d.y)
    overlayCtx.moveTo(d.x, d.y - 12)
    overlayCtx.lineTo(d.x, d.y + 12)
    overlayCtx.stroke()
  }

  function drawVideoOverlay(
    mapDisplay: Point2 | null,
    yearDisplay: Point2 | null,
  ): void {
    if (playView.hidden) return
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

    const stoneRect = calib.stone.rect
    if (stoneRect && isStoneCalibrated(calib)) {
      const a = toDisplay({ x: stoneRect.x, y: stoneRect.y })
      const b = toDisplay({
        x: stoneRect.x + stoneRect.w,
        y: stoneRect.y + stoneRect.h,
      })
      const dw = b.x - a.x
      const dh = b.y - a.y
      const covered = Boolean(stoneSnapshot?.covered)
      const counting = stoneSnapshot?.phase === 'countdown'
      if (covered) {
        overlayCtx.fillStyle = counting
          ? 'rgba(240, 113, 103, 0.35)'
          : 'rgba(196, 167, 231, 0.3)'
        overlayCtx.fillRect(a.x, a.y, dw, dh)
      }
      overlayCtx.strokeStyle = counting
        ? 'rgba(240, 113, 103, 0.95)'
        : 'rgba(196, 167, 231, 0.9)'
      overlayCtx.lineWidth = 2
      overlayCtx.strokeRect(a.x, a.y, dw, dh)

      if (
        counting &&
        stoneSnapshot?.countdownSec !== null &&
        stoneSnapshot?.countdownSec !== undefined
      ) {
        const cx = a.x + dw / 2
        const cy = a.y + dh / 2
        overlayCtx.fillStyle = 'rgba(15, 26, 20, 0.55)'
        overlayCtx.beginPath()
        overlayCtx.arc(cx, cy, Math.min(dw, dh) * 0.42, 0, Math.PI * 2)
        overlayCtx.fill()
        overlayCtx.fillStyle = '#e8c547'
        overlayCtx.font =
          '700 2rem "Fraunces", Georgia, serif'
        overlayCtx.textAlign = 'center'
        overlayCtx.textBaseline = 'middle'
        overlayCtx.fillText(String(stoneSnapshot.countdownSec), cx, cy)
        overlayCtx.textAlign = 'start'
        overlayCtx.textBaseline = 'alphabetic'
      }
    }

    if (
      calib.yearField.cameraToYear &&
      challengeNeedsYear(currentChallenge())
    ) {
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
        overlayCtx.strokeStyle = 'rgba(126, 200, 163, 0.9)'
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
    }

    if (mapDisplay) drawCrosshair(toDisplay(mapDisplay), '#7ec8a3')
    if (yearDisplay) drawCrosshair(toDisplay(yearDisplay), '#e8c547', 12)
  }

  function tick(): void {
    raf = requestAnimationFrame(tick)

    if (phase !== 'playing') return

    if (video.readyState < 2) {
      mapView?.setMarkers([])
      return
    }

    const { imageData, scaleX, scaleY } = drawVideoFrame(
      video,
      processCanvas,
      480,
    )
    const needsYear = challengeNeedsYear(currentChallenge())

    let mapDisplay: Point2 | null = null
    let yearDisplay: Point2 | null = null

    if (calib.cameraToMap) {
      const mapRoi = {
        cameraToMap: calib.cameraToMap,
        scaleX,
        scaleY,
        buffer: MAP_TRACK_BUFFER,
      }
      let track = trackColor(imageData, calib.hsv, undefined, mapRoi)
      if (track.found) {
        track = {
          ...track,
          x: track.x * scaleX,
          y: track.y * scaleY,
        }
        mapDisplay = { x: track.x, y: track.y }
        lastMap = pixelToMap(calib.cameraToMap, mapDisplay)
      } else {
        lastMap = null
      }
      lastTrack = track
    } else {
      lastTrack = null
      lastMap = null
    }

    if (needsYear && calib.yearField.cameraToYear) {
      const yearRoi = {
        cameraToMap: calib.yearField.cameraToYear,
        scaleX,
        scaleY,
        buffer: YEAR_TRACK_BUFFER,
      }
      let yTrack = trackColor(imageData, calib.hsv, undefined, yearRoi)
      if (yTrack.found) {
        yTrack = {
          ...yTrack,
          x: yTrack.x * scaleX,
          y: yTrack.y * scaleY,
        }
        yearDisplay = { x: yTrack.x, y: yTrack.y }
        lastYear = pixelToYear(
          calib.yearField.cameraToYear,
          yearDisplay,
          yearRangeFromCalib(calib),
        )
      } else {
        lastYear = null
      }
      lastYearTrack = yTrack
      renderYearValue(lastYear)
    } else {
      lastYearTrack = null
      lastYear = null
    }

    if (isStoneCalibrated(calib) && calib.stone.rect && calib.stone.baseline) {
      stoneDetector.threshold = calib.stone.diffThreshold
      const canArm =
        isMapCalibrated() &&
        (!needsYear || isYearFieldCalibrated(calib)) &&
        Boolean(currentChallenge()) &&
        Boolean(lastTrack?.found && lastMap) &&
        (!needsYear || Boolean(lastYearTrack?.found && lastYear !== null))

      const sample = sampleRoiLuma(
        imageData,
        calib.stone.rect,
        scaleX,
        scaleY,
        calib.stone.baselineW,
        calib.stone.baselineH,
      )
      const now = performance.now()
      if (sample && canArm) {
        const diff = roiDiff(
          Float32Array.from(calib.stone.baseline),
          sample.data,
        )
        const { locked, snapshot } = stoneDetector.update(diff, now)
        stoneSnapshot = snapshot
        if (locked) {
          lockAnswer()
          stoneDetector.resetAfterLock(now)
        }
      } else if (sample) {
        const diff = roiDiff(
          Float32Array.from(calib.stone.baseline),
          sample.data,
        )
        stoneDetector.reset()
        stoneSnapshot = {
          phase: 'idle',
          diff,
          covered: diff >= calib.stone.diffThreshold,
          countdownSec: null,
          countdownProgress: 0,
        }
      } else {
        stoneSnapshot = null
      }
    } else {
      stoneSnapshot = null
    }

    drawVideoOverlay(mapDisplay, yearDisplay)
    showPlayingMarkers()

    if (isStoneCalibrated(calib)) {
      if (
        stoneSnapshot?.phase === 'countdown' &&
        stoneSnapshot.countdownSec !== null
      ) {
        stoneStatus.textContent = `Låser om ${stoneSnapshot.countdownSec}…`
      } else if (stoneSnapshot?.covered) {
        stoneStatus.textContent = 'Holder…'
      } else {
        stoneStatus.textContent = 'Stein klar · legg hånden på for å låse'
      }
    }
  }

  function lockAnswer(): boolean {
    if (phase !== 'playing') return false
    const c = currentChallenge()
    if (!c || !isMapCalibrated()) return false
    if (challengeNeedsYear(c) && !isYearFieldCalibrated(calib)) return false

    if (!lastTrack?.found || !lastMap) {
      playStatus.textContent = 'Ingen brikke funnet på kartet'
      return false
    }

    if (challengeNeedsYear(c)) {
      if (!lastYearTrack?.found || lastYear === null) {
        playStatus.textContent = 'Ingen brikke funnet på tidslinjen'
        return false
      }
      lockedYear = lastYear
    } else {
      lockedYear = null
    }

    lockedPlayer = { ...lastMap }
    phase = 'revealed'
    playStatus.textContent = ''
    stoneStatus.textContent = ''
    stoneSnapshot = null
    showReveal(lockedPlayer, c, lockedYear)
    updateChrome()
    setStatus(`${lastRoundScore} poeng`)
    return true
  }

  lockBtn.addEventListener('click', () => {
    lockAnswer()
  })

  nextBtn.addEventListener('click', () => {
    if (phase !== 'revealed') return

    if (index + 1 >= challenges.length) {
      phase = 'done'
      lockedPlayer = null
      lockedYear = null
      lastYear = null
      mapView?.setMarkers([])
      mapView?.setLine(null, null)
      updateChrome()
      setStatus('Ferdig')
      return
    }

    index += 1
    phase = 'playing'
    lockedPlayer = null
    lockedYear = null
    lastMap = null
    lastYear = null
    playStatus.textContent = ''
    stoneStatus.textContent = ''
    stoneSnapshot = null
    stoneDetector.reset()
    mapView?.setMarkers([])
    mapView?.setLine(null, null)
    updateChrome()
    sizeOverlay()
    setStatus('Klar')
  })

  restartBtn.addEventListener('click', () => {
    index = 0
    totalScore = 0
    lastRoundScore = 0
    lockedPlayer = null
    lockedYear = null
    lastMap = null
    lastYear = null
    stoneSnapshot = null
    stoneDetector.reset()
    stoneStatus.textContent = ''
    phase = challenges.length ? 'playing' : 'done'
    mapView?.setMarkers([])
    mapView?.setLine(null, null)
    updateChrome()
    sizeOverlay()
    setStatus(challenges.length ? 'Klar' : 'Ingen utfordringer')
  })

  window.addEventListener('resize', sizeOverlay)
  placeMap(playMapSlot)
  mapView = mountMapView(mapCanvas)

  void (async () => {
    calib = loadCalibration()
    challenges = (await fetchChallenges()).challenges
    phase = challenges.length ? 'playing' : 'done'
    updateChrome()
    if (phase === 'playing') await startCamera()
    raf = requestAnimationFrame(tick)
  })()

  ;(window as unknown as { __tgCleanup?: () => void }).__tgCleanup = () => {
    cancelAnimationFrame(raf)
    stopStream(stream)
    mapView?.destroy()
    window.removeEventListener('resize', sizeOverlay)
  }
}

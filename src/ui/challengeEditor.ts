import type { Challenge } from '../challenges/types'
import { normalizeYear } from '../challenges/types'
import {
  downloadChallengesJson,
  fetchChallenges,
  parseChallengesJson,
  saveChallenges,
  uploadChallengeImage,
} from '../challenges/store'
import { mountMapView, type MapView } from './mapView'
import { renderNav } from './nav'
import type { Point2 } from '../vision/homography'

export function mountChallengeEditor(root: HTMLElement): void {
  let challenges: Challenge[] = []
  let editingId: string | null = null
  let pendingFile: File | null = null
  let draftAnswer: Point2 | null = null
  let draftYear: number | null = null
  let mapView: MapView | null = null
  let previewUrl: string | null = null

  root.innerHTML = `
    <div class="app editor-app">
      <header class="header">
        <div class="brand">
          <h1>TimeGuesser</h1>
          <p class="tagline">Utfordringer</p>
        </div>
        ${renderNav('challenges')}
      </header>

      <div class="editor-layout">
        <section class="panel editor-list-panel">
          <div class="row editor-toolbar">
            <h2>Liste</h2>
            <div class="row">
              <button type="button" class="btn secondary" id="btnNew">Ny</button>
              <button type="button" class="btn secondary" id="btnExport">Eksporter</button>
              <button type="button" class="btn secondary" id="btnImport">Importer</button>
              <input type="file" id="importFile" accept="application/json,.json" hidden />
            </div>
          </div>
          <ul class="challenge-list" id="challengeList"></ul>
          <p class="meta" id="listStatus"></p>
        </section>

        <section class="panel editor-form-panel">
          <h2>Utfordring</h2>
          <p class="help">Sett ID, last opp bilde, klikk på kartet for fasit-sted, og angi fasit-år (tidslinje: 1850–2025).</p>

          <label class="field">
            <span>ID</span>
            <input type="text" id="challengeId" placeholder="f.eks. paris-1889" autocomplete="off" />
          </label>

          <label class="field">
            <span>Bilde</span>
            <input type="file" id="challengeImage" accept="image/png,image/jpeg,image/webp,image/gif" />
          </label>
          <div class="challenge-preview" id="imagePreviewWrap">
            <img id="imagePreview" alt="" hidden />
            <p class="meta" id="imageMeta">Ingen bilde valgt</p>
          </div>

          <label class="field">
            <span>Fasit-år (4 siffer)</span>
            <input type="number" id="challengeYear" min="1000" max="9999" step="1" placeholder="f.eks. 1889" />
          </label>

          <div class="field">
            <span>Fasit sted (klikk på kartet)</span>
            <p class="meta" id="answerMeta">Ikke satt</p>
          </div>
          <div class="map map-clickable" id="editorMapWrap">
            <canvas id="editorMapCanvas" width="320" height="179"></canvas>
          </div>

          <div class="row editor-actions">
            <button type="button" class="btn primary" id="btnSave">Lagre</button>
            <button type="button" class="btn secondary" id="btnDelete">Slett</button>
          </div>
          <p class="meta" id="formStatus"></p>
        </section>
      </div>
    </div>
  `

  const listEl = root.querySelector<HTMLUListElement>('#challengeList')!
  const listStatus = root.querySelector<HTMLElement>('#listStatus')!
  const formStatus = root.querySelector<HTMLElement>('#formStatus')!
  const idInput = root.querySelector<HTMLInputElement>('#challengeId')!
  const yearInput = root.querySelector<HTMLInputElement>('#challengeYear')!
  const imageInput = root.querySelector<HTMLInputElement>('#challengeImage')!
  const imagePreview = root.querySelector<HTMLImageElement>('#imagePreview')!
  const imageMeta = root.querySelector<HTMLElement>('#imageMeta')!
  const answerMeta = root.querySelector<HTMLElement>('#answerMeta')!
  const importFile = root.querySelector<HTMLInputElement>('#importFile')!
  const mapCanvas = root.querySelector<HTMLCanvasElement>('#editorMapCanvas')!

  function setFormStatus(text: string, isError = false): void {
    formStatus.textContent = text
    formStatus.classList.toggle('status-error', isError)
  }

  function revokePreview(): void {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      previewUrl = null
    }
  }

  function showImage(src: string | null, label: string): void {
    revokePreview()
    if (!src) {
      imagePreview.hidden = true
      imagePreview.removeAttribute('src')
      imageMeta.textContent = label
      return
    }
    imagePreview.hidden = false
    imagePreview.src = src
    imageMeta.textContent = label
  }

  function updateAnswerMeta(): void {
    if (!draftAnswer) {
      answerMeta.textContent = 'Ikke satt'
      mapView?.setMarker(null)
      return
    }
    answerMeta.textContent = `u=${draftAnswer.x.toFixed(3)}, v=${draftAnswer.y.toFixed(3)}`
    mapView?.setMarker(draftAnswer, 'answer')
  }

  function syncYearFromInput(): void {
    const raw = yearInput.value.trim()
    if (!raw) {
      draftYear = null
      return
    }
    draftYear = normalizeYear(Number(raw))
  }

  function clearForm(): void {
    editingId = null
    pendingFile = null
    draftAnswer = null
    draftYear = null
    idInput.value = ''
    idInput.readOnly = false
    yearInput.value = ''
    imageInput.value = ''
    showImage(null, 'Ingen bilde valgt')
    updateAnswerMeta()
    setFormStatus('')
    renderList()
  }

  function loadIntoForm(c: Challenge): void {
    editingId = c.id
    pendingFile = null
    draftAnswer = { x: c.answer.u, y: c.answer.v }
    draftYear =
      typeof c.answer.year === 'number' ? normalizeYear(c.answer.year) : null
    idInput.value = c.id
    idInput.readOnly = true
    yearInput.value = draftYear !== null ? String(draftYear) : ''
    imageInput.value = ''
    showImage(`/${c.image}`, c.image)
    updateAnswerMeta()
    setFormStatus(`Redigerer «${c.id}»`)
    renderList()
  }

  function renderList(): void {
    listEl.innerHTML = ''
    if (challenges.length === 0) {
      listStatus.textContent = 'Ingen utfordringer ennå'
      return
    }
    listStatus.textContent = `${challenges.length} utfordring${challenges.length === 1 ? '' : 'er'}`
    for (const c of challenges) {
      const li = document.createElement('li')
      li.className =
        'challenge-item' + (editingId === c.id ? ' is-active' : '')
      li.innerHTML = `
        <button type="button" class="challenge-item-btn">
          <img class="challenge-thumb" src="/${c.image}" alt="" />
          <span class="challenge-item-meta">
            <strong>${escapeHtml(c.id)}</strong>
            <span>${
              typeof c.answer.year === 'number' ? `${c.answer.year} · ` : ''
            }u=${c.answer.u.toFixed(3)}, v=${c.answer.v.toFixed(3)}</span>
          </span>
        </button>
      `
      li.querySelector('button')!.addEventListener('click', () => {
        loadIntoForm(c)
      })
      const thumb = li.querySelector<HTMLImageElement>('.challenge-thumb')!
      thumb.addEventListener('error', () => {
        thumb.style.visibility = 'hidden'
      })
      listEl.appendChild(li)
    }
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  mapView = mountMapView(mapCanvas, {
    clickable: true,
    onClick(uv) {
      draftAnswer = uv
      updateAnswerMeta()
    },
  })

  root.querySelector('#btnNew')!.addEventListener('click', () => {
    clearForm()
    setFormStatus('Ny utfordring')
  })

  root.querySelector('#btnExport')!.addEventListener('click', () => {
    downloadChallengesJson(challenges)
    setFormStatus('JSON lastet ned')
  })

  root.querySelector('#btnImport')!.addEventListener('click', () => {
    importFile.click()
  })

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0]
    importFile.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const imported = parseChallengesJson(text)
      challenges = imported
      const result = await saveChallenges(challenges)
      const msg = !result.ok
        ? `Importert i minne, men fil-lagring feilet: ${result.error}`
        : `Importerte ${imported.length} utfordringer`
      clearForm()
      setFormStatus(msg, !result.ok)
    } catch (err) {
      console.error(err)
      setFormStatus('Kunne ikke importere JSON', true)
    }
  })

  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0] ?? null
    pendingFile = file
    if (!file) {
      if (editingId) {
        const existing = challenges.find((c) => c.id === editingId)
        if (existing) showImage(`/${existing.image}`, existing.image)
        else showImage(null, 'Ingen bilde valgt')
      } else {
        showImage(null, 'Ingen bilde valgt')
      }
      return
    }
    revokePreview()
    previewUrl = URL.createObjectURL(file)
    showImage(previewUrl, file.name)
  })

  yearInput.addEventListener('input', () => {
    syncYearFromInput()
  })

  root.querySelector('#btnSave')!.addEventListener('click', async () => {
    const id = idInput.value.trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setFormStatus('ID må være a-z, 0-9, _ eller -', true)
      return
    }
    if (!draftAnswer) {
      setFormStatus('Klikk på kartet for å sette fasit-sted', true)
      return
    }
    syncYearFromInput()
    if (yearInput.value.trim() && draftYear === null) {
      setFormStatus('År må være et 4-sifret tall (1000–9999)', true)
      return
    }

    const existing = challenges.find((c) => c.id === id)
    let imagePath = existing?.image ?? ''

    if (pendingFile) {
      setFormStatus('Laster opp bilde…')
      const up = await uploadChallengeImage(id, pendingFile)
      if (!up.ok) {
        setFormStatus(up.error, true)
        return
      }
      imagePath = up.image
    }

    if (!imagePath) {
      setFormStatus('Last opp et bilde', true)
      return
    }

    const next: Challenge = {
      id,
      image: imagePath,
      answer: {
        u: draftAnswer.x,
        v: draftAnswer.y,
        ...(draftYear !== null ? { year: draftYear } : {}),
      },
    }

    const idx = challenges.findIndex((c) => c.id === id)
    if (idx >= 0) challenges[idx] = next
    else challenges.push(next)

    setFormStatus('Lagrer…')
    const result = await saveChallenges(challenges)
    if (!result.ok) {
      setFormStatus(result.error, true)
      return
    }

    pendingFile = null
    imageInput.value = ''
    editingId = id
    idInput.readOnly = true
    showImage(`/${imagePath}`, imagePath)
    setFormStatus(`Lagret «${id}»`)
    renderList()
  })

  root.querySelector('#btnDelete')!.addEventListener('click', async () => {
    const id = idInput.value.trim() || editingId
    if (!id) {
      setFormStatus('Ingen utfordring valgt', true)
      return
    }
    if (!challenges.some((c) => c.id === id)) {
      clearForm()
      return
    }
    if (!confirm(`Slette utfordring «${id}»?`)) return
    challenges = challenges.filter((c) => c.id !== id)
    const result = await saveChallenges(challenges)
    if (!result.ok) {
      setFormStatus(result.error, true)
      return
    }
    clearForm()
    setFormStatus(`Slettet «${id}»`)
  })

  void (async () => {
    challenges = (await fetchChallenges()).challenges
    renderList()
  })()

  ;(window as unknown as { __tgCleanup?: () => void }).__tgCleanup = () => {
    mapView?.destroy()
    revokePreview()
  }
}

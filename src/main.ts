import './style.css'
import { mountCalibrate } from './ui/calibrate'
import { mountChallengeEditor } from './ui/challengeEditor'
import { mountGame } from './ui/game'
import { mountPrintTest } from './ui/printTest'

const appRoot = document.querySelector<HTMLDivElement>('#app')
if (!appRoot) {
  throw new Error('#app mangler')
}
const app: HTMLDivElement = appRoot

type Route = 'play' | 'calibrate' | 'challenges' | 'print'

function currentRoute(): Route {
  const hash = location.hash.replace(/^#/, '') || '/'
  if (hash === '/print' || hash.startsWith('/print/')) {
    return 'print'
  }
  if (hash === '/challenges' || hash.startsWith('/challenges/')) {
    return 'challenges'
  }
  if (hash === '/calibrate' || hash.startsWith('/calibrate/')) {
    return 'calibrate'
  }
  return 'play'
}

function cleanup(): void {
  const prev = (window as unknown as { __tgCleanup?: () => void }).__tgCleanup
  prev?.()
  ;(window as unknown as { __tgCleanup?: () => void }).__tgCleanup = undefined
}

function render(): void {
  cleanup()
  app.innerHTML = ''
  const route = currentRoute()
  if (route === 'print') {
    mountPrintTest(app)
  } else if (route === 'challenges') {
    mountChallengeEditor(app)
  } else if (route === 'calibrate') {
    mountCalibrate(app)
  } else {
    mountGame(app)
  }
}

window.addEventListener('hashchange', render)

if (!location.hash || location.hash === '#') {
  history.replaceState(null, '', `${location.pathname}${location.search}#/`)
}

render()

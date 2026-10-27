export type NavPage = 'play' | 'calibrate' | 'challenges' | 'print'

export function renderNav(active: NavPage): string {
  const link = (page: NavPage, href: string, label: string) =>
    `<a class="nav-link${active === page ? ' active' : ''}" href="${href}">${label}</a>`
  return `
    <nav class="header-nav">
      ${link('play', '#/', 'Spill')}
      ${link('calibrate', '#/calibrate', 'Kalibrering')}
      ${link('challenges', '#/challenges', 'Utfordringer')}
      ${link('print', '#/print', 'Printer')}
    </nav>
  `
}

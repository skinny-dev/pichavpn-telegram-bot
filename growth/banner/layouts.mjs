// Zones of every banner layout — ONE source of truth for (a) the renderer (poster.mjs style «f») and (b) the guide images/prompts for background generators.
// Coordinates in the layout's own pixel size. `hero` = where the logo character or a cut-out hero picture sits.
export const LAYOUTS = {
  'wide-r': { w: 1280, h: 720, note: 'کانال تلگرام / پست افقی · متن راست، قهرمان چپ',
    logo: { x: 1000, y: 36, w: 224, h: 64 }, handle: { x: 56, y: 44, w: 230, h: 36 },
    title: { x: 600, y: 150, w: 624, h: 230 }, subtitle: { x: 600, y: 392, w: 624, h: 100 }, chips: { x: 600, y: 508, w: 624, h: 48 },
    cta: { x: 880, y: 584, w: 344, h: 88 }, hero: { x: 56, y: 140, w: 520, h: 540 } },
  story: { w: 1080, h: 1920, note: 'استوری / ریلز عمودی',
    logo: { x: 340, y: 110, w: 400, h: 90 }, title: { x: 90, y: 260, w: 900, h: 380 }, hero: { x: 140, y: 680, w: 800, h: 640 },
    subtitle: { x: 90, y: 1360, w: 900, h: 170 }, chips: { x: 90, y: 1550, w: 900, h: 70 }, cta: { x: 240, y: 1660, w: 600, h: 110 }, handle: { x: 340, y: 1810, w: 400, h: 44 } },
  square: { w: 1080, h: 1080, note: 'اینستاگرام / پست مربع',
    logo: { x: 760, y: 50, w: 270, h: 80 }, handle: { x: 50, y: 60, w: 300, h: 44 }, title: { x: 420, y: 180, w: 610, h: 300 },
    subtitle: { x: 420, y: 490, w: 610, h: 140 }, chips: { x: 420, y: 650, w: 610, h: 60 }, cta: { x: 640, y: 900, w: 390, h: 100 }, hero: { x: 40, y: 260, w: 420, h: 760 } },
}
export const ZONE_LABELS = { logo: 'LOGO', handle: '@handle', title: 'TITLE (2 lines)', subtitle: 'SUBTITLE', chips: 'CHIPS', cta: 'BUTTON', hero: 'HERO / CHARACTER' }
export const ZONE_COLORS = { logo: '#22d3ee', handle: '#94a3b8', title: '#fbbf24', subtitle: '#a78bfa', chips: '#f472b6', cta: '#4ade80', hero: '#fb7185' }
export const pct = (L, z) => { const L0 = LAYOUTS[L], r = L0[z]; const f = (v, t) => Math.round((v / t) * 100); return `x ${f(r.x, L0.w)}–${f(r.x + r.w, L0.w)}%, y ${f(r.y, L0.h)}–${f(r.y + r.h, L0.h)}%` }

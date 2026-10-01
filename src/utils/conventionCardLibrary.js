// The convention card library (github.com/bridge-craftwork/convention-card):
// the converters and the ACBL PDF code moved there in its Phase 2. The
// library never fetches anything itself, so this tells it where Vite serves
// its template PDFs and font, which come from the package.

import { setAssetLoader, TEMPLATE_FILES } from '@bridge-craftwork/convention-card/js/assets.js'
import classicUrl from '@bridge-craftwork/convention-card/assets/templates/acbl-classic-2023.pdf?url'
import newUrl from '@bridge-craftwork/convention-card/assets/templates/acbl-new.pdf?url'
import fontUrl from '@bridge-craftwork/convention-card/assets/fonts/BarlowCondensed-Regular.ttf?url'

const TEMPLATE_URLS = { classic: classicUrl, new: newUrl }

async function bytes(url, what) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${what} (${res.status}) from ${url}`)
  return res.arrayBuffer()
}

setAssetLoader({
  template: name => bytes(TEMPLATE_URLS[name], `the ACBL ${TEMPLATE_FILES[name]} template`),
  font: () => bytes(fontUrl, 'the condensed field font'),
})

/** The ACBL PDF module, loaded only when it is needed (it brings pdf-lib). */
export function loadAcblPdf() {
  return import('@bridge-craftwork/convention-card/js/acblClassicFillPdf.js')
}

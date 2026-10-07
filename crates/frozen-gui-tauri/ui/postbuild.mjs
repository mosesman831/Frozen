// Rewrite module tag -> classic script: tauri:// can't serve ES-module fetches in this WV2.
import { readFileSync, writeFileSync } from 'node:fs'
const p = new URL('./dist/index.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let html = readFileSync(p, 'utf8')
html = html.replace(/ crossorigin(?=[\s>])/g, '')
html = html.replace(/<script type="module"([^>]*)><\/script>/g, '<script defer$1></script>')
writeFileSync(p, html)
console.log('postbuild done')

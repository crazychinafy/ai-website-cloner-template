// P8 static snapshot guard: SHA-256 of protected files (P8-12).
// Usage:
//   node scripts/p8-static-hash.mjs record docs/P8-static-baseline.json
//   node scripts/p8-static-hash.mjs verify docs/P8-static-baseline.json
import { createHash } from "node:crypto"
import { readdir, readFile, writeFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const PROTECTED_DIRS = [
  "src/lib/facai8/data",
  "public/sites/facai8/images",
]
const PROTECTED_FILES = [
  "src/components/sites/facai8/facai8.css",
  "src/components/sites/facai8/iconfont.css",
  "src/app/globals.css",
]

async function walk(rel) {
  const abs = path.join(root, rel)
  const out = []
  const st = await stat(abs).catch(() => null)
  if (!st) return out
  if (st.isFile()) return [rel]
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const child = path.posix.join(rel.split(path.sep).join("/"), e.name)
    if (e.isDirectory()) out.push(...(await walk(child)))
    else out.push(child)
  }
  return out
}

const files = [...(await Promise.all(PROTECTED_DIRS.map(walk))).flat(), ...PROTECTED_FILES]
const map = {}
for (const f of [...files].sort()) {
  const buf = await readFile(path.join(root, f))
  map[f] = { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length }
}

const mode = process.argv[2]
const arg = process.argv[3]
if (mode === "record") {
  await writeFile(path.resolve(arg ?? "docs/P8-static-baseline.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files: map }, null, 2) + "\n")
  console.log(`recorded ${Object.keys(map).length} protected files`)
  for (const [f, v] of Object.entries(map)) if (f.startsWith("src/lib/facai8/data")) console.log(`  ${v.sha256.slice(0, 16)}  ${f}`)
} else {
  const base = JSON.parse(await readFile(path.resolve(arg), "utf8"))
  let bad = 0
  const keys = new Set([...Object.keys(base.files), ...Object.keys(map)])
  for (const f of [...keys].sort()) {
    const a = base.files[f], b = map[f]
    if (!a) { console.log(`ADDED   ${f}`); bad++; continue }
    if (!b) { console.log(`REMOVED ${f}`); bad++; continue }
    if (a.sha256 !== b.sha256) { console.log(`CHANGED ${f}`); bad++ }
  }
  const dataCount = Object.keys(map).filter((f) => f.startsWith("src/lib/facai8/data")).length
  const dataOk = Object.keys(map).filter((f) => f.startsWith("src/lib/facai8/data")).filter((f) => base.files[f]?.sha256 === map[f].sha256).length
  console.log(`protected files: ${Object.keys(map).length} | src/lib/facai8/data: ${dataOk}/${dataCount} match baseline | mismatches total: ${bad}`)
  if (bad) process.exitCode = 1
}

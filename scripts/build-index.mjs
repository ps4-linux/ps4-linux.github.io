import path from 'node:path'
import process from 'node:process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'

const root = process.cwd()
const sourceFolders = [
  { dir: 'games', type: 'game' },
  { dir: 'apps', type: 'app' },
]
const outDir = path.join(root, 'public', 'api')
const itemOutDir = path.join(outDir, 'items')
const validateOnly = process.argv.includes('--validate-only')

const allowedStatus = new Set([
  'platinum',
  'gold',
  'silver',
  'bronze',
  'middle',
  'config',
  'tweaking',
  'borked',
])

const allowedFamily = new Set(['alpine', 'arch', 'fedora', 'atomic', 'debian', 'other'])
const allowedModels = new Set(['pro', 'slim', 'fat'])

const requiredStringFields = ['id', 'name', 'status', 'tb', 'kernel', 'distro']
const defaultGameProton = ''

const isHttpsUrl = (value) => {
  try {
    const u = new URL(value)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeText = (value) => String(value).trim()

const ensure = (condition, message) => {
  if (!condition) throw new Error(message)
}

const writeJson = async (targetPath, value) => {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const parseJsonFile = async (filePath) => {
  try {
    const source = await readFile(filePath, 'utf8')
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(root, filePath)}: ${error.message}`)
  }
}

const readEntries = async ({ dir, type }) => {
  const directory = path.join(root, dir)
  const dirEntries = await readdir(directory, { withFileTypes: true })
  const jsonFiles = dirEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  const items = []

  for (const file of jsonFiles) {
    const filePath = path.join(directory, file.name)
    const raw = await parseJsonFile(filePath)
    items.push(validateEntry(raw, filePath, type))
  }

  return items
}

const validateEntry = (rawEntry, filePath, expectedType) => {
  ensure(rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry), `${path.relative(root, filePath)} must contain a JSON object`)

  for (const field of requiredStringFields) {
    ensure(typeof rawEntry[field] === 'string' && normalizeText(rawEntry[field]).length > 0, `${path.relative(root, filePath)} missing required field "${field}"`)
  }

  const id = normalizeText(rawEntry.id)
  ensure(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), `${path.relative(root, filePath)} has invalid id "${id}" (use kebab-case)`)

  const type = normalizeText(rawEntry.type ?? expectedType).toLowerCase()
  ensure(type === expectedType, `${path.relative(root, filePath)} must be type "${expectedType}"`)

  const status = normalizeText(rawEntry.status).toLowerCase()
  ensure(allowedStatus.has(status), `${path.relative(root, filePath)} has invalid status "${status}"`)

  const tags = rawEntry.tags ?? []
  ensure(Array.isArray(tags), `${path.relative(root, filePath)} "tags" must be an array`)
  ensure(tags.every((tag) => typeof tag === 'string'), `${path.relative(root, filePath)} tags must only contain strings`)

  const rawModels = rawEntry.models ?? rawEntry.model ?? []
  const models = (Array.isArray(rawModels) ? rawModels : [rawModels])
    .map((model) => normalizeText(model).toLowerCase())
    .filter(Boolean)
  ensure(models.length > 0, `${path.relative(root, filePath)} must specify "model" or "models" (pro/slim/fat)`)
  for (const model of models) {
    ensure(allowedModels.has(model), `${path.relative(root, filePath)} has invalid model "${model}"`)
  }

  const proof = normalizeText(rawEntry.proof ?? '')
  if (proof) {
    ensure(isHttpsUrl(proof), `${path.relative(root, filePath)} "proof" must be an https:// URL`)
  }

  return {
    id,
    name: normalizeText(rawEntry.name),
    type,
    status,
    tb: normalizeText(rawEntry.tb),
    distro: normalizeText(rawEntry.distro),
    kernel: normalizeText(rawEntry.kernel),
    compatibility: normalizeText(rawEntry.compatibility ?? 'Unknown'),
    notes: normalizeText(rawEntry.notes ?? ''),
    proton: normalizeText(
      rawEntry.proton ?? (type === 'game' ? defaultGameProton : ''),
    ),
    platform: normalizeText(rawEntry.platform ?? 'ps4'),
    store: normalizeText(rawEntry.store ?? 'psn'),
    tags: tags.map((tag) => normalizeText(tag)).filter(Boolean),
    models,
    storage: normalizeText(rawEntry.storage ?? ''),
    fps: normalizeText(rawEntry.fps ?? ''),
    resolution: normalizeText(rawEntry.resolution ?? ''),
    performance: normalizeText(rawEntry.performance ?? ''),
    proof,
  }
}

const sortEntries = (entries) => {
  const weight = {
    platinum: 1,
    gold: 2,
    silver: 3,
    bronze: 4,
    middle: 5,
    config: 6,
    tweaking: 7,
    borked: 8,
  }

  entries.sort(
    (a, b) =>
      (weight[a.status] ?? 99) - (weight[b.status] ?? 99) ||
      a.name.localeCompare(b.name),
  )
}

const buildApiPayload = (entries) => {
  const byType = entries.reduce(
    (result, entry) => {
      result[entry.type] += 1
      return result
    },
    { game: 0, app: 0 },
  )

  const byStatus = entries.reduce((result, entry) => {
    result[entry.status] = (result[entry.status] ?? 0) + 1
    return result
  }, {})

  return {
    project: 'ps4-linux',
    generatedAt: new Date().toISOString(),
    platform: 'ps4',
    guidance: 'Most supported platforms: Aeolia and Belize. Baikal was recently upstreamed to 7.0 by rmuxnet and may remain unstable until further testing. ps4-linux only accepts open-source kernel trees with public source and attribution; closed forks or kernels distributed without upstream source (e.g., KHEOPS-style dumps) are unsupported and will not be assisted.',
    submission: 'Add one JSON file per title in games/ or apps/ and open a pull request.',
    stats: {
      total: entries.length,
      byType,
      byStatus,
    },
    items: entries,
  }
}

const ensureUniqueIds = (entries) => {
  const ids = new Set()
  for (const entry of entries) {
    ensure(!ids.has(entry.id), `Duplicate id "${entry.id}" detected`)
    ids.add(entry.id)
  }
}

// Reads distros/, kernels/, or initramfs/ — simple link entries, one JSON file each.
const readResourceFolder = async (dir, { requireFamily }) => {
  const directory = path.join(root, dir)
  let dirEntries
  try {
    dirEntries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const items = []
  for (const file of dirEntries.filter((e) => e.isFile() && e.name.endsWith('.json'))) {
    const filePath = path.join(directory, file.name)
    const rel = path.relative(root, filePath)
    const raw = await parseJsonFile(filePath)
    ensure(raw && typeof raw === 'object' && !Array.isArray(raw), `${rel} must contain a JSON object`)

    for (const field of ['id', 'name', 'url']) {
      ensure(typeof raw[field] === 'string' && normalizeText(raw[field]).length > 0, `${rel} missing required field "${field}"`)
    }

    const id = normalizeText(raw.id)
    ensure(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), `${rel} has invalid id "${id}" (use kebab-case)`)

    const entry = {
      id,
      name: normalizeText(raw.name),
      summary: normalizeText(raw.summary ?? ''),
      url: normalizeText(raw.url),
    }

    if (requireFamily) {
      const family = normalizeText(raw.family ?? '').toLowerCase()
      ensure(allowedFamily.has(family), `${rel} has invalid family "${family}"`)
      entry.family = family
    }

    items.push(entry)
  }

  ensureUniqueIds(items)
  items.sort((a, b) => a.name.localeCompare(b.name))
  return items
}

const generate = async () => {
  const allEntries = (
    await Promise.all(sourceFolders.map((folder) => readEntries(folder)))
  ).flat()

  ensureUniqueIds(allEntries)
  sortEntries(allEntries)

  const distros = await readResourceFolder('distros', { requireFamily: true })
  const kernels = await readResourceFolder('kernels', { requireFamily: false })
  const initramfs = await readResourceFolder('initramfs', { requireFamily: false })

  const payload = {
    ...buildApiPayload(allEntries),
    resources: { distros: distros.length, kernels: kernels.length, initramfs: initramfs.length },
  }

  if (validateOnly) {
    process.stdout.write(
      `Validated ${allEntries.length} entries, ${distros.length} distros, ${kernels.length} kernels, ${initramfs.length} initramfs.\n`,
    )
    return
  }

  await rm(outDir, { force: true, recursive: true })
  await mkdir(itemOutDir, { recursive: true })

  const games = allEntries.filter((entry) => entry.type === 'game')
  const apps = allEntries.filter((entry) => entry.type === 'app')

  await Promise.all([
    writeJson(path.join(outDir, 'index.json'), payload),
    writeJson(path.join(outDir, 'games.json'), games),
    writeJson(path.join(outDir, 'apps.json'), apps),
    writeJson(path.join(outDir, 'distros.json'), distros),
    writeJson(path.join(outDir, 'kernels.json'), kernels),
    writeJson(path.join(outDir, 'initramfs.json'), initramfs),
  ])

  await Promise.all(
    allEntries.map((entry) =>
      writeJson(path.join(itemOutDir, `${entry.id}.json`), entry),
    ),
  )

  process.stdout.write(
    `Built API for ${allEntries.length} entries, ${distros.length} distros, ${kernels.length} kernels, ${initramfs.length} initramfs.\n`,
  )
}

generate().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})

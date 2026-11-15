/**
 * dsh-mcp-panel — host half.
 *
 * Lists every MCP server configured in the profile's user patch layer
 * (`cordis.patch.yml`) and flips its `disabled` flag. It deliberately does NOT
 * try to hot-mount/unmount MCP clients: this harness build does not apply patch
 * edits live (verified empirically), so a toggle only takes effect on the next
 * boot. To keep that honest the plugin records the map it was booted with and
 * reports a per-entry `pendingRestart` flag instead of pretending the switch
 * worked.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const name = 'dsh-mcp-panel'

const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'
const APPLIED_FILE = '.mcp-panel-applied.json'

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Which profile this host booted. `dsh --profile <name>` wins, then `$DSH_PROFILE`,
 * then the Desktop app's usual `desktop` profile. Resolving this instead of hard
 * coding `desktop` keeps the plugin usable from a plain `dsh web` session too.
 */
function profileName() {
  const flag = process.argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < process.argv.length && !process.argv[flag + 1].startsWith('-')) return process.argv[flag + 1]
  return process.env.DSH_PROFILE || 'desktop'
}

function resolvePatchPath(config) {
  if (config?.patchPath) return config.patchPath
  if (process.env.DSH_MCP_PANEL_PATCH) return process.env.DSH_MCP_PANEL_PATCH
  return join(dshHome(), 'profiles', profileName(), 'cordis.patch.yml')
}

/* ------------------------------------------------------------------ *
 * A deliberately small line-oriented reader for the patch layer. The file is
 * a flat list of `- insert:` / `- id:` entries; parsing the two shapes we care
 * about keeps this plugin dependency-free and byte-preserving on write.
 * ------------------------------------------------------------------ */

function indentOf(line) {
  return line.length - line.trimStart().length
}

function unquote(value) {
  const v = value.trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1)
  return v
}

/** Parse inline `args: ['a', 'b']` and block lists (`args:` then `- 'a'`). */
function readArgs(lines, from, to, blockIndent) {
  const inline = lines[from].match(/^\s*args:\s*\[(.*)\]\s*$/)
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => unquote(s))
      .filter((s) => s !== '')
  }
  const out = []
  for (let i = from + 1; i <= to; i++) {
    const m = lines[i].match(/^\s*-\s+(.+?)\s*$/)
    if (!m) continue
    if (indentOf(lines[i]) <= blockIndent) break
    out.push(unquote(m[1]))
  }
  return out
}

function readEntries(patchPath) {
  if (!existsSync(patchPath)) return []
  const text = readFileSync(patchPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const blocks = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+id:\s*(\S.*?)\s*$/)
    if (!m) continue
    const blockIndent = m[1].length
    let end = lines.length - 1
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim()
      if (t === '' || t.startsWith('#')) continue
      const ind = indentOf(lines[j])
      if (ind <= blockIndent) {
        end = j - 1
        break
      }
    }
    blocks.push({ start: i, end, id: unquote(m[2]), blockIndent })
    i = end
  }

  const entries = []
  for (const b of blocks) {
    const fields = {}
    let argsIndex = -1
    for (let i = b.start; i <= b.end; i++) {
      const line = lines[i]
      const kv = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/)
      if (!kv) continue
      const [, key, rawValue] = kv
      if (key === 'args') argsIndex = i
      fields[key] = rawValue
    }
    if (unquote(fields.name ?? '') !== MCP_PLUGIN) continue
    const disabledRaw = fields.disabled
    const disabled = disabledRaw !== undefined && unquote(disabledRaw) !== 'false'
    entries.push({
      id: b.id,
      line: b.start + 1,
      block: b,
      serverName: unquote(fields.serverName ?? '') || b.id,
      transport: unquote(fields.transport ?? 'stdio'),
      command: unquote(fields.command ?? ''),
      url: unquote(fields.url ?? ''),
      args: argsIndex >= 0 ? readArgs(lines, argsIndex, b.end, b.blockIndent) : [],
      disabled,
    })
  }
  return entries
}

/** Flip one entry's `disabled` line, leaving every other byte untouched. */
function setDisabled(patchPath, id, disabled) {
  const original = readFileSync(patchPath, 'utf8')
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)
  const entry = readEntries(patchPath).find((e) => e.id === id)
  if (!entry) throw new Error(`no entry with id ${id}`)

  const { start, end } = entry.block
  const indent = entry.block.blockIndent + 2
  let disabledLine = -1
  for (let i = start; i <= end; i++) {
    if (/^\s*disabled:/.test(lines[i])) {
      disabledLine = i
      break
    }
  }

  if (disabled) {
    if (disabledLine >= 0) {
      lines[disabledLine] = `${' '.repeat(indent)}disabled: true`
    } else {
      let anchor = -1
      for (let i = start; i <= end; i++) {
        if (/^\s*name:\s/.test(lines[i])) {
          anchor = i
          break
        }
      }
      if (anchor < 0) anchor = start
      lines.splice(anchor + 1, 0, `${' '.repeat(indent)}disabled: true`)
    }
  } else if (disabledLine >= 0) {
    lines.splice(disabledLine, 1)
  }

  const next = lines.join(newline)
  if (next !== original) writeFileSync(patchPath, next, 'utf8')
  return next !== original
}

/* ------------------------------------------------------------------ *
 * Boot-time snapshot: what this process is actually running with.
 * ------------------------------------------------------------------ */

function profileDirOf(patchPath) {
  return join(patchPath, '..')
}

function readApplied(patchPath) {
  const file = join(profileDirOf(patchPath), APPLIED_FILE)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeApplied(patchPath) {
  const file = join(profileDirOf(patchPath), APPLIED_FILE)
  const entries = readEntries(patchPath)
  const applied = { bootedAt: new Date().toISOString(), pid: process.pid, enabled: {} }
  for (const e of entries) applied.enabled[e.id] = !e.disabled
  try {
    writeFileSync(file, JSON.stringify(applied, null, 2), 'utf8')
  } catch {
    /* a read-only profile dir must not break boot */
  }
  return applied
}

function buildState(patchPath) {
  const entries = readEntries(patchPath)
  const applied = readApplied(patchPath)
  const list = entries.map((e) => {
    const enabled = !e.disabled
    const booted = applied?.enabled?.[e.id]
    return {
      id: e.id,
      serverName: e.serverName,
      transport: e.transport,
      command: e.command,
      url: e.url,
      args: e.args,
      enabled,
      booted: booted === undefined ? null : booted,
      pendingRestart: booted !== undefined && booted !== enabled,
    }
  })
  return {
    patchPath,
    exists: existsSync(patchPath),
    updatedAt: existsSync(patchPath) ? statSync(patchPath).mtime.toISOString() : null,
    bootedAt: applied?.bootedAt ?? null,
    hostPid: process.pid,
    pendingRestart: list.some((e) => e.pendingRestart),
    entries: list,
  }
}

/* ------------------------------------------------------------------ *
 * Restart (fallback path only).
 *
 * The Electron shell owns the process lifecycle, so a helper spawned by the
 * host dies with the host's job object before it can do anything — measured, not
 * assumed: `spawn(detached)` returns a pid, the child never writes its marker.
 * The preferred route is therefore DSH Desktop's own `POST /api/desktop/restart`
 * (what the settings header's 重启 uses); the panel tries it first. This function
 * exists for hosts without that endpoint — there the only detached mechanism
 * that survives is the Windows Task Scheduler, which is why it goes through
 * schtasks instead of spawning powershell directly.
 * ------------------------------------------------------------------ */

const RESTART_TASK = 'DSHDesktopRestartOnce'

function scheduleRestart() {
  if (process.platform !== 'win32') throw new Error('restart is only wired for win32')
  const exe = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DSH Desktop', 'DSH Desktop.exe')
  if (!existsSync(exe)) throw new Error(`cannot find ${exe}`)

  const scriptPath = join(tmpdir(), 'dsh-mcp-panel-restart.ps1')
  const script = [
    'Start-Sleep -Milliseconds 700',
    "Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force",
    'Start-Sleep -Seconds 3',
    `Start-Process '${exe}'`,
    'Start-Sleep -Seconds 15',
    `schtasks.exe /delete /tn "${RESTART_TASK}" /f | Out-Null`,
  ].join('\r\n')
  writeFileSync(scriptPath, script, 'utf8')

  const tr = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`
  // Scheduled far in the future and started by hand: a leftover task can never
  // fire on its own, and the script deletes it after the relaunch.
  const create = spawnSync(
    'schtasks.exe',
    ['/create', '/tn', RESTART_TASK, '/tr', tr, '/sc', 'once', '/st', '03:00', '/sd', '2030/01/01', '/f'],
    { windowsHide: true, encoding: 'utf8' },
  )
  if (create.status !== 0) throw new Error(`schtasks create failed: ${(create.stderr || create.stdout || '').trim()}`)
  const run = spawnSync('schtasks.exe', ['/run', '/tn', RESTART_TASK], { windowsHide: true, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`schtasks run failed: ${(run.stderr || run.stdout || '').trim()}`)
  return { via: 'schtasks', task: RESTART_TASK }
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx, config) {
  const patchPath = resolvePatchPath(config)
  // Snapshot what this boot is actually running with, so the UI can tell a real
  // toggle from one that still needs a restart.
  writeApplied(patchPath)
  ctx.inject(['webServer'], (host) => {
    const disposers = []

    disposers.push(
      host.webServer.register({
        kind: 'exact',
        path: '/dsh-mcp-panel/state',
        handler: (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          try {
            sendJson(res, 200, buildState(patchPath))
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) })
          }
        },
      }),
    )

    disposers.push(
      host.webServer.register({
        kind: 'exact',
        path: '/dsh-mcp-panel/toggle',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          try {
            const body = await readBody(req)
            if (typeof body.id !== 'string' || typeof body.enabled !== 'boolean') {
              sendJson(res, 400, { error: 'id (string) and enabled (boolean) are required' })
              return
            }
            const changed = setDisabled(patchPath, body.id, !body.enabled)
            sendJson(res, 200, { changed, state: buildState(patchPath) })
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) })
          }
        },
      }),
    )

    disposers.push(
      host.webServer.register({
        kind: 'exact',
        path: '/dsh-mcp-panel/restart',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          try {
            const scheduled = scheduleRestart()
            sendJson(res, 202, { scheduled: true, ...scheduled })
          } catch (error) {
            sendJson(res, 500, { error: String(error?.message ?? error) })
          }
        },
      }),
    )

    host.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'dsh-mcp-panel: http routes')
  })
}

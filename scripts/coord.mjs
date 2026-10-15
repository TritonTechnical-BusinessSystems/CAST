#!/usr/bin/env node
// Coordination between sessions, on GitHub Issues (knowledge/conventions/session-coordination.md).
// Work belongs to a role, never to a session name, so a new session can take a role over at any time.
//
//   node scripts/coord.mjs roles                         the roles in coordination/ROLES.md and who holds each seat
//   node scripts/coord.mjs list [--role <id>] [--all]    open requests (default: all roles)
//   node scripts/coord.mjs post --to <role> --from <role> --title <t> [--body <b>] [--refs <ids> topic#<n>]
//   node scripts/coord.mjs claim <n> --as <role>         claim a request; the earliest claim comment wins
//   node scripts/coord.mjs release <n> --as <role> [--note <t>]
//   node scripts/coord.mjs done <n> --as <role> [--note <t>]
//   node scripts/coord.mjs comment <n> --body <t> [--session <name>]   add a comment (check-ins, replies)
//   node scripts/coord.mjs seat take <role> [--note <t>]    become the holder; prints the handoff notes
//   node scripts/coord.mjs seat handoff <role> --note <t>   leave notes for whoever holds the role next
//   node scripts/coord.mjs seat init <role>              create the role's seat issue (once)
//   node scripts/coord.mjs proposal post --role <id> --title <t> --body <b>   propose a new role (the user decides)
//   node scripts/coord.mjs proposal decide <n> --as approve|defer|deny --note <t>
//   node scripts/coord.mjs whoami [--id session_<id>]    which role this session holds (from its worktree name or --id)
//   node scripts/coord.mjs proposals                     open and decided role proposals
//   node scripts/coord.mjs topic open "<name>"          open a topic issue; prints its number
//   node scripts/coord.mjs topics                        the board: each open topic, who has open work on it, questions for the user
//   node scripts/coord.mjs list --topic <n>              the open requests that carry topic#<n>
//
// Repo: derived from `git remote get-url origin` (ssh aliases and https both work); override with --repo owner/name
// or COORD_REPO. A session is named by --session, else the folder it runs in.
// Token: GH_TOKEN, else the file named by COORD_TOKEN_FILE, else .env.github in the main checkout, else gh's own
// login (`gh auth login`). It is read in-process and never printed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const STALE_HOURS = 48
const MARK = { claim: 'CLAIM', release: 'RELEASE', holder: 'HOLDER', handoff: 'HANDOFF', decision: 'DECISION', checkpoint: 'CHECKPOINT' }
const DECISIONS = ['approve', 'defer', 'deny']

/**
 * Who holds a claim: the first CLAIM comment (by the server's order) not followed by that role's RELEASE.
 * GitHub has no compare-and-swap, so two sessions may both comment; the server orders them and the earlier wins.
 * @param {{ body: string }[]} comments oldest first
 * @returns {string | null} the winning role
 */
export function claimWinner(comments) {
  let winner = null
  for (const { body } of comments) {
    const [mark, role] = body.trim().split(/\s+/)
    if (mark === MARK.claim && !winner) winner = role
    else if (mark === MARK.release && role === winner) winner = null
  }
  return winner
}

/**
 * The session id a worktree path names: a Claude Code bridge session works in `.../bridge-cse_<id>`, which is `session_<id>`.
 * @param {string} path a working directory (any folder inside the worktree counts)
 */
export function sessionIdFromPath(path) {
  const m = path.match(/(?:^|[\\/])bridge-cse_([A-Za-z0-9]+)(?=$|[\\/])/)
  return m ? `session_${m[1]}` : null
}

/**
 * The row of coordination/ROSTER.md whose first session id is the one asked for (a row may name a replaced session
 * later, and that one is not the holder). A row led by a backticked role is a seat; any other row that names the id (the
 * spare, or a table of sessions without a seat) is returned with no role.
 * @param {string} markdown ROSTER.md
 * @param {string} id `session_<id>`
 * @returns {{ role: string | null, row: string } | null}
 */
export function sessionRow(markdown, id) {
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    const first = cells
      .slice(2)
      .join(' ')
      .match(/session_[A-Za-z0-9]+/)?.[0]
    const role = cells[1]?.match(/^`([a-z0-9-]+)`/)?.[1] ?? null
    if (role && first === id) return { role, row: line }
    if (!role && line.includes(id)) return { role: null, row: line }
  }
  return null
}

/** The role's row of coordination/ROLES.md: the first table row led by the backticked role id. */
export const roleRow = (markdown, role) => markdown.split('\n').find((l) => l.startsWith(`| \`${role}\` |`)) ?? null

/** The newest CHECKPOINT comment (oldest-first list in, the last match out), or null. */
export const latestCheckpoint = (comments) =>
  [...comments].reverse().find((c) => c.body.startsWith(MARK.checkpoint)) ?? null

/** The topic a request or reference text belongs to (`topic#12`), or null. */
export const topicOf = (text) => {
  const m = (text ?? '').match(/\btopic#(\d+)/)
  return m ? Number(m[1]) : null
}

/** The line a request leaves on its topic issue when it is posted, claimed, finished or released. */
export const topicLine = (event, n, role, title) => `${event} #${n} (${role}): ${title}`

/** The topic issue's name: its title without the `Topic: ` prefix. */
export const topicName = (title) => title.replace(/^Topic:\s*/i, '')

/** The session a topic issue names on its `Session:` line, or null while it is unset. */
export const topicSession = (body) => (body ?? '').match(/^Session:[ \t]*(\S.*)$/m)?.[1].trim() ?? null

/**
 * How many questions to the user on a topic are still unanswered: comments starting `Decision needed:` minus comments
 * starting `Decided:`, never below zero (one question per comment, one recorded answer per question).
 * @param {{ body: string }[]} comments
 */
export const openQuestions = (comments) => {
  const count = (mark) => comments.filter((c) => c.body.trim().startsWith(mark)).length
  return Math.max(0, count('Decision needed:') - count('Decided:'))
}

/** Hours since an ISO time. */
export const hoursSince = (iso, now = Date.now()) => (now - Date.parse(iso)) / 36e5

/**
 * owner/name from a git remote URL: https://host/o/r(.git), ssh://git@host/o/r.git, git@host:o/r.git,
 * and ssh aliases such as git@github.com-alias:o/r.git.
 * @returns {string | null}
 */
export function parseRepoUrl(url) {
  const m = String(url)
    .trim()
    .match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?[^/:]+(?::\d+)?[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/i)
  return m ? `${m[1]}/${m[2]}` : null
}

/**
 * The role ids in the first column of the markdown table(s) in coordination/ROLES.md: rows whose first cell is a
 * backticked id. Header and separator rows have none, so they are skipped.
 * @param {string} markdown
 * @returns {string[]}
 */
export function parseRolesTable(markdown) {
  const ids = []
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/)
    if (m && !ids.includes(m[1])) ids.push(m[1])
  }
  return ids
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const mainCheckout = () => dirname(resolve(git('rev-parse', '--git-common-dir')))

let repoOverride
function repo() {
  const r = repoOverride ?? process.env.COORD_REPO ?? parseRepoUrl(git('remote', 'get-url', 'origin'))
  if (!r || !/^[^/\s]+\/[^/\s]+$/.test(r))
    throw new Error('Cannot work out the GitHub repo. Pass --repo owner/name or set COORD_REPO.')
  return r
}

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  const files = [process.env.COORD_TOKEN_FILE, resolve(mainCheckout(), '.env.github')].filter(Boolean)
  for (const file of files) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const line = text.split('\n').find((l) => l.startsWith('GH_TOKEN='))
    if (line) return line.slice('GH_TOKEN='.length).trim()
    if (file === process.env.COORD_TOKEN_FILE && /^\S+$/.test(text.trim())) return text.trim() // only the token
    throw new Error(`${basename(file)} has no GH_TOKEN line.`)
  }
  return null // fall back to gh's own login (gh auth login)
}

let cachedToken
function gh(args, input) {
  cachedToken ??= token() ?? ''
  const out = execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    env: cachedToken ? { ...process.env, GH_TOKEN: cachedToken } : process.env,
    timeout: 30_000,
  })
  return out.trim()
}
const api = (path, ...rest) => JSON.parse(gh(['api', `repos/${repo()}/${path}`, ...rest]) || 'null')

const comments = (n) => api(`issues/${n}/comments?per_page=100`)
const comment = (n, body) => gh(['issue', 'comment', String(n), '-R', repo(), '--body-file', '-'], body)
const commentAndConfirm = (n, body) => console.log(`Posted: ${comment(n, body)}`)
const labelsOf = (issue) => issue.labels.map((l) => l.name)
const roleOf = (issue) =>
  labelsOf(issue)
    .find((l) => l.startsWith('role:'))
    ?.slice(5)
const stamp = (session) => `${session} @ ${new Date().toISOString()}`

function openCoord({ role, all }) {
  const labels = ['coord', ...(role ? [`role:${role}`] : [])].join(',')
  return api(`issues?state=open&labels=${labels}&per_page=100`).filter(
    (i) =>
      !i.pull_request &&
      !labelsOf(i).includes('topic') &&
      (all || !(labelsOf(i).includes('role-seat') || labelsOf(i).includes('role-proposal'))),
  )
}

function list(values) {
  const topic = values.topic === undefined ? null : Number(values.topic)
  const rows = openCoord({ role: values.role, all: values.all }).filter(
    (i) => topic === null || topicOf(i.body) === topic,
  )
  if (!rows.length) return console.log('No open requests.')
  for (const i of rows) {
    const claimed = labelsOf(i).includes('claimed')
    const stale = claimed && hoursSince(i.updated_at) > STALE_HOURS
    const state = stale
      ? `STALE claim (${Math.round(hoursSince(i.updated_at))}h quiet, may be taken over)`
      : claimed
        ? 'claimed'
        : 'open'
    console.log(`#${i.number}  [${roleOf(i) ?? '?'}]  ${state}  ${i.title}`)
  }
}

function tableRoles() {
  const file = resolve(mainCheckout(), 'coordination/ROLES.md')
  return existsSync(file) ? parseRolesTable(readFileSync(file, 'utf8')) : []
}

function roles() {
  const seats = openCoord({ all: true }).filter((i) => labelsOf(i).includes('role-seat'))
  const bySeat = new Map(seats.map((s) => [roleOf(s), s]))
  const ids = [...new Set([...tableRoles(), ...bySeat.keys()])]
  if (!ids.length) return console.log('No roles yet. See coordination/ROLES.md, then: seat init <role>')
  for (const id of ids) {
    const s = bySeat.get(id)
    if (!s) {
      console.log(`${id}  no seat yet`)
      continue
    }
    const holder = [...comments(s.number)].reverse().find((c) => c.body.startsWith(MARK.holder))
    const who = holder ? holder.body.split('\n')[0].slice(MARK.holder.length).trim() : 'vacant'
    console.log(`${id}  #${s.number}  ${who}${tableRoles().includes(id) ? '' : '  (not in ROLES.md)'}`)
  }
}

function post(v) {
  if (!v.to || !v.from || !v.title) throw new Error('post needs --to, --from and --title.')
  const body = `From role: **${v.from}**${v.refs ? `\nRefs: ${v.refs}` : ''}\n\n${v.body ?? ''}`
  const url = gh(
    ['issue', 'create', '-R', repo(), '--title', v.title, '--label', `coord,role:${v.to}`, '--body-file', '-'],
    body,
  )
  console.log(url)
  mirrorToTopic(topicOf(v.refs), topicLine(`Posted to ${v.to}:`, url.split('/').pop(), v.from, v.title))
}

/** One line on the topic issue, so the topic stays true without anyone chasing it. No topic, no line. */
function mirrorToTopic(topic, line) {
  if (topic) comment(topic, line)
}

const topicOfRequest = (n) => {
  const { body, title } = api(`issues/${n}`)
  return { topic: topicOf(body), title }
}

function claim(n, v, session) {
  if (!v.as) throw new Error('claim needs --as <role>.')
  const issue = api(`issues/${n}`)
  const before = claimWinner(comments(n))
  if (before && before !== v.as && hoursSince(issue.updated_at) <= STALE_HOURS) {
    return console.log(`#${n} is already claimed by ${before}. Pick another.`)
  }
  if (before && before !== v.as)
    comment(n, `${MARK.release} ${before}\nStale after ${STALE_HOURS}h; taken over by ${v.as}.`)
  comment(n, `${MARK.claim} ${v.as}\n${stamp(session)}`)
  const winner = claimWinner(comments(n))
  if (winner !== v.as) return console.log(`Lost the race: #${n} is claimed by ${winner}.`)
  gh(['issue', 'edit', String(n), '-R', repo(), '--add-label', 'claimed'])
  const { topic, title } = topicOfRequest(n)
  mirrorToTopic(topic, topicLine('Claimed', n, v.as, title))
  console.log(`#${n} is yours (${v.as}). Say what you finished with: done ${n} --as ${v.as}`)
}

function release(n, v, session, close) {
  if (!v.as) throw new Error('release and done need --as <role>.')
  if (claimWinner(comments(n)) !== v.as) throw new Error(`#${n} is not claimed by ${v.as}.`)
  comment(n, `${close ? 'DONE' : MARK.release} ${v.as}\n${stamp(session)}${v.note ? `\n\n${v.note}` : ''}`)
  if (close) gh(['issue', 'close', String(n), '-R', repo()])
  gh(['issue', 'edit', String(n), '-R', repo(), '--remove-label', 'claimed'])
  const { topic, title } = topicOfRequest(n)
  mirrorToTopic(topic, topicLine(close ? 'Done' : 'Released', n, v.as, title))
  console.log(close ? `#${n} closed.` : `#${n} released.`)
}

const findSeat = (role) => openCoord({ role, all: true }).find((i) => labelsOf(i).includes('role-seat'))

function createSeat(role) {
  const body = `The seat for **${role}**. Whoever holds the role comments HOLDER here; each handoff is a HANDOFF comment. See knowledge/conventions/session-coordination.md and coordination/ROLES.md.`
  const args = ['issue', 'create', '-R', repo(), '--title', `Seat: ${role}`, '--label', `coord,role-seat,role:${role}`]
  return Number(gh([...args, '--body-file', '-'], body).split('/').pop())
}

function takeSeat(role, number, v, session) {
  const notes = comments(number)
    .filter((c) => c.body.startsWith(MARK.handoff))
    .slice(-3)
  comment(number, `${MARK.holder} ${stamp(session)}${v.note ? `\n\n${v.note}` : ''}`)
  console.log(`You hold ${role} (#${number}). Last handoff notes:\n`)
  console.log(notes.length ? notes.map((c) => c.body).join('\n\n---\n\n') : '(none yet)')
  console.log(`\nOpen requests for you: node scripts/coord.mjs list --role ${role}`)
}

function leaveSeat(role, number, v, session) {
  if (!v.note) throw new Error('handoff needs --note: what is in flight, what is next, what to watch.')
  comment(number, `${MARK.handoff} ${stamp(session)}\n\n${v.note}`)
  comment(number, `${MARK.holder} vacant`)
  console.log(`Seat ${role} is vacant, notes left on #${number}.`)
}

function seat(action, role, v, session) {
  if (!role) throw new Error('seat needs a role id.')
  if (action === 'init') return console.log(`Seat ${role} is #${findSeat(role)?.number ?? createSeat(role)}.`)
  if (action !== 'take' && action !== 'handoff') throw new Error(`Unknown seat action: ${action}`)
  // Taking a role creates its seat the first time; handing off needs one that exists.
  const number = findSeat(role)?.number ?? (action === 'take' ? createSeat(role) : null)
  if (!number) throw new Error(`No seat for ${role}: it is created when a session first takes the role.`)
  return (action === 'take' ? takeSeat : leaveSeat)(role, number, v, session)
}

// Role proposals: the PM recommends a role, the user approves, defers or denies it. Nothing is created silently.
function proposalPost(v, session) {
  if (!v.role || !v.title || !v.body) throw new Error('proposal post needs --role, --title and --body.')
  const body = `Proposed role: **${v.role}** — ${v.title}\n\n${v.body}\n\nThe user decides: approve, defer or deny. ${stamp(session)}`
  const args = ['issue', 'create', '-R', repo(), '--title', `Role proposal: ${v.role}`, '--label', 'coord,role-proposal']
  console.log(gh([...args, '--body-file', '-'], body))
}

function proposalDecide(n, v, session) {
  if (!Number.isInteger(n) || n < 1) throw new Error('proposal decide needs the issue number.')
  if (!DECISIONS.includes(v.as)) throw new Error(`proposal decide needs --as ${DECISIONS.join('|')}.`)
  comment(n, `${MARK.decision} ${v.as}\n${stamp(session)}${v.note ? `\n\n${v.note}` : ''}`)
  if (v.as === 'approve') gh(['issue', 'close', String(n), '-R', repo()])
  console.log(`#${n}: ${v.as}${v.as === 'approve' ? ' (closed). Now add the role to ROLES.md and run: seat init <role>' : ''}.`)
}

function proposals() {
  const rows = api('issues?state=all&labels=role-proposal&per_page=100').filter((i) => !i.pull_request)
  if (!rows.length) return console.log('No role proposals.')
  for (const i of rows) {
    const last = [...comments(i.number)].reverse().find((c) => c.body.startsWith(MARK.decision))
    const state = last ? last.body.split('\n')[0].slice(MARK.decision.length).trim() : 'waiting for the user'
    console.log(`#${i.number}  ${state}  ${i.title}`)
  }
}

const TOPIC_BODY = `**Goal.**

**Roles.**

**Decisions.** (ask the user one question per comment, starting "Decision needed:"; record each answer in a comment starting "Decided:")

**Done.**

**Waiting on.**

Session: SESSION`

function topicOpen(name, session) {
  if (!name) throw new Error('topic open needs a name: topic open "<name>".')
  try {
    gh(['label', 'create', 'topic', '-R', repo(), '--color', '5319e7', '--description', 'A topic session'])
  } catch {} // already there
  const args = ['issue', 'create', '-R', repo(), '--title', `Topic: ${name}`, '--label', 'topic,coord', '--body-file', '-']
  const body = TOPIC_BODY.replace('SESSION', sessionIdFromPath(process.cwd()) ?? session)
  console.log(Number(gh(args, body).split('/').pop()))
}

/** "infra 1 claimed/0 unclaimed, api 0 claimed/2 unclaimed" for the open requests that carry a topic. */
function workByRole(work) {
  const byRole = new Map()
  for (const i of work) {
    const role = roleOf(i) ?? '?'
    const state = byRole.get(role) ?? { claimed: 0, open: 0 }
    state[labelsOf(i).includes('claimed') ? 'claimed' : 'open']++
    byRole.set(role, state)
  }
  return [...byRole].map(([r, c]) => `${r} ${c.claimed} claimed/${c.open} unclaimed`).join(', ') || 'no open requests'
}

function topics() {
  const topicIssues = api('issues?state=open&labels=topic&per_page=100').filter((i) => !i.pull_request)
  if (!topicIssues.length) return console.log('No open topics.')
  const requests = api('issues?state=open&labels=coord&per_page=100').filter(
    (i) => !i.pull_request && !labelsOf(i).includes('topic') && !labelsOf(i).includes('role-seat'),
  )
  for (const t of topicIssues) {
    const roles = workByRole(requests.filter((i) => topicOf(i.body) === t.number))
    const asks = openQuestions(comments(t.number))
    console.log(
      `#${t.number}  ${topicName(t.title)}  [${topicSession(t.body) ?? 'no session'}]  ${roles}${asks ? `  ASKS THE USER (${asks})` : ''}`,
    )
  }
}

const readDoc = (name) => readFileSync(resolve(mainCheckout(), 'coordination', name), 'utf8')

function whoami(v) {
  const id = v.id ?? sessionIdFromPath(process.cwd())
  if (!id) throw new Error('This folder is not a bridge-cse_<id> worktree. Give the id: whoami --id session_<id>.')
  const roster = readDoc('ROSTER.md')
  const found = sessionRow(roster, id)
  if (!found) {
    const pm = roster.split('\n').find((l) => l.startsWith('| `pm` |'))?.match(/session_[A-Za-z0-9]+/)?.[0]
    return console.log(
      `${id} is not listed in coordination/ROSTER.md.\nMessage the PM${pm ? ` (${pm})` : ''} with this id and ask what role you hold.`,
    )
  }
  if (!found.role) return console.log(`${id} holds no seat. Its row in ROSTER.md:\n${found.row}`)
  console.log(
    `You are ${id}, role ${found.role}.\n\nROSTER.md: ${found.row}\n\nROLES.md: ${roleRow(readDoc('ROLES.md'), found.role) ?? '(no row)'}`,
  )
  const seat = findSeat(found.role)
  if (!seat) return console.log(`\nNo seat issue for ${found.role} yet.`)
  const checkpoint = latestCheckpoint(comments(seat.number))
  console.log(
    `\nSeat #${seat.number}. ${checkpoint ? `Latest checkpoint:\n\n${checkpoint.body}` : 'No checkpoint comment yet.'}`,
  )
  console.log(`\nNext: git log origin/main, then node scripts/coord.mjs list --role ${found.role}`)
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      id: { type: 'string' },
      role: { type: 'string' },
      to: { type: 'string' },
      from: { type: 'string' },
      as: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      refs: { type: 'string' },
      note: { type: 'string' },
      session: { type: 'string' },
      all: { type: 'boolean' },
      topic: { type: 'string' },
    },
  })
  repoOverride = values.repo
  const [cmd, a, b] = positionals
  const session = values.session ?? basename(process.cwd())
  const n = Number(a)
  switch (cmd) {
    case 'roles':
      return roles()
    case 'list':
      return list(values)
    case 'post':
      return post(values)
    case 'claim':
      return claim(n, values, session)
    case 'release':
      return release(n, values, session, false)
    case 'done':
      return release(n, values, session, true)
    case 'comment':
      return commentAndConfirm(n, `${values.body}\n\n— ${stamp(session)}`)
    case 'seat':
      return seat(a, b, values, session)
    case 'proposal':
      if (a === 'post') return proposalPost(values, session)
      if (a === 'decide') return proposalDecide(Number(b), values, session)
      throw new Error('Usage: proposal post | proposal decide <n>')
    case 'proposals':
      return proposals()
    case 'whoami':
      return whoami(values)
    case 'topic':
      if (a !== 'open') throw new Error('Usage: topic open "<name>"')
      return topicOpen(b, session)
    case 'topics':
      return topics()
    default:
      throw new Error(
        'Usage: coord.mjs roles | list | post | claim | release | done | comment | seat | proposal | proposals | whoami | topic | topics (see the file header).',
      )
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

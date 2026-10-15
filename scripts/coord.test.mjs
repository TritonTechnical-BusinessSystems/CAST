import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  claimWinner,
  hoursSince,
  latestCheckpoint,
  openQuestions,
  parseRepoUrl,
  parseRolesTable,
  roleRow,
  sessionIdFromPath,
  sessionRow,
  topicLine,
  topicName,
  topicOf,
  topicSession,
} from './coord.mjs'

const c = (...bodies) => bodies.map((body) => ({ body }))

test('the earliest claim wins', () => {
  assert.equal(claimWinner(c('CLAIM frontend\nx', 'CLAIM backend\ny')), 'frontend')
})

test('a release by the holder frees the claim for the next one', () => {
  assert.equal(claimWinner(c('CLAIM frontend', 'RELEASE frontend', 'CLAIM backend')), 'backend')
})

test('a release by someone else changes nothing', () => {
  assert.equal(claimWinner(c('CLAIM frontend', 'RELEASE backend')), 'frontend')
})

test('no claim comments means no holder; other comments are ignored', () => {
  assert.equal(claimWinner(c('looks good', 'HANDOFF x')), null)
})

test('hoursSince counts hours', () => {
  assert.equal(hoursSince('2026-10-12T00:00:00Z', Date.parse('2026-10-14T00:00:00Z')), 48)
})

test('repo url: https, with and without .git', () => {
  assert.equal(parseRepoUrl('https://github.com/acme/widgets.git'), 'acme/widgets')
  assert.equal(parseRepoUrl('https://github.com/acme/widgets'), 'acme/widgets')
  assert.equal(parseRepoUrl('https://user:tok@github.com/acme/widgets.git\n'), 'acme/widgets')
})

test('repo url: ssh, including a host alias', () => {
  assert.equal(parseRepoUrl('git@github.com:acme/widgets.git'), 'acme/widgets')
  assert.equal(parseRepoUrl('git@github.com-widgets:acme/widgets.git'), 'acme/widgets')
  assert.equal(parseRepoUrl('ssh://git@github.com:443/acme/widgets.git'), 'acme/widgets')
})

test('repo url: nonsense is null', () => {
  assert.equal(parseRepoUrl('not a url'), null)
})

test('roles table: first-column backticked ids only', () => {
  const md = [
    '| id | owns | notes |',
    '|---|---|---|',
    '| `pm` | no code | x |',
    '| `design-system` | tokens | y |',
    'plain text | `nope` | z',
    '| `pm` | duplicate | ignored |',
  ].join('\n')
  assert.deepEqual(parseRolesTable(md), ['pm', 'design-system'])
})

const ROSTER = [
  '| Role | Session id | Runs on | Job |',
  '|---|---|---|---|',
  '| `pm` | `session_01PMAA` | server | Keeps the picture |',
  '| `backend` | `session_01BACK` (replaced session_01OLD1) | server | The API |',
  '| spare | `session_01SPAR` | server | Idle |',
].join('\n')

test('a worktree path names its session id, from any folder inside it', () => {
  const dir = '/work/project/.claude/worktrees/bridge-cse_01ABC'
  assert.equal(sessionIdFromPath(dir), 'session_01ABC')
  assert.equal(sessionIdFromPath(`${dir}/src/api`), 'session_01ABC')
  assert.equal(sessionIdFromPath('/work/project'), null)
  assert.equal(sessionIdFromPath('/x/not-bridge-cse_abc'), null)
})

test('the roster row of a seat holder gives the role; a replaced session is not the holder', () => {
  assert.equal(sessionRow(ROSTER, 'session_01PMAA')?.role, 'pm')
  assert.equal(sessionRow(ROSTER, 'session_01BACK')?.role, 'backend')
  assert.equal(sessionRow(ROSTER, 'session_01OLD1'), null)
  assert.equal(sessionRow(ROSTER, 'session_01SPAR')?.role, null)
  assert.equal(sessionRow(ROSTER, 'session_01NONE'), null)
})

test('the role row of ROLES.md is the first row led by the backticked id', () => {
  const roles = '| id | owns |\n|---|---|\n| `pm` | coordination |\n| `backend` | server |'
  assert.equal(roleRow(roles, 'backend'), '| `backend` | server |')
  assert.equal(roleRow(roles, 'qa'), null)
})

test('the latest checkpoint is the newest CHECKPOINT comment', () => {
  assert.equal(latestCheckpoint(c('HANDOFF a', 'CHECKPOINT one', 'note', 'CHECKPOINT two'))?.body, 'CHECKPOINT two')
  assert.equal(latestCheckpoint(c('HANDOFF a')), null)
})

test('topicOf finds topic#<n> in refs or a body, else null', () => {
  assert.equal(topicOf('INIT-0063 topic#12'), 12)
  assert.equal(topicOf('From role: **pm**\nRefs: topic#7\n\nbody'), 7)
  assert.equal(topicOf('no topic here'), null)
  assert.equal(topicOf(undefined), null)
})

test('topicLine, topicName and topicSession', () => {
  assert.equal(topicLine('Claimed', 5, 'infra', 'Do it'), 'Claimed #5 (infra): Do it')
  assert.equal(topicName('Topic: Launch'), 'Launch')
  assert.equal(topicSession('**Goal.**\n\nSession: session_abc'), 'session_abc')
  assert.equal(topicSession('Session: '), null)
})

test('openQuestions counts Decision needed minus Decided, never below zero', () => {
  assert.equal(openQuestions(c('Decision needed: a?', 'Decision needed: b?', 'Decided: a')), 1)
  assert.equal(openQuestions(c('Decided: a')), 0)
  assert.equal(openQuestions(c('chatter')), 0)
})

import { sessionsApi, type RecentProject } from '../api/sessions'
import type { SessionListItem } from '../types/session'
import { basenameForDisplay } from './pathDisplay'

const CACHE_TTL = 300_000

type RecentProjectsCache = {
  projects: RecentProject[]
  coverage: number
  timestamp: number
}

let cache: RecentProjectsCache | null = null
let cacheGeneration = 0
const pendingRequests = new Map<number, {
  generation: number
  promise: Promise<RecentProject[]>
}>()

function mergeProject(current: RecentProject, incoming: RecentProject): RecentProject {
  return {
    projectPath: incoming.projectPath || current.projectPath,
    realPath: incoming.realPath || current.realPath,
    projectName: incoming.projectName || current.projectName,
    isGit: current.isGit || incoming.isGit,
    repoName: incoming.repoName ?? current.repoName,
    branch: incoming.branch ?? current.branch,
    modifiedAt: incoming.modifiedAt > current.modifiedAt
      ? incoming.modifiedAt
      : current.modifiedAt,
    sessionCount: Math.max(current.sessionCount, incoming.sessionCount),
  }
}

export function mergeRecentProjects(
  sources: RecentProject[][],
  limit = Number.MAX_SAFE_INTEGER,
): RecentProject[] {
  const projectsByPath = new Map<string, RecentProject>()

  for (const projects of sources) {
    for (const project of projects) {
      const existing = projectsByPath.get(project.realPath)
      projectsByPath.set(
        project.realPath,
        existing ? mergeProject(existing, project) : project,
      )
    }
  }

  return [...projectsByPath.values()]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit)
}

export function recentProjectsFromSessions(
  sessions: SessionListItem[],
  limit = Number.MAX_SAFE_INTEGER,
): RecentProject[] {
  const projectsByPath = new Map<string, RecentProject>()

  for (const session of sessions) {
    if (session.isTemporary || !session.workDirExists || !session.workDir) continue

    const existing = projectsByPath.get(session.workDir)
    const project: RecentProject = {
      projectPath: session.projectPath,
      realPath: session.workDir,
      projectName: basenameForDisplay(session.workDir),
      isGit: false,
      repoName: null,
      branch: null,
      modifiedAt: session.modifiedAt,
      sessionCount: 1,
    }

    if (!existing) {
      projectsByPath.set(session.workDir, project)
      continue
    }

    projectsByPath.set(session.workDir, {
      ...existing,
      projectPath: session.modifiedAt > existing.modifiedAt
        ? session.projectPath
        : existing.projectPath,
      modifiedAt: session.modifiedAt > existing.modifiedAt
        ? session.modifiedAt
        : existing.modifiedAt,
      sessionCount: existing.sessionCount + 1,
    })
  }

  return [...projectsByPath.values()]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit)
}

export function peekRecentProjects(limit = Number.MAX_SAFE_INTEGER): RecentProject[] {
  return cache?.projects.slice(0, limit) ?? []
}

export function invalidateRecentProjectsCache(): void {
  cache = null
  cacheGeneration += 1
  pendingRequests.clear()
}

export function loadRecentProjects(limit: number): Promise<RecentProject[]> {
  const normalizedLimit = Math.max(1, Math.floor(limit))
  const now = Date.now()
  if (
    cache &&
    now - cache.timestamp < CACHE_TTL &&
    cache.coverage >= normalizedLimit
  ) {
    return Promise.resolve(cache.projects.slice(0, normalizedLimit))
  }

  for (const [pendingLimit, pending] of pendingRequests) {
    if (pending.generation === cacheGeneration && pendingLimit >= normalizedLimit) {
      return pending.promise.then((projects) => projects.slice(0, normalizedLimit))
    }
  }

  const generation = cacheGeneration
  let request: Promise<RecentProject[]>
  request = sessionsApi.getRecentProjects(normalizedLimit)
    .then(({ projects }) => {
      if (generation !== cacheGeneration) return projects.slice(0, normalizedLimit)
      const cachedProjects = cache?.projects ?? []
      const isComplete = projects.length < normalizedLimit
      const coverage = isComplete
        ? Number.MAX_SAFE_INTEGER
        : Math.max(cache?.coverage ?? 0, normalizedLimit)
      const merged = isComplete
        ? projects
        : mergeRecentProjects([cachedProjects, projects])
      cache = {
        projects: merged,
        coverage,
        timestamp: Date.now(),
      }
      return merged.slice(0, normalizedLimit)
    })
    .catch(() => cache?.projects.slice(0, normalizedLimit) ?? [])
    .finally(() => {
      if (pendingRequests.get(normalizedLimit)?.promise === request) {
        pendingRequests.delete(normalizedLimit)
      }
    })

  pendingRequests.set(normalizedLimit, { generation, promise: request })
  return request
}

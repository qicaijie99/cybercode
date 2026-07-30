import { ApiError } from '../middleware/errorHandler.js'
import { sessionService } from '../services/sessionService.js'
import {
  GitWorkspaceError,
  gitWorkspaceService,
  type GitDiffScope,
} from '../services/gitWorkspaceService.js'

function projectPath(url: URL): string | undefined {
  return url.searchParams.get('projectPath') || undefined
}

async function requestBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Body must be an object')
    }
    return body as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function rethrowGitError(error: unknown): never {
  if (!(error instanceof GitWorkspaceError)) throw error
  if (error.code === 'INVALID_PATH' || error.code === 'INVALID_OPERATION') {
    throw ApiError.badRequest(error.message)
  }
  if (error.code === 'NOT_REPOSITORY' || error.code === 'GIT_COMMAND_FAILED') {
    throw ApiError.conflict(error.message)
  }
  throw ApiError.internal(error.message)
}

export async function handleSessionGitApi(
  req: Request,
  url: URL,
  sessionId: string,
  action?: string,
): Promise<Response> {
  const workDir = await sessionService.getSessionWorkDir(sessionId, {
    projectPath: projectPath(url),
  })
  if (!workDir) throw ApiError.notFound(`Session not found: ${sessionId}`)

  try {
    if (!action && req.method === 'GET') {
      return Response.json(await gitWorkspaceService.getStatus(workDir))
    }

    if (action === 'diff' && req.method === 'GET') {
      const scope = url.searchParams.get('scope')
      const filePath = url.searchParams.get('path')
      if ((scope !== 'staged' && scope !== 'unstaged') || !filePath) {
        throw ApiError.badRequest('scope and path are required')
      }
      return Response.json(
        await gitWorkspaceService.getDiff(workDir, scope as GitDiffScope, filePath),
      )
    }

    if (action === 'branches' && req.method === 'GET') {
      return Response.json({
        branches: await gitWorkspaceService.listBranches(workDir),
      })
    }

    if (action === 'history' && req.method === 'GET') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '40', 10)
      return Response.json({
        commits: await gitWorkspaceService.listHistory(workDir, limit),
      })
    }

    if (req.method !== 'POST') {
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
        { status: 405 },
      )
    }

    if (action === 'init') {
      return Response.json(await gitWorkspaceService.initialize(workDir))
    }

    const body = await requestBody(req)
    if (action === 'stage') {
      return Response.json(await gitWorkspaceService.stage(workDir, body.paths))
    }
    if (action === 'unstage') {
      return Response.json(await gitWorkspaceService.unstage(workDir, body.paths))
    }
    if (action === 'discard') {
      return Response.json(await gitWorkspaceService.discard(workDir, body.paths))
    }
    if (action === 'commit') {
      return Response.json(await gitWorkspaceService.commit(workDir, body.message))
    }
    if (action === 'switch-branch') {
      return Response.json(await gitWorkspaceService.switchBranch(workDir, body.name))
    }
    if (action === 'create-branch') {
      return Response.json(await gitWorkspaceService.createBranch(workDir, body.name))
    }

    return Response.json(
      { error: 'NOT_FOUND', message: `Unknown Git action: ${action || ''}` },
      { status: 404 },
    )
  } catch (error) {
    rethrowGitError(error)
  }
}

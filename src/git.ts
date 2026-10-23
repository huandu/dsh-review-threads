import type { Context } from '@deepseek-ai/cordis'
import { realpath } from 'node:fs/promises'
import { normalizeRemoteUrl } from './scope.js'

const MAX_OUTPUT_BYTES = 1024 * 1024
const GRACE_MS = 2_000

export interface GitResult {
  readonly stdout: string
  readonly exitCode: number | null
  readonly truncated: boolean
}

export class GitRunner {
  private executable: Promise<string> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly signal: AbortSignal,
  ) {}

  private binary(): Promise<string> {
    this.executable ??= this.ctx.subprocess.resolveExecutable(
      'git',
      undefined,
      this.signal,
    )
    return this.executable
  }

  async run(cwd: string, args: readonly string[]): Promise<GitResult> {
    const git = await this.binary()
    const handle = this.ctx.subprocess.spawn({
      argv: [git, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_OUTPUT_BYTES },
      },
      graceMs: GRACE_MS,
      signal: this.signal,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
      },
    })
    const outcome = await handle.done
    const output = handle.collected.stdout?.readFrom(0)
    return {
      stdout: output?.text ?? '',
      exitCode: outcome.exitCode,
      truncated: output?.lossy ?? false,
    }
  }

  async require(cwd: string, args: readonly string[]): Promise<string> {
    const result = await this.run(cwd, args)
    if (result.exitCode !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed with exit code ${String(result.exitCode)}`,
      )
    }
    return result.stdout.trim()
  }
}

export interface RepositoryIdentity {
  readonly identity: string
  readonly root: string
  readonly commonDir: string
  readonly headOid: string | null
}

export async function resolveRepositoryIdentity(
  git: GitRunner,
  cwd: string,
): Promise<RepositoryIdentity | undefined> {
  const rootResult = await git.run(cwd, ['rev-parse', '--show-toplevel'])
  if (rootResult.exitCode !== 0) return undefined
  const root = await realpath(rootResult.stdout.trim())
  const commonResult = await git.run(root, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  if (commonResult.exitCode !== 0) return undefined
  const commonDir = await realpath(commonResult.stdout.trim())
  const remoteResult = await git.run(root, [
    'config',
    '--get',
    'remote.origin.url',
  ])
  const headResult = await git.run(root, ['rev-parse', '--verify', 'HEAD'])
  const remote =
    remoteResult.exitCode === 0 && remoteResult.stdout.trim().length > 0
      ? normalizeRemoteUrl(remoteResult.stdout)
      : undefined
  return {
    identity: remote === undefined ? `path:${commonDir}` : `remote:${remote}`,
    root,
    commonDir,
    headOid: headResult.exitCode === 0 ? headResult.stdout.trim() : null,
  }
}

export async function resolveCommit(
  git: GitRunner,
  cwd: string,
  revision: string,
): Promise<string> {
  return git.require(cwd, ['rev-parse', '--verify', `${revision}^{commit}`])
}

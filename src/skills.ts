import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function withoutFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown
  const end = markdown.indexOf('\n---\n', 4)
  return end === -1 ? markdown : markdown.slice(end + 5)
}

export async function registerReviewSkill(ctx: Context): Promise<void> {
  const path = fileURLToPath(
    new URL('../skills/dsh-review-threads/SKILL.md', import.meta.url),
  )
  const content = withoutFrontmatter(await readFile(path, 'utf8'))
  const directory = dirname(resolve(path))
  ctx.effect(
    () =>
      ctx.skills.register({
        name: 'dsh-review-threads',
        description:
          'Use line-level review threads for diff review, AI questions, and submitted review feedback.',
        content,
        source: 'bundled',
        provider: 'dsh-review-threads',
        path,
        resourceBase: { kind: 'directory', path: directory },
        invocation: { modelInvocable: true, userInvocable: true },
      }),
    'dsh-review-threads: bundled skill',
  )
}

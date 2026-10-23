export type ReviewCommand =
  | { readonly kind: 'working' }
  | {
      readonly kind: 'revision'
      readonly range: string
      readonly pathFilters: readonly string[]
    }
  | {
      readonly kind: 'bind'
      readonly range: string
      readonly pathFilters: readonly string[]
    }

const RANGE = /^(\S+)(\.\.\.?)(\S+)$/u

export function parseReviewCommand(input: string): ReviewCommand {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { kind: 'working' }
  const bind = trimmed.startsWith('bind ')
  const commandInput = bind ? trimmed.slice('bind '.length).trim() : trimmed
  const [rangePart, pathPart] = commandInput.split(/\s+--\s*/u, 2)
  const range = rangePart?.trim() ?? ''
  if (!RANGE.test(range)) {
    throw new Error('Expected /review <base>..<head> [-- <paths...>]')
  }
  const pathFilters =
    pathPart === undefined
      ? []
      : pathPart
          .split(/\s+/u)
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
  if (
    pathFilters.length > 200 ||
    pathFilters.some(
      (path) =>
        path.startsWith('/') ||
        path.startsWith('-') ||
        /[\0\r\n]/u.test(path) ||
        path.length > 4096,
    )
  ) {
    throw new Error('Invalid review path filter')
  }
  return { kind: bind ? 'bind' : 'revision', range, pathFilters }
}

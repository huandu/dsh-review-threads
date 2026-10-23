import type {} from '@deepseek-ai/dsh-llm'
import type { ReviewThreadService } from './service.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    reviewThreads: ReviewThreadService
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-review-threads': {
      readonly kind: 'dsh-review-threads'
      readonly form: 'notice'
      readonly summary: string
    }
  }
}

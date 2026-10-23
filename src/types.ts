import type { ReviewThreadService } from './service.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    reviewThreads: ReviewThreadService
  }
}

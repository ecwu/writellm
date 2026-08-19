import { GoogleGenAI } from '@google/genai'

export interface GoogleVertexModels {
  generateContent(input: {
    model: string
    contents: string
    config: {
      abortSignal: AbortSignal
      candidateCount: 1
      responseModalities: ['TEXT', 'IMAGE']
      imageConfig: { aspectRatio?: string; imageSize: '1K' | '2K' }
    }
  }): Promise<unknown>
  countTokens(input: {
    model: string
    contents: string
    config?: { abortSignal: AbortSignal }
  }): Promise<unknown>
}

export type GoogleVertexClientFactory = (input: {
  project: string
  location: 'global'
}) => GoogleVertexModels

export const createGoogleVertexClient: GoogleVertexClientFactory = ({ project, location }) => {
  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location
  })
  return client.models as GoogleVertexModels
}

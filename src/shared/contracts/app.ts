import { z } from 'zod'

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1)
})

export type AppInfo = z.infer<typeof appInfoSchema>

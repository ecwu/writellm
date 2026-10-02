export class Headers {
  constructor() {
    throw new Error('Network access is unavailable in the LaTeX import worker')
  }
}

const deniedFetch = Object.assign(
  (): never => {
    throw new Error('Network access is unavailable in the LaTeX import worker')
  },
  { Headers }
)

export default deniedFetch

export const fetchFile = deniedFetch
export async function fetchFileAsync(): Promise<never> {
  return deniedFetch()
}
export const setUserAgent = deniedFetch

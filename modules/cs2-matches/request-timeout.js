export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30
export const MIN_REQUEST_TIMEOUT_SECONDS = 5
export const MAX_REQUEST_TIMEOUT_SECONDS = 120

export function requestTimeoutSeconds(value) {
  return Number.isInteger(value) && value >= MIN_REQUEST_TIMEOUT_SECONDS && value <= MAX_REQUEST_TIMEOUT_SECONDS
    ? value : DEFAULT_REQUEST_TIMEOUT_SECONDS
}

export function requestTimeoutMs(settings) {
  return requestTimeoutSeconds(settings?.requestTimeoutSeconds) * 1000
}

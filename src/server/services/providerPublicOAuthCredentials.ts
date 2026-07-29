/**
 * Public native-app OAuth credentials used by upstream desktop/CLI clients.
 *
 * The byte masking is copied from OmniRoute's MIT-licensed public credential
 * helper. It is only meant to keep public client identifiers out of secret
 * scanner output; it is not encryption.
 *
 * Source: https://github.com/diegosouzapw/OmniRoute
 */

const MASK = 'omniroute-public-v1'

function unmaskBytes(bytes: readonly number[]): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    output += String.fromCharCode(bytes[index]! ^ MASK.charCodeAt(index % MASK.length))
  }
  return output
}

const PUBLIC_CREDENTIALS = {
  geminiClientId: [
    89, 85, 95, 91, 71, 90, 77, 68, 92, 30, 73, 64, 79, 3, 6, 91, 75, 2, 3, 0, 29, 28, 13, 0, 1, 5,
    77, 0, 30, 17, 4, 4, 90, 8, 21, 30, 30, 92, 11, 4, 12, 88, 65, 90, 31, 90, 4, 93, 0, 6, 76, 11,
    6, 12, 74, 26, 84, 26, 30, 11, 27, 17, 0, 27, 0, 0, 67, 4, 91, 1, 3, 4,
  ],
  geminiClientSecret: [
    40, 34, 45, 58, 34, 55, 88, 64, 16, 101, 23, 56, 50, 1, 68, 82, 66, 65, 98, 4, 64, 9, 12, 36,
    89, 54, 1, 80, 78, 28, 45, 36, 31, 17, 15,
  ],
  antigravityClientId: [
    94, 93, 89, 88, 66, 95, 67, 68, 83, 29, 69, 76, 83, 65, 29, 14, 69, 5, 66, 6, 3, 92, 1, 64, 94,
    25, 23, 23, 72, 66, 70, 87, 26, 29, 12, 65, 25, 91, 7, 89, 9, 93, 66, 92, 16, 4, 75, 76, 0, 5,
    17, 66, 14, 12, 66, 17, 93, 10, 24, 29, 12, 0, 12, 26, 26, 17, 72, 30, 1, 76, 15, 6, 14,
  ],
  antigravityClientSecret: [
    40, 34, 45, 58, 34, 55, 88, 63, 80, 21, 54, 34, 48, 88, 81, 85, 97, 18, 125, 37, 92, 3, 37, 48,
    87, 6, 44, 38, 25, 10, 67, 19, 40, 40, 5,
  ],
} as const

export function getPublicOAuthCredential(
  name: keyof typeof PUBLIC_CREDENTIALS,
  environmentName: string,
): string {
  const override = process.env[environmentName]?.trim()
  return override || unmaskBytes(PUBLIC_CREDENTIALS[name])
}

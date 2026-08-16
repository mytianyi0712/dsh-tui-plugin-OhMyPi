declare module 'qrcode-terminal' {
  export interface GenerateOptions {
    small?: boolean
  }
  export function generate(text: string, options: GenerateOptions, callback: (qr: string) => void): void
  const qrcodeTerminal: {
    generate: typeof generate
  }
  export default qrcodeTerminal
}

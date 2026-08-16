/**
 * Terminal-safe text helpers. Untrusted session/tool text must never emit
 * terminal control sequences into pi-tui's differential renderer.
 */

/** Remove ANSI/C1 controls while retaining the printable payload around them. */
function stripTerminalControls(text: string): string {
  let output = ''
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)

    // ESC-prefixed CSI: parameters/intermediates followed by a final byte.
    if (code === 0x1b && text.charCodeAt(index + 1) === 0x5b) {
      index += 2
      while (index < text.length) {
        const current = text.charCodeAt(index++)
        if (current >= 0x40 && current <= 0x7e) break
      }
      continue
    }

    // OSC, DCS, SOS, PM and APC strings end at BEL, C1 ST, or ESC + backslash.
    const next = text.charCodeAt(index + 1)
    const escapeString = code === 0x1b
      && (next === 0x5d || next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f)
    const c1String = code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f
    if (escapeString || c1String) {
      index += escapeString ? 2 : 1
      while (index < text.length) {
        const current = text.charCodeAt(index)
        if (current === 0x07 || current === 0x9c) {
          index++
          break
        }
        if (current === 0x1b && text.charCodeAt(index + 1) === 0x5c) {
          index += 2
          break
        }
        index++
      }
      continue
    }

    // Eight-bit CSI uses the same final-byte grammar without an ESC prefix.
    if (code === 0x9b) {
      index++
      while (index < text.length) {
        const current = text.charCodeAt(index++)
        if (current >= 0x40 && current <= 0x7e) break
      }
      continue
    }

    // Remaining ESC sequences are Fe/Fs/Fp controls. Consume intermediate
    // bytes as well, so charset sequences such as ESC ( 0 cannot leak `0`.
    if (code === 0x1b) {
      index++
      if (index < text.length) {
        const first = text.charCodeAt(index)
        if (first >= 0x20 && first <= 0x2f) {
          index++
          while (index < text.length) {
            const current = text.charCodeAt(index++)
            if (current >= 0x30 && current <= 0x7e) break
          }
        } else if (first >= 0x30 && first <= 0x7e) {
          index++
        }
      }
      continue
    }
    if (code === 0x0a) {
      output += '\n'
    } else if (code === 0x09) {
      // pi-tui measures tabs as three cells; materialize them so the terminal
      // cannot advance to a wider hardware tab stop and overwrite the frame.
      output += '   '
    } else if (code > 0x1f && code !== 0x7f && (code < 0x80 || code > 0x9f)) {
      output += text[index]
    }
    index++
  }
  return output
}

/** Normalize line endings and make arbitrary text safe for terminal rendering. */
export function displayText(text: string): string {
  return stripTerminalControls(text.replace(/\r\n?/g, '\n'))
}

/** Collapse multiline terminal-safe text into one display row. */
export function displayInlineText(text: string): string {
  return displayText(text).replace(/\n/g, ' ')
}

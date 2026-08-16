// dsh/renderer.ts — 登录二维码的终端渲染。
//
// 二维码通过 runtime 的输出通道发布：TUI 订阅后作为 transcript 中的持久化
// 文本显示（不会被差分渲染覆盖或自动消失），无 TUI 时回退 stderr；同时始终
// 写入 login-qr.txt 供无界面场景查看。

import qrcodeTerminal from 'qrcode-terminal'
import { writeLoginQrFile } from '../core/state.ts'
import { log, publishOutput } from '../core/runtime.ts'

/** 去除 ANSI 转义序列（qrcode-terminal 默认输出彩色码）。 */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/** 把登录 URL 渲染为纯文本二维码（失败时回退为 URL 本身）。 */
export function renderQr(url: string): string {
  let out = ''
  try {
    qrcodeTerminal.generate(url, { small: true }, (qr: string) => {
      out = qr
    })
  } catch {
    // fall back to URL only
  }
  return stripAnsi(out || url)
}

/**
 * 展示二维码：落盘 login-qr.txt，并作为持久化输出发布到 TUI（或回退 stderr）。
 */
export function showQr(url: string): void {
  const qr = renderQr(url)
  const file = writeLoginQrFile(qr)
  publishOutput({ kind: 'qr', text: qr })
  log(`微信登录二维码已生成，备用链接: ${url}`)
  log(`二维码文本已写入: ${file}`)
}

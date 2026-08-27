// dsh/status.ts — 微信桥持久状态行内容：连接情况 + 接收锁归属。
// TUI 订阅后把这条状态显示在固定占位行；普通运行日志不会进入 TUI。

import { loadAccounts } from '../core/state.ts'
import { getMonitor } from '../core/monitors.ts'
import { isReceiverHeld, publishStatus } from '../core/runtime.ts'
import { receiverHolderPid } from '../core/receiver-lock.ts'

/** 汇总并发布当前微信桥状态。 */
export function publishWechatStatus(): void {
  const accounts = loadAccounts()
  const connected = accounts.filter((account) => getMonitor(account.id)?.getStatus().running === true).length
  const wechat = accounts.length === 0
    ? '微信: 未连接'
    : connected > 0
      ? `微信: 已连接（${connected}/${accounts.length}）`
      : '微信: 未连接'
  const lock = isReceiverHeld()
    ? '接收锁: 本进程持有'
    : `接收锁: pid ${receiverHolderPid() ?? '未知'}`
  publishStatus(`${wechat} · ${lock}`)
}
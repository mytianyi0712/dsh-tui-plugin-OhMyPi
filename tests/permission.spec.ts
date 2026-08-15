import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets'
import { createTranslator } from '../src/i18n.ts'
import {
  FULL_ACCESS_REGISTRY_NAME,
  FULL_ACCESS_UI_NAME,
  displayPermissionName,
  permissionCommandMetadata,
  registryPermissionName,
  type PermissionPresetSource,
} from '../src/permission.ts'

function source(options: readonly PresetOption[]): PermissionPresetSource {
  return {
    names: options.map(option => option.value),
    optionOf: name => {
      const option = options.find(candidate => candidate.value === name)
      if (option === undefined) throw new Error(`unknown preset: ${name}`)
      return option
    },
  }
}

describe('permission command metadata', () => {
  it('advertises every configured permission mode in the argument hint', () => {
    const metadata = permissionCommandMetadata(source([
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
    ]), createTranslator('zh-CN'))

    assert.equal(
      metadata.argumentHint,
      '<read-only|workspace-write|full-access>',
    )
    assert.deepEqual(metadata.options.map(option => [option.value, option.label]), [
      ['read-only', 'read-only — 只读'],
      ['workspace-write', 'workspace-write — 工作区写入'],
      ['full-access', 'full-access — 完全访问'],
    ])
    assert.match(metadata.options[1]!.description ?? '', /工作区与临时目录/)
  })

    it('maps the user-facing full-access name to the host registry value', () => {
      assert.equal(FULL_ACCESS_UI_NAME, 'full-access')
      assert.equal(FULL_ACCESS_REGISTRY_NAME, 'danger-full-access')
      assert.equal(displayPermissionName('danger-full-access'), 'full-access')
      assert.equal(displayPermissionName('read-only'), 'read-only')
      assert.equal(registryPermissionName('full-access'), 'danger-full-access')
      assert.equal(registryPermissionName('read-only'), 'read-only')
    })


  it('preserves configured presentation for deployment-specific presets', () => {
    const metadata = permissionCommandMetadata(source([
      { value: 'team-safe', name: '团队安全', description: '仅允许团队批准的目录。' },
    ]), createTranslator('zh-CN'))

    assert.equal(metadata.argumentHint, '<team-safe>')
    assert.deepEqual(metadata.options, [{
      value: 'team-safe',
      label: 'team-safe — 团队安全',
      description: '仅允许团队批准的目录。',
    }])
  })
})

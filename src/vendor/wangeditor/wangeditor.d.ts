// 源站 wangeditor chunk 的 repack 版（src/vendor/wangeditor/wangeditor.js）类型声明。
// 源站导出 `pge as n`（Editor 组件）/ `mge as t`（Toolbar 组件），此处按用法声明最小接口。
import type { CSSProperties, FC, ReactNode } from 'react'

/** wangeditor 编辑器实例（源站用法：getHtml / setHtml / destroy） */
export interface WangeditorEditor {
  getHtml(): string
  setHtml(html: string): void
  destroy(): void
}

export interface EditorProps {
  defaultConfig?: Record<string, unknown>
  mode?: 'simple' | 'default'
  onCreated?: (editor: WangeditorEditor) => void
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

export interface ToolbarProps {
  editor: WangeditorEditor | null
  defaultConfig?: Record<string, unknown>
  mode?: 'simple' | 'default'
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

/** 源站导出 `n` = Editor */
export const n: FC<EditorProps>
/** 源站导出 `t` = Toolbar */
export const t: FC<ToolbarProps>

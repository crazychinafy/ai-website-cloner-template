"use client"

// P5：ConfirmDialog 二次确认（Base UI Dialog；危险操作防误触）
// ─────────────────────────────────────────────────────────────────
// - 受控 open：父组件持有（危险操作先弹确认，再执行真实回调 onConfirm）
// - ESC 关闭 / 取消关闭 / 焦点管理（打开聚焦"取消"——安全默认；关闭返回触发元素）
// - loading（确认请求进行中）：双按钮禁用、忽略 ESC/取消（禁止重复点击）
// - 不使用浏览器原生 alert/confirm；确认回调必须由父组件传入真实逻辑

import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作模式（红色确认按钮） */
  danger?: boolean
  /** 确认请求进行中（禁用重复点击；期间忽略关闭） */
  loading?: boolean
  confirmDisabled?: boolean
  /** 打开时默认聚焦：cancel（安全默认）| confirm */
  defaultFocus?: "cancel" | "confirm"
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  loading = false,
  confirmDisabled = false,
  defaultFocus = "cancel",
  onConfirm,
}: Props) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)

  return (
    <Dialog.Root
      open={open}
      modal
      onOpenChange={(next, details) => {
        if (!next) {
          if (loading) {
            details.preventUnmountOnClose()
            return
          }
          onOpenChange(false)
        } else {
          onOpenChange(true)
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="adm-dialog-backdrop fixed inset-0 z-40 bg-foreground/40 animate-fade-in" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup
            ref={() => {
              // 打开后将焦点移到安全按钮（cancel），避免 Enter 误触确认
              const target = defaultFocus === "confirm" ? confirmRef.current : cancelRef.current
              if (target) target.focus()
            }}
            initialFocus={false}
            className={cn(
              "adm-dialog w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-2xl animate-scale-in",
              "focus:outline-none",
            )}
          >
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{description}</Dialog.Description>
            <div className="mt-6 flex flex-row-reverse gap-3">
              <button
                ref={confirmRef}
                type="button"
                disabled={loading || confirmDisabled}
                onClick={() => {
                  if (loading || confirmDisabled) return
                  onConfirm()
                }}
                className={cn(
                  "adm-touch-target inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
                  danger
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {loading ? "处理中…" : confirmLabel}
              </button>
              <Dialog.Close
                ref={cancelRef}
                disabled={loading}
                className={cn(
                  "adm-touch-target inline-flex h-9 items-center justify-center rounded-md border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors outline-none",
                  "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55",
                )}
              >
                {cancelLabel}
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

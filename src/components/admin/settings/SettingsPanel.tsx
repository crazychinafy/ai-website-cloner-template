"use client"

// P6D：站点设置面板（§11.5：分组卡片 + 逐组保存 + 恢复默认值 + 无 settings.update 只读）
// ─────────────────────────────────────────────────────────────────
// - 白名单 6 key（服务端唯一事实源）：网站基础信息 / 网站品牌（logo+favicon 带预览）/
//   页脚 / 广告设置（ads_random 布尔）
// - 每组「保存」只提交本组 key，逐项携带服务端最新 version（逐 key 乐观锁，单事务整批回滚）
// - 保存成功后用响应回填全部 key 的 version（未提交的组不会因为本次保存产生版本冲突）；
//   409 时后台重取最新 version（保留本地未保存文案），再次保存即可
// - 「恢复默认值」= 把 SITE_INFO 默认值填入表单（本地动作，不写库），保存后生效
// - 品牌图片禁外部链接；文件必须存在于站内静态目录，否则服务端 422 SETTINGS_MEDIA_MISSING
import * as React from "react"
import { RotateCcw } from "lucide-react"
import { adminGet, adminPatch } from "@/lib/admin/ui/api-client"
import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
  type SettingKey,
  type SettingsDto,
} from "@/lib/admin/dto/site-setting"
import { useToast } from "../feedback/ToastProvider"
import { FormField } from "../forms/FormField"
import { TextInput } from "../forms/TextInput"
import { TextareaField } from "../forms/TextareaField"
import { SelectField, type SelectOption } from "../forms/SelectField"
import { MediaPreview, RowAction } from "../content/content-ui"

interface Props {
  initial: SettingsDto
  csrfToken: string
  canUpdate: boolean
}

type Values = {
  site_name: string
  site_description: string
  site_logo: string
  site_favicon: string
  footer_text: string
  ads_random: boolean
}

type Versions = Record<SettingKey, number>

interface GroupDef {
  title: string
  description: string
  keys: SettingKey[]
}

const GROUPS: GroupDef[] = [
  { title: "网站基础信息", description: "站点名称与描述（site_name / site_description）", keys: ["site_name", "site_description"] },
  { title: "网站品牌", description: "Logo 与 Favicon：站内静态图片路径，禁外部链接", keys: ["site_logo", "site_favicon"] },
  { title: "页脚", description: "页脚展示文字（footer_text）", keys: ["footer_text"] },
  { title: "广告设置", description: "前台首页广告是否随机排序（ads_random）", keys: ["ads_random"] },
]

const ADS_RANDOM_OPTIONS: SelectOption[] = [
  { label: "开启（随机展示广告）", value: "true" },
  { label: "关闭（按排序值展示）", value: "false" },
]

function toValues(dto: SettingsDto): Values {
  return {
    site_name: String(dto.settings.site_name.value),
    site_description: String(dto.settings.site_description.value),
    site_logo: String(dto.settings.site_logo.value),
    site_favicon: String(dto.settings.site_favicon.value),
    footer_text: String(dto.settings.footer_text.value),
    ads_random: Boolean(dto.settings.ads_random.value),
  }
}

function toVersions(dto: SettingsDto): Versions {
  const out = {} as Versions
  for (const key of SETTING_KEYS) out[key] = dto.settings[key].version
  return out
}

export function SettingsPanel({ initial, csrfToken, canUpdate }: Props) {
  const { toast } = useToast()
  const [values, setValues] = React.useState<Values>(() => toValues(initial))
  const [versions, setVersions] = React.useState<Versions>(() => toVersions(initial))
  const [savingGroup, setSavingGroup] = React.useState<string | null>(null)
  /** 分组名 → 保存失败时服务端字段错误 + 说明 */
  const [groupErrors, setGroupErrors] = React.useState<Record<string, string[]>>({})

  function setValue<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  /** 重取服务端最新 version（保留本地未保存的输入）；用于 409 后解锁再次保存 */
  async function refreshVersions() {
    const res = await adminGet<SettingsDto>("/settings")
    if (res.ok) setVersions(toVersions(res.data))
  }

  async function saveGroup(group: GroupDef) {
    setSavingGroup(group.title)
    setGroupErrors((prev) => {
      const next = { ...prev }
      delete next[group.title]
      return next
    })
    const items = group.keys.map((key) => ({
      key,
      value: values[key] as string | boolean,
      version: versions[key],
    }))
    const res = await adminPatch<SettingsDto>("/settings", { items }, { csrfToken })
    setSavingGroup(null)
    if (res.ok) {
      // 响应含全部 6 个 key 的权威 version；值只回填本组（其余组保留未保存草稿）
      setVersions(toVersions(res.data))
      setValues((v) => {
        const next = { ...v }
        for (const key of group.keys) {
          const raw = res.data.settings[key].value
          if (key === "ads_random") next.ads_random = Boolean(raw)
          else next[key] = String(raw) as Values[Exclude<SettingKey, "ads_random">]
        }
        return next
      })
      toast.success(`「${group.title}」已保存`)
      return
    }
    const msgs: string[] = [res.error.message]
    if (res.error.fields) msgs.push(...Object.values(res.error.fields))
    setGroupErrors((prev) => ({ ...prev, [group.title]: msgs }))
    toast.error(res.error.message)
    if (res.error.status === 409) void refreshVersions()
  }

  function restoreDefaults() {
    setValues({
      site_name: SETTING_DEFAULTS.site_name,
      site_description: SETTING_DEFAULTS.site_description,
      site_logo: SETTING_DEFAULTS.site_logo,
      site_favicon: SETTING_DEFAULTS.site_favicon,
      footer_text: SETTING_DEFAULTS.footer_text,
      ads_random: SETTING_DEFAULTS.ads_random,
    })
    setGroupErrors({})
    toast.info("已填入默认值（前台 SITE_INFO 口径）；点击各组「保存」后生效")
  }

  function renderErrorList(title: string) {
    const list = groupErrors[title]
    if (!list || list.length === 0) return null
    return (
      <ul className="mt-3 space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {list.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    )
  }

  function renderGroupActions(group: GroupDef) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
          {group.keys.map((k) => (
            <span key={k} className="font-mono">
              {k} v{versions[k]}
            </span>
          ))}
        </span>
        {canUpdate ? (
          <RowAction onClick={() => void saveGroup(group)} loading={savingGroup === group.title} disabled={Boolean(savingGroup)}>
            {savingGroup === group.title ? "保存中" : "保存本组"}
          </RowAction>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          站点设置为白名单 6 项，逐 key 乐观锁（v 号为当前服务端版本）；保存为单事务，任一 key 版本冲突则本组整批回滚。
        </p>
        {canUpdate ? (
          <RowAction onClick={restoreDefaults} disabled={Boolean(savingGroup)} title="填入 SITE_INFO 默认值（不直接写库）">
            <RotateCcw className="size-3.5" aria-hidden />
            恢复默认值
          </RowAction>
        ) : (
          <span className="text-xs text-warning">当前角色无「站点设置修改」权限，页面为只读。</span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 网站基础信息 ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{GROUPS[0].title}</h2>
            <span className="text-xs text-muted-foreground">{GROUPS[0].description}</span>
          </div>
          <div className="mt-4 space-y-4">
            <FormField id="set-site-name" label="站点名称" required error={undefined} description="最多 100 字符">
              <TextInput
                id="set-site-name"
                value={values.site_name}
                maxLength={100}
                showCount
                onChange={(e) => setValue("site_name", e.target.value)}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
            <FormField id="set-site-desc" label="站点描述" description="最多 500 字符；用于 SEO / 分享摘要">
              <TextareaField
                id="set-site-desc"
                value={values.site_description}
                maxLength={500}
                rows={3}
                onChange={(e) => setValue("site_description", e.target.value)}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
          </div>
          {renderGroupActions(GROUPS[0])}
          {renderErrorList(GROUPS[0].title)}
        </section>

        {/* ── 网站品牌 ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{GROUPS[1].title}</h2>
            <span className="text-xs text-muted-foreground">{GROUPS[1].description}</span>
          </div>
          <div className="mt-4 space-y-4">
            <FormField
              id="set-site-logo"
              label="站点 Logo"
              description="站内静态图片路径（/ 开头），文件必须已存在；支持 png/jpg/jpeg/gif/webp/avif/ico，禁 SVG/HTML 与外链"
              labelSuffix={<MediaPreview src={values.site_logo.trim()} alt="Logo 预览" />}
            >
              <TextInput
                id="set-site-logo"
                value={values.site_logo}
                maxLength={1024}
                placeholder="/sites/facai8/images/logo.png"
                onChange={(e) => setValue("site_logo", e.target.value)}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
            <FormField
              id="set-site-favicon"
              label="站点 Favicon"
              description="同上；浏览器标签页图标路径"
              labelSuffix={<MediaPreview src={values.site_favicon.trim()} alt="Favicon 预览" className="h-6 w-6" />}
            >
              <TextInput
                id="set-site-favicon"
                value={values.site_favicon}
                maxLength={1024}
                placeholder="/sites/facai8/images/favicon.ico"
                onChange={(e) => setValue("site_favicon", e.target.value)}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
          </div>
          {renderGroupActions(GROUPS[1])}
          {renderErrorList(GROUPS[1].title)}
        </section>

        {/* ── 页脚 ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{GROUPS[2].title}</h2>
            <span className="text-xs text-muted-foreground">{GROUPS[2].description}</span>
          </div>
          <div className="mt-4 space-y-4">
            <FormField id="set-footer" label="页脚文字" description="最多 500 字符">
              <TextareaField
                id="set-footer"
                value={values.footer_text}
                maxLength={500}
                rows={3}
                onChange={(e) => setValue("footer_text", e.target.value)}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
          </div>
          {renderGroupActions(GROUPS[2])}
          {renderErrorList(GROUPS[2].title)}
        </section>

        {/* ── 广告设置 ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{GROUPS[3].title}</h2>
            <span className="text-xs text-muted-foreground">{GROUPS[3].description}</span>
          </div>
          <div className="mt-4 space-y-4">
            <FormField id="set-ads-random" label="首页广告随机排序" description="开启后前台首页广告展示顺序随机打乱">
              <SelectField
                id="set-ads-random"
                value={values.ads_random ? "true" : "false"}
                options={ADS_RANDOM_OPTIONS}
                onChange={(e) => setValue("ads_random", e.target.value === "true")}
                disabled={!canUpdate || Boolean(savingGroup)}
              />
            </FormField>
          </div>
          {renderGroupActions(GROUPS[3])}
          {renderErrorList(GROUPS[3].title)}
        </section>
      </div>
    </div>
  )
}

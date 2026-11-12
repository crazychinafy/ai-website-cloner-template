import { getContentRepository } from '@/lib/facai8/content/source'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Lines } from '@/components/sites/facai8/Lines'

// P8-3（第 4 组）：线路列表数据改走统一内容仓库（static/mysql 双源同构）
// 源站 /lines（懒加载 LineCheck）：metadata 标题「线路检测 - 彩搜搜」；移动端无底栏
export const metadata = {
  title: '线路检测 - 彩搜搜',
}

export default async function LinesPage() {
  const repo = getContentRepository()
  const [lines, user] = await Promise.all([repo.getLines(), getSessionUser()])
  return (
    <SiteFrame user={user} barVariant={null}>
      <Lines lines={lines} />
    </SiteFrame>
  )
}

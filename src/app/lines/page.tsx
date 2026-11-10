import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { Lines } from '@/components/sites/facai8/Lines'

// 源站 /lines（懒加载 LineCheck）：metadata 标题「线路检测 - 彩搜搜」；移动端无底栏
export const metadata = {
  title: '线路检测 - 彩搜搜',
}

export default async function LinesPage() {
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      <Lines />
    </SiteFrame>
  )
}

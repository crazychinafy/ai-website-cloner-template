import { BULLETINS } from '@/lib/facai8/data/bulletins'
import { getSessionUser } from '@/lib/facai8/auth'
import { SiteFrame } from '@/components/sites/facai8/SiteFrame'
import { BulletinDetail } from '@/components/sites/facai8/BulletinDetail'
import { BulletinEmpty } from '@/components/sites/facai8/BulletinEmpty'

// 源站：document.title = `{title} - 公告` + 站名后缀（实测「网站无法访问… - 公告 - 彩搜搜」）；
// 无效 ID 时源站渲染页内空态（「公告不存在 - 彩搜搜」），非 HTTP 404
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = BULLETINS.find((x) => x.id === id)
  return {
    title: b ? `${b.title} - 公告 - 彩搜搜` : '公告不存在 - 彩搜搜',
  }
}

export default async function BulletinDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const bulletin = BULLETINS.find((x) => x.id === id)
  const user = await getSessionUser()
  return (
    <SiteFrame user={user} barVariant={null}>
      {bulletin ? (
        <BulletinDetail bulletin={bulletin} total={BULLETINS.length} prevId={null} nextId={null} />
      ) : (
        <BulletinEmpty />
      )}
    </SiteFrame>
  )
}

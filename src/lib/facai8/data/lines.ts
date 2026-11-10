// 源站 /api/public/lines 快照（2026-11 抓取；线路检测页 5 条）
export interface LineItem {
  id: string
  name: string
  url: string
}

export const ALL_LINES: LineItem[] = [
  { id: '92835678353756160', name: '线路检测1', url: 'https://www.10088.org' },
  { id: '92835742140731392', name: '线路检测2', url: 'https://www.3379.org' },
  { id: '103863710086467584', name: '永久域名（无法访问使用VPN）', url: 'https://caisoso.org' },
  { id: '109226948479291392', name: '永久域名（无法访问使用VPN）', url: 'https://jianada.org' },
  { id: '112448336795144192', name: '永久域名', url: 'https://caisoso.app' },
]

// 生成站点样式表：
//  1) docs/research/facai8/app-css.txt -> src/components/sites/facai8/facai8.css
//  2) dom-parts-pretty.json 中的 5 个行内 iconfont <style> -> src/components/sites/facai8/iconfont.css
//  字体 URL 重写为 /sites/facai8/fonts/iconfont-{hash}.*（去掉 ?t= 查询串）
const fs = require('fs')
const DIR = 'L:/ai-website-cloner-template/docs/research/facai8/'
const OUT = 'L:/ai-website-cloner-template/src/components/sites/facai8'
fs.mkdirSync(OUT, { recursive: true })

const rewrite = (css) => css
  .replace(/\/uploads\/fonts\/([0-9a-f]{12})\/iconfont\.(woff2|woff|ttf)\?(?:t=[0-9]+)?/g,
    (m, hash, ext) => `/sites/facai8/fonts/iconfont-${hash}.${ext}`)
  .replace(/\/uploads\/fonts\/([0-9a-f]{12})\/iconfont\.(woff2|woff|ttf)(?![\w?])/g,
    (m, hash, ext) => `/sites/facai8/fonts/iconfont-${hash}.${ext}`)

// 1. 主样式表
let app = fs.readFileSync(DIR + 'app-css.txt', 'utf8')
app = rewrite(app)
fs.writeFileSync(OUT + '/facai8.css', '/* 移植自源站 /assets/index-B351FioS.css（2026-11-08 存档，字体路径本地化） */\n' + app)
console.log('facai8.css:', (fs.statSync(OUT + '/facai8.css').size / 1024).toFixed(1) + 'KB')

// 2. iconfont 行内样式（源站通过 <style> 注入的 5 个字体库定义）
const parts = JSON.parse(fs.readFileSync(DIR + 'dom-parts-pretty.json', 'utf8'))
const styles = (parts.styles || []).map(rewrite).join('\n')
fs.writeFileSync(OUT + '/iconfont.css',
  '/* 移植自源站行内 <style>（5 个 iconfont 库，字体路径本地化） */\n' + styles + '\n')
console.log('iconfont.css:', (fs.statSync(OUT + '/iconfont.css').size / 1024).toFixed(1) + 'KB')
console.log('font refs ok:', (fs.readFileSync(OUT + '/iconfont.css', 'utf8').match(/\/sites\/facai8\/fonts/g) || []).length)

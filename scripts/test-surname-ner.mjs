import { extractSurnameAnchorEntities } from '../src/utils/surnameNer.js'

const TESTS = [
  // ============ 锚点 A：标签后裸名 + 冒号 ============
  ['法人：张三', ['张三'], '标签:中文冒号+紧贴'],
  ['法人:张三', ['张三'], '标签:英文冒号+紧贴'],
  ['法人： 张三', ['张三'], '标签:冒号+空格'],
  ['法人 张三', ['张三'], '标签+空格(无冒号)'],
  ['法定代表人：李建国', ['李建国'], '4字标签+3字名'],
  ['经办人为王明', ['王明'], '标签+"为"连接'],
  ['户名：陈晓东', ['陈晓东'], '银行户名场景'],
  ['承租人：欧阳修', ['欧阳修'], '复姓 2+1'],
  ['项目经理：诸葛孔明', ['诸葛孔明'], '复姓 2+2'],

  // ============ 锚点 E：标签换行裸名 ============
  ['法人：\n张三', ['张三'], '冒号+换行+裸名'],
  ['法定代表人：\n  李建国', ['李建国'], '冒号+换行+缩进'],
  ['法人\n张三', ['张三'], '无冒号+换行'],

  // ============ 锚点 D：顿号串联 ============
  ['参与人：张三、李四、王五', ['张三', '李四', '王五'], '顿号串联3人'],
  ['出席人员：陈晓东、刘备', ['陈晓东', '刘备'], '顿号串联2人'],

  // ============ 锚点 B：后置职务/动作 ============
  ['李建国 总经理签字', ['李建国'], '名+空格+总经理'],
  ['张三签字：', ['张三'], '名+签字'],
  ['王明（盖章）', ['王明'], '名+(盖章)'],

  // ============ 锚点 C：日期相邻 ============
  ['李建国 2024-01-01', ['李建国'], '名+空格+ISO日期'],
  ['2024年5月8日 王明 提交', ['王明'], '日期+名+动词'],

  // ============ 反例：不应误命中 ============
  ['本合同自2024年起生效', [], '虚词不应触发'],
  ['公司合同金额一百万元', [], '量词数字不应触发'],
  ['本合同由甲方提供', [], '甲方不是姓名'],
  ['张三李四王五', [], '无锚点的纯姓名串(过严，但避免误伤)'],
  ['白色书面申明', [], '"白"虽是百家姓但后接"色"是黑名单字符'],
  ['一二三四的所了和', [], '全是黑名单字符'],
]

let pass = 0
let fail = 0
const failures = []

for (const [text, expected, label] of TESTS) {
  const hits = extractSurnameAnchorEntities(text)
  const actual = hits.map((h) => h.text)
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const ok = expectedSet.size === actualSet.size && [...expectedSet].every((n) => actualSet.has(n))
  if (ok) {
    pass += 1
  } else {
    fail += 1
    failures.push({ label, text, expected, actual })
  }
}

console.log(`PASS: ${pass}/${TESTS.length}, FAIL: ${fail}`)
if (failures.length) {
  console.log('\n=== FAILURES ===')
  for (const f of failures) {
    console.log(`[${f.label}]`)
    console.log(`  text     : ${JSON.stringify(f.text)}`)
    console.log(`  expected : ${JSON.stringify(f.expected)}`)
    console.log(`  actual   : ${JSON.stringify(f.actual)}`)
  }
  process.exit(1)
}

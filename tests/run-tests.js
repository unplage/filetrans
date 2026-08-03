'use strict';

/*
 * Node 单测（无构建工具）：从 ../index.html 提取内联脚本中的纯逻辑函数，
 * 用 jsdom 提供 DOM 环境后运行断言。
 *
 * 运行：node tests/run-tests.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---------- 1. 提取内联脚本 ----------
const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
let inline = '';
for (const s of scripts) {
  const code = s.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (code.includes('use strict') && code.includes('文转大师')) {
    inline = code;
    break;
  }
}
if (!inline) throw new Error('未找到内联脚本');

// ---------- 2. 提取顶层函数与常量声明 ----------
function extractDeclarations(code) {
  const lines = code.split('\n');
  const decls = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const m = line.match(/^(\s*)(function\s+[A-Za-z_$][\w$]*\s*\(|const\s+[A-Za-z_$][\w$]*\s*=\s*new Set\(\[)/);
    if (!m) continue;
    const indent = m[1];
    let src = line;
    if (m[2].startsWith('const')) {
      // const NAME = new Set([...]); 单行（仅数组字面量，排除 new Set(c.items.map(...)) 等嵌套用法）
      if (!line.trim().endsWith(']);')) continue;
    } else {
      // function ... { } 需括号配平
      let depth = 0;
      let started = false;
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') { depth++; started = true; }
        else if (line[j] === '}') depth--;
      }
      while (depth > 0) {
        idx++;
        if (idx >= lines.length) break;
        src += '\n' + lines[idx];
        for (let j = 0; j < lines[idx].length; j++) {
          if (lines[idx][j] === '{') depth++;
          else if (lines[idx][j] === '}') depth--;
        }
      }
    }
    decls.push(src);
  }
  return decls;
}

const decls = extractDeclarations(inline);
if (!decls.length) throw new Error('未能提取任何函数声明');

// ---------- 3. 建立 jsdom 环境并求值 ----------
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.test/' });
const { window } = dom;

const needed = [
  'palmdocDecode', 'decodeBytes', 'decodeHtmlBytes', 'detectHtmlCharset', 'hasBom',
  'normalizeEncodingName', 'htmlToText', 'normalizeHtmlDoc', 'isCjkChar', 'joinLineItems',
  'detectMobiType', 'decodeMobiText', 'parsePalmMobi', 'readU16', 'readU32',
  'BLOCK_TAGS', 'SKIP_TAGS', 'detectPdfColumns', 'flattenToParaLines',
];

const fnBody = decls.join('\n') +
  '\nreturn { ' + needed.join(', ') + ' };';

const runner = new Function(
  'window', 'document', 'Node', 'DOMParser', 'TextDecoder', 'Blob', 'URL', 'self',
  fnBody
);
const api = runner(window, window.document, window.Node, window.DOMParser, TextDecoder, Blob, URL, window);

// ---------- 4. 测试工具 ----------
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
  }
}

const eq = assert.strictEqual;
const ok = assert.ok;
const bytes = (s) => new TextEncoder().encode(s);

function u8a(arr) {
  return new Uint8Array(arr);
}

// Calibre py_compress_doc 的 JS 移植（权威 MOBI PalmDoc 压缩器）
function rindexSub(hay, needle, from) {
  for (let pos = from - needle.length; pos >= 0; pos--) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (hay[pos + k] !== needle[k]) { match = false; break; }
    }
    if (match) return pos;
  }
  return -1;
}
function compressDoc(data) {
  const out = [];
  let i = 0;
  const ldata = data.length;
  while (i < ldata) {
    if (i > 10 && (ldata - i) > 10) {
      let chunk = null, match = -1;
      for (let j = 10; j > 2; j--) {
        chunk = data.subarray(i, i + j);
        match = rindexSub(data, chunk, i);
        if (match >= 0 && (i - match) <= 2047) break;
        match = -1;
      }
      if (match >= 0) {
        const n = chunk.length;
        const m = i - match;
        const code = 0x8000 + ((m << 3) & 0x3FF8) + (n - 3);
        out.push((code >> 8) & 0xFF, code & 0xFF);
        i += n;
        continue;
      }
    }
    const och = data[i]; i += 1;
    if (och === 0x20 && i < ldata) {
      const onch = data[i];
      if (onch >= 0x40 && onch < 0x80) {
        out.push(onch ^ 0x80);
        i += 1;
        continue;
      }
    }
    if (och === 0 || (och > 8 && och < 0x80)) {
      out.push(och);
    } else {
      let j = i;
      const binseq = [och];
      while (j < ldata && binseq.length < 8) {
        const c = data[j];
        if (c === 0 || (c > 8 && c < 0x80)) break;
        binseq.push(c);
        j += 1;
      }
      out.push(binseq.length);
      for (const b of binseq) out.push(b);
      i += binseq.length - 1;
    }
  }
  return u8a(out);
}

// 构建一个内存中的 PalmDB MOBI 文件
function buildMobiFile({ title = 'TestBook', encoding = 65001, htmlText, compression = 2, split = 1, extraRecs = [] }) {
  const textBytes = bytes(htmlText);
  const mobiHeaderLen = 232;
  const exthLen = 12;

  // 将原文切分后逐段独立压缩（每条记录的 LZ77 上下文相互独立，符合真实 MOBI）
  if (split < 1) split = 1;
  const compParts = [];
  for (let i = 0; i < split; i++) {
    const s = Math.floor(i * textBytes.length / split);
    const e = Math.floor((i + 1) * textBytes.length / split);
    const rawChunk = textBytes.slice(s, e);
    compParts.push(compression === 2 ? compressDoc(rawChunk) : rawChunk);
  }

  const headerRegion = 16 + mobiHeaderLen + exthLen;
  const rec0 = new Uint8Array(headerRegion + compParts[0].length);
  // PalmDoc 头
  rec0[0] = 0x00; rec0[1] = 0x02; // compression = 2（记录0 头部区实际未压缩）
  let v = new DataView(rec0.buffer);
  v.setUint32(4, textBytes.length);              // text length
  v.setUint16(8, split - 1);                     // text record count = 记录0 之后的续记录数
  // MOBI 头
  rec0[16] = 0x4d; rec0[17] = 0x4f; rec0[18] = 0x42; rec0[19] = 0x49; // 'MOBI'
  v.setUint32(20, mobiHeaderLen);   // MOBI 头长度
  v.setUint32(28, encoding);        // 文本编码
  v.setUint32(128, 0x40);           // EXTH 标志位
  // EXTH
  rec0[headerRegion - exthLen] = 0x45; // 'E'
  rec0[headerRegion - exthLen + 1] = 0x58; // 'X'
  rec0[headerRegion - exthLen + 2] = 0x54; // 'T'
  rec0[headerRegion - exthLen + 3] = 0x48; // 'H'
  v.setUint32(headerRegion - exthLen + 4, exthLen); // EXTH 长度
  v.setUint32(headerRegion - exthLen + 8, 0);       // 记录数 = 0
  // 记录0 正文
  rec0.set(compParts[0], headerRegion);

  // 其余文本记录
  const bodyRecs = [];
  for (let i = 1; i < split; i++) bodyRecs.push(compParts[i]);
  // 附加非文本记录（如索引 INDX）
  for (const r of extraRecs) bodyRecs.push(r);

  // PalmDB 外壳
  const numRecords = 1 + bodyRecs.length + 1; // 记录0 + 续记录 + EOF 哨兵
  const header = new Uint8Array(78 + numRecords * 8);
  let h = new DataView(header.buffer);
  const nameBytes = bytes(title);
  header.set(nameBytes, 0);
  const typeStr = 'BOOK', creatorStr = 'MOBI';
  for (let i = 0; i < 4; i++) header[60 + i] = typeStr.charCodeAt(i);
  for (let i = 0; i < 4; i++) header[64 + i] = creatorStr.charCodeAt(i);
  h.setUint16(76, numRecords);

  // 记录 0
  let offset = header.length;
  const recListBase = 78;
  h.setUint32(recListBase, offset);
  const allRecs = [rec0].concat(bodyRecs);
  offset += rec0.length;
  for (let i = 0; i < bodyRecs.length; i++) {
    h.setUint32(recListBase + (i + 1) * 8, offset);
    offset += bodyRecs[i].length;
  }
  // EOF 哨兵
  h.setUint32(recListBase + numRecords * 8 - 8, offset);

  const file = new Uint8Array(offset);
  file.set(header, 0);
  let pos = header.length;
  for (const r of allRecs) { file.set(r, pos); pos += r.length; }
  return file.buffer;
}

// ---------- 5. 测试用例 ----------
console.log('\n== 编码检测 ==');
test('normalizeEncodingName 别名映射', () => {
  eq(api.normalizeEncodingName('UTF8'), 'utf-8');
  eq(api.normalizeEncodingName('GBK'), 'gb18030');
  eq(api.normalizeEncodingName('latin1'), 'latin1');
  eq(api.normalizeEncodingName('cp1252'), 'windows-1252');
  eq(api.normalizeEncodingName('shift_jis'), 'shift_jis');
});

test('decodeBytes: UTF-8 无 BOM', () => {
  eq(api.decodeBytes(bytes('你好 world')), '你好 world');
});

test('decodeBytes: UTF-8 BOM 剥离', () => {
  const b = bytes('\uFEFF你好');
  eq(api.decodeBytes(b), '你好');
});

test('decodeBytes: UTF-16LE BOM', () => {
  const s = '中文字符串测试';
  const arr = [0xFF, 0xFE];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    arr.push(cp & 0xFF, (cp >> 8) & 0xFF);
  }
  eq(api.decodeBytes(u8a(arr)), s);
});

test('decodeBytes: GB18030 中文回退解码', () => {
  // GB18030 编码 "你好"（双字节 GBK）
  const gbk = u8a([0xC4, 0xE3, 0xBA, 0xC3, 0x20, 0x41]);
  eq(api.decodeBytes(gbk), '你好 A');
});

test('decodeBytes: GB18030 优先于 Big5（共用字节按 GBK 解）', () => {
  // 0xA4A4 A4E5 在 GB18030 中为片假名区（优先命中），验证解码顺序
  const kana = api.decodeBytes(u8a([0xA4, 0xA4, 0xA4, 0xE5]));
  ok(typeof kana === 'string' && kana.length >= 1, '应产出非空字符串');
});

test('decodeBytes: 非法字节不抛错（鲁棒性）', () => {
  // 任意字节序列都不应崩溃；纯 ASCII 部分必须原样保留
  const out = api.decodeBytes(u8a([0xFF, 0x80, 0x41, 0x42]));
  ok(typeof out === 'string');
  ok(out.includes('AB'), 'ASCII 部分应保留');
});

console.log('\n== MOBI 类型识别 ==');
test('detectMobiType: PalmDB BOOK/MOBI（真实 Kindle 文件）', () => {
  // offset 60 = 'BOOK'，offset 64 = 'MOBI'
  const b = new Uint8Array(68);
  for (let i = 0; i < 60; i++) b[i] = 0x61; // 书名填充
  b[60] = 0x42; b[61] = 0x4f; b[62] = 0x4f; b[63] = 0x4b; // 'BOOK'
  b[64] = 0x4d; b[65] = 0x4f; b[66] = 0x42; b[67] = 0x49; // 'MOBI'
  eq(api.detectMobiType(b), 'palmdb');
});
test('detectMobiType: PalmDB 类型 TEXt', () => {
  const b = new Uint8Array(68);
  b[60] = 0x54; b[61] = 0x45; b[62] = 0x58; b[63] = 0x74; // 'TEXt'
  eq(api.detectMobiType(b), 'palmdb');
});
test('detectMobiType: HTML 型', () => {
  eq(api.detectMobiType(bytes('  <html><body>hi</body></html>')), 'html');
  eq(api.detectMobiType(bytes('<!DOCTYPE html>')), 'html');
});
test('detectMobiType: 无法识别', () => {
  eq(api.detectMobiType(bytes('random binary data')), 'unknown');
});

console.log('\n== PalmDoc LZ77（MOBI 变体） ==');
test('解压 = 压缩逆运算（往返）', () => {
  const cases = [
    bytes('hello world, hello world, hello world'),
    bytes('The quick brown fox jumps over the lazy dog. '.repeat(20)),
    bytes('中文测试文本，中文测试文本。'),
    bytes('a b c \xfed '),
    bytes('0123456789axyz2bxyz2cdfgfo9iuyerh'),
    bytes('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '),
  ];
  for (const c of cases) {
    const comp = compressDoc(c);
    const dec = api.palmdocDecode(comp);
    ok(dec.length === c.length && dec.every((x, i) => x === c[i]), '往返失败 len=' + c.length);
  }
});

test('解码: 0xC0-0xFF = 空格 + 字符', () => {
  // 0xC1 -> 空格 + (0xC1 ^ 0x80 = 0x41 = 'A')
  eq(String.fromCharCode(...api.palmdocDecode(u8a([0xC1]))), ' A');
});

test('解码: 0x01-0x08 字面量串', () => {
  // 0x03 + 'abc'
  eq(String.fromCharCode(...api.palmdocDecode(u8a([0x03, 0x61, 0x62, 0x63]))), 'abc');
});

test('解码: 0x80-0xBF 回溯码', () => {
  // 文本 "abcabcabcabc" 压缩： "abc" 出现4次
  const c = compressDoc(bytes('abcabcabcabc'));
  const d = api.palmdocDecode(c);
  eq(String.fromCharCode(...d), 'abcabcabcabc');
});

console.log('\n== htmlToText（EPUB/MOBI 排版） ==');
test('段落与标题保留空行', () => {
  const html = '<html><body><h1>第一章</h1><p>这是第一段内容。</p><p>这是第二段内容，用于测试段落分隔。</p></body></html>';
  const out = api.htmlToText(html);
  eq(out, '第一章\n\n这是第一段内容。\n\n这是第二段内容，用于测试段落分隔。');
});

test('<br> 产生单换行而非段落', () => {
  const out = api.htmlToText('<p>第一行<br>第二行</p><p>新段落</p>');
  eq(out, '第一行\n第二行\n\n新段落');
});

test('script/style/title 内容被剔除', () => {
  const html = '<html><head><title>隐藏标题</title><style>body{color:red}</style></head><body><script>var x=1;</script><p>正文</p></body></html>';
  const out = api.htmlToText(html);
  ok(!out.includes('隐藏标题'), '标题混入');
  ok(!out.includes('color:red'), '样式混入');
  ok(!out.includes('var x'), '脚本混入');
  ok(out.includes('正文'));
});

test('列表项逐条分行', () => {
  const out = api.htmlToText('<ul><li>苹果</li><li>香蕉</li><li>橙子</li></ul>');
  eq(out, '苹果\n\n香蕉\n\n橙子');
});

test('HTML 实体解码（含数字引用）', () => {
  const out = api.htmlToText('<p>a&amp;b &#8217; &#39; &#x2026;</p>');
  eq(out, 'a&b \u2019 \' \u2026');
});

test('嵌套 div 保持块分隔', () => {
  const out = api.htmlToText('<div>上<div>中</div>下</div>');
  eq(out, '上\n\n中\n\n下');
});

console.log('\n== CJK 智能拼接 ==');
test('joinLineItems: 连续 CJK 不插空格', () => {
  eq(api.joinLineItems(['你好', '世界']), '你好世界');
  eq(api.joinLineItems(['使用', '方法']), '使用方法');
});
test('joinLineItems: 英文单词插空格', () => {
  eq(api.joinLineItems(['Hello', 'world']), 'Hello world');
});
test('joinLineItems: 中文夹英文边界不插空格，英文之间插空格', () => {
  eq(api.joinLineItems(['中文English', 'Test']), '中文English Test');
});
test('joinLineItems: 已含空白的项不重复加空格', () => {
  eq(api.joinLineItems(['abc ', 'def']), 'abc def');
});
test('joinLineItems: 撇号分割项合并（New Yorker + rsquo + s）', () => {
  eq(api.joinLineItems(['New Yorker', '\u2019', 's']), 'New Yorker\u2019s');
});
test('joinLineItems: 右引号+逗号后仍加空格', () => {
  eq(api.joinLineItems(['play', '\u201cThe Gin Game,\u201d', 'Broken']), 'play\u201cThe Gin Game,\u201d Broken');
});
test('joinLineItems: 左引号后不加空格', () => {
  eq(api.joinLineItems(['\u201cMarina,\u201d', 'a new show']), '\u201cMarina,\u201d a new show');
});
test('joinLineItems: 逗号结尾后加空格（She thought, + I）', () => {
  eq(api.joinLineItems(['She thought,', 'I should']), 'She thought, I should');
});
test('isCjkChar', () => {
  ok(api.isCjkChar('你'));
  ok(api.isCjkChar('。'));
  ok(!api.isCjkChar('a'));
  ok(!api.isCjkChar('1'));
});

console.log('\n== 段落展平（每段一行） ==');
test('flattenToParaLines: 英文段内多行合并为一行', () => {
  const input = 'This is the first line\nof the paragraph\ncontinues here.\n\nSecond paragraph\nnext line.';
  eq(api.flattenToParaLines(input), 'This is the first line of the paragraph continues here.\n\nSecond paragraph next line.');
});
test('flattenToParaLines: 中文段内多行合并且不加空格', () => {
  const input = '这是第一行\n这是第二行内容\n\n这是新段落';
  eq(api.flattenToParaLines(input), '这是第一行这是第二行内容\n\n这是新段落');
});
test('flattenToParaLines: 撇号引号贴合', () => {
  const input = 'New Yorker\n\u2019s own\n\n\u201cHello,\u201d\nshe said.';
  eq(api.flattenToParaLines(input), 'New Yorker\u2019s own\n\n\u201cHello,\u201d she said.');
});
test('flattenToParaLines: 空段过滤', () => {
  eq(api.flattenToParaLines('first\n\n\n\nsecond'), 'first\n\nsecond');
  eq(api.flattenToParaLines('   \n\n   '), '');
});
test('flattenToParaLines: 单段无换行原样返回', () => {
  eq(api.flattenToParaLines('single line'), 'single line');
});

console.log('\n== PDF 分栏检测 ==');
// 构造模拟文本项：{x, width}。主导字高 domH = 12
test('detectPdfColumns: 单栏返回空', () => {
  const items = [];
  for (let row = 0; row < 10; row++) {
    const y = 1000 - row * 20;
    // 单栏文字连续填满 x=70..270，无中部空隙
    for (let k = 0; k < 25; k++) items.push({ x: 70 + k * 8, y, width: 8 });
  }
  eq(api.detectPdfColumns(items, 12).length, 0);
});
test('detectPdfColumns: 双栏一致间隙识别', () => {
  const items = [];
  for (let row = 0; row < 10; row++) {
    const y = 1000 - row * 20;
    // 左栏 x=70..150，右栏 x=200..280（间隙 ~50）
    for (let k = 0; k < 8; k++) items.push({ x: 70 + k * 10, y, width: 10 });
    for (let k = 0; k < 8; k++) items.push({ x: 200 + k * 10, y, width: 10 });
  }
  const breaks = api.detectPdfColumns(items, 12);
  eq(breaks.length, 1);
  ok(breaks[0] > 160 && breaks[0] < 200, '栏边界应在两栏之间: ' + breaks[0]);
});
test('detectPdfColumns: 紧凑双栏 18px 间隙（文献 PDF 场景）', () => {
  const items = [];
  for (let row = 0; row < 30; row++) {
    const y = 2000 - row * 20;
    // 左栏 x=45 起、宽 248（右边缘 293）；右栏 x=311（间隙 ~18px）
    for (let k = 0; k < 10; k++) items.push({ x: 45 + k * 24.8, y, width: 24.8 });
    for (let k = 0; k < 10; k++) items.push({ x: 311 + k * 24.8, y, width: 24.8 });
  }
  const breaks = api.detectPdfColumns(items, 9);
  eq(breaks.length, 1);
  ok(breaks[0] > 290 && breaks[0] < 325, '栏边界应在 302 附近: ' + breaks[0]);
});
test('detectPdfColumns: 单行孤立空隙不误判（设计排版/广告）', () => {
  const items = [];
  for (let row = 0; row < 10; row++) {
    const y = 1000 - row * 20;
    for (let k = 0; k < 5; k++) items.push({ x: 70 + k * 8, y, width: 8 });
  }
  // 仅一行出现大空隙（非跨行一致）
  items.push({ x: 320, y: 1000, width: 8 });
  eq(api.detectPdfColumns(items, 12).length, 0);
});
test('detectPdfColumns: 单栏右半空白（短页）不误判为分栏', () => {
  const items = [];
  for (let row = 0; row < 10; row++) {
    const y = 1000 - row * 20;
    // 文字只占左半（x=23..280），右半全空白（单栏短文章）
    for (let k = 0; k < 25; k++) items.push({ x: 23 + k * 10, y, width: 10 });
  }
  eq(api.detectPdfColumns(items, 9).length, 0);
});
test('detectPdfColumns: 三栏识别两个边界', () => {
  const items = [];
  for (let row = 0; row < 10; row++) {
    const y = 1000 - row * 20;
    // 三栏：col1 x=50..190，col2 x=210..310，col3 x=340..480
    for (let k = 0; k < 7; k++) items.push({ x: 50 + k * 20, y, width: 20 });
    for (let k = 0; k < 5; k++) items.push({ x: 210 + k * 20, y, width: 20 });
    for (let k = 0; k < 7; k++) items.push({ x: 340 + k * 20, y, width: 20 });
  }
  const breaks = api.detectPdfColumns(items, 12);
  eq(breaks.length, 2);
});
test('detectPdfColumns: 标题页全宽元素 + 下方双栏（文献 p1 场景）', () => {
  const items = [];
  // 页首标题行：全宽元素覆盖中部（不应干扰下方正文行检测）
  for (let k = 0; k < 30; k++) items.push({ x: 36 + k * 15, y: 700, width: 15 });
  // 下方双栏正文：左栏 x=36..284（右边缘 ~290），右栏 x=302..559
  for (let row = 0; row < 20; row++) {
    const y = 650 - row * 20;
    for (let k = 0; k < 10; k++) items.push({ x: 36 + k * 24.8, y, width: 24.8 });
    for (let k = 0; k < 10; k++) items.push({ x: 302 + k * 24.8, y, width: 24.8 });
  }
  const breaks = api.detectPdfColumns(items, 9);
  eq(breaks.length, 1, '标题行不应阻止检测下方双栏');
  ok(breaks[0] > 285 && breaks[0] < 320, '栏边界应在 302 附近: ' + breaks[0]);
});
test('detectPdfColumns: 栏行错位双栏（Methods 页场景）', () => {
  const items = [];
  // 多数行左右栏同排（y 对齐），部分行仅有单栏（错位）——模拟 Methods 页
  for (let i = 0; i < 25; i++) {
    const y = 800 - i * 20;
    // 左栏
    for (let k = 0; k < 10; k++) items.push({ x: 36 + k * 24.8, y, width: 24.8 });
    // 右栏：多数行与左栏同排，少数行错位（+3px）
    const yR = (i % 5 === 0) ? y + 3 : y;
    for (let k = 0; k < 10; k++) items.push({ x: 302 + k * 24.8, y: yR, width: 24.8 });
  }
  const breaks = api.detectPdfColumns(items, 9);
  eq(breaks.length, 1, '错位双栏仍应识别');
  ok(breaks[0] > 285 && breaks[0] < 320, '栏边界应在 302 附近: ' + breaks[0]);
});

console.log('\n== parsePalmMobi（原生二进制 MOBI 集成） ==');
test('UTF-8 原生 MOBI 提取中文正文', () => {
  const file = buildMobiFile({
    htmlText: '<html><body><h1>标题</h1><p>这是正文第一段。</p><p>这是正文第二段，包含中文。</p></body></html>',
  });
  const out = api.parsePalmMobi(file);
  eq(out, '标题\n\n这是正文第一段。\n\n这是正文第二段，包含中文。');
});

test('未压缩（compression=1）MOBI', () => {
  const file = buildMobiFile({
    compression: 1,
    htmlText: '<html><body><p>plain uncompressed text</p><p>second paragraph</p></body></html>',
  });
  const out = api.parsePalmMobi(file);
  eq(out, 'plain uncompressed text\n\nsecond paragraph');
});

test('多记录 MOBI：正文跨记录解压', () => {
  const htmlText = '<html><body>' +
    '<h1>第一章</h1>' +
    '<p>' + '很长很长的中文段落，'.repeat(50) + '</p>' +
    '<p>第二段内容，用来验证跨记录拼接后的排版。</p>' +
    '</body></html>';
  const file = buildMobiFile({ htmlText, split: 4 });
  const out = api.parsePalmMobi(file);
  ok(out.startsWith('第一章\n\n'), '标题缺失');
  ok(out.includes('很长很长的中文段落，'.repeat(50)), '第一段内容缺失');
  ok(out.includes('第二段内容，用来验证跨记录拼接后的排版。'), '第二段缺失');
  ok(out.indexOf('第一章\n\n') === 0);
});

test('多记录 MOBI：正文后的索引记录被排除', () => {
  const file = buildMobiFile({
    htmlText: '<html><body><p>正文内容</p></body></html>',
    split: 2,
    extraRecs: [u8a([0x49, 0x4E, 0x44, 0x58, 0x00, 0x01, 0x02, 0x03, 0xFF, 0xFF, 0xFF])], // 'INDX'
  });
  const out = api.parsePalmMobi(file);
  eq(out, '正文内容');
  ok(!out.includes('INDX'), '索引记录混入正文');
});

test('损坏文件抛出明确错误', () => {
  assert.throws(() => api.parsePalmMobi(bytes('not a mobi at all').buffer), /损坏|MOBI/);
});

test('detectMobiType 与 parsePalmMobi 联动：构建的 BOOK/MOBI 文件被正确识别为 palmdb', () => {
  const file = buildMobiFile({ htmlText: '<html><body><p>检测联动</p></body></html>' });
  const b = new Uint8Array(file);
  eq(api.detectMobiType(b), 'palmdb');
  eq(api.parsePalmMobi(file), '检测联动');
});

console.log('\n== decodeMobiText 编码映射 ==');
test('编码字段映射', () => {
  eq(api.decodeMobiText(bytes('你好'), 65001), '你好');
  // windows-1252: 0xE9 -> é（确定性字节；智能引号区在 Node 与浏览器行为有差异，不在此断言）
  eq(api.decodeMobiText(u8a([0x63, 0x61, 0x66, 0xE9])), 'café');
  // utf-16be
  const u16be = new Uint8Array([0x4F, 0x60, 0x59, 0x7D]); // 你好 in UTF-16BE
  eq(api.decodeMobiText(u16be, 1200), '你好');
});

// ---------- 6. 汇总 ----------
console.log('\n' + '='.repeat(50));
console.log(`通过 ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log('存在失败用例');
  process.exit(1);
} else {
  console.log('全部通过');
}

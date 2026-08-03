📄 文转大师 · 文档格式转换器 (PWA)
一个纯前端、离线可用的文档格式转换工具，支持 PDF、EPUB、TXT、MOBI 之间的文字内容互转。所有处理均在浏览器本地完成，文件不上传任何服务器，保护您的隐私。

🌐 在线体验：https://unplage.github.io/filetrans/

✨ 功能特性
🔄 多格式互转：PDF ↔ EPUB ↔ TXT ↔ MOBI（仅提取纯文字内容）

🚀 完全前端处理：使用 WebAssembly 和纯 JS 库，无需后端服务器

📱 PWA 支持：可安装到桌面，离线使用（首次访问后缓存）

🎯 智能段落合并：任何格式转 TXT 时，每段都输出为一行（段内行合并，段间空行分隔），段落识别自动处理

🧹 文本清洗：自动修复 PDF 中常见的编码乱码（如 country’s 识别问题），保留原文的智能引号/破折号等 Unicode 字符

🔤 编码自动识别：TXT / HTML 输入自动识别 UTF-8、GB18030、Big5 等编码，避免中文乱码

📋 转换历史：保存最近 20 条转换记录，方便查看

🎨 现代化 UI：基于 Tailwind CSS，适配桌面和移动端

🔒 隐私安全：所有文件仅在本地处理，不上传任何数据

📂 支持的格式
输入格式	输出格式	说明
PDF	TXT, EPUB, MOBI	提取纯文本，智能分栏/段落合并，CJK 拼接，连字符还原，页眉页脚过滤；转 TXT 每段一行
EPUB	TXT, PDF, MOBI	解析章节，按块级元素保留段落/标题
TXT	PDF, EPUB, MOBI	自动识别编码（UTF-8 / GB18030 / Big5 等）
MOBI	TXT, PDF, EPUB	原生二进制（PalmDB/PalmDoc）与 HTML 型均可解析
注意：MOBI 生成采用 HTML 结构（兼容 Kindle 邮箱推送），非原生二进制 MOBI。若需原生格式，建议先转 EPUB，再通过亚马逊“发送至 Kindle”服务云端转换。

🚀 快速开始
在线使用（部署后）
访问页面，点击或拖拽上传文件。

选择目标格式（TXT、PDF、EPUB 或 MOBI）。

点击“开始转换”，等待进度条完成。

点击“下载文件”保存结果。

本地部署（GitHub Pages）
克隆本仓库或下载 index.html 和 sw.js 文件。

将文件放入 GitHub 仓库根目录。

在仓库设置中启用 GitHub Pages（分支选择 main）。

访问 https://<用户名>.github.io/<仓库名>/ 即可使用。

🛠️ 技术栈
库	用途
PDF.js	解析 PDF 并提取文本
epub.js	解析 EPUB 文件
JSZip	生成 EPUB（压缩）
jsPDF	生成 PDF（英文支持）
html2canvas	渲染中文 PDF（截图分页）
FileSaver.js	触发下载
Tailwind CSS	界面样式
🔧 核心实现细节
PDF 转 TXT 提取
采用自适应、缩放无关的提取算法：

主导字高：以页面文本项字号中位数为基准，阈值全部用字高倍数表示，不受 PDF 坐标系缩放影响。

智能分栏检测：按行分组的栏间隙聚类——每行独立寻找相邻文本项间的栏间隙，再跨行聚类取位置一致、支持率高的边界（≥25% 行）。兼容紧凑双栏（~18px）、栏行错位、标题页与正文双栏共存等场景；单栏/整页图/广告页不误判。

行距/段距自适应：行距取相邻行 Y 差中位数，段距阈值 = 行距 × 1.6，有效避免《经济学人》等专业排版 PDF 每行独立成段的问题。

每段一行输出：转 TXT 时，识别出的每个段落（含 PDF 双栏、EPUB/MOBI 的标题与正文块）段内所有行合并为一行，段与段之间以空行分隔；中文不加空格、英文单词间加空格、撇号引号正确贴合。

CJK 智能拼接：行内文本项按字符边界决定是否加空格，避免中文被拆散为"你 好"，同时修复撇号伪影（New Yorker + ’ + s → New Yorker’s）。

连字符断词还原：行尾连字符 + 下行首小写 → 自动合并（bon- / bons → bonbons）。

页眉/页脚/页码过滤：跨页重复的页眉页脚与纯页码自动剔除。

MOBI 生成策略
当前生成 HTML 结构文件（MIME 类型 application/x-mobipocket-ebook）。

适用于 Kindle 邮箱推送：亚马逊服务端会自动将 HTML 转换为原生 MOBI。

MOBI 读取：原生二进制 MOBI（PalmDB 容器）与 HTML 型 MOBI 均可读取。原生格式支持 PalmDoc LZ77 解压与编码识别（UTF-8 / Windows-1252 / UTF-16），正文跨记录自动拼接。

文本清洗
修复 PDF 中常见的 UTF-8/Windows-1252 乱码（如 â€™ → '）。

统一换行符（\r\n → \n）、将不换行空格转为普通空格。

保留原文的智能引号与破折号等 Unicode 字符，不做 ASCII 归一化。

编码识别：TXT / HTML 输入按 BOM → UTF-8(严格) → GB18030 → Big5 → Latin-1 依次尝试解码，避免乱码。

📝 注意事项
大文件限制：受浏览器内存限制，建议文件小于 50 MB。

PDF 布局丢失：转换仅提取文字，不保留表格、图片、样式。

MOBI 兼容性：生成的 HTML 文件在 Kindle 上需通过“发送至 Kindle”服务使用。

离线使用：首次访问需联网加载 CDN 库；之后可离线使用界面，但转换依赖的库需已缓存。

🤝 贡献
欢迎提交 Issue 或 Pull Request。主要改进方向：

增强 PDF 分栏识别

支持更多格式（如 DOCX、AZW3）

提升 MOBI 生成兼容性

📄 许可证
MIT License © 2026 DocConverter PWA

📬 联系
如有问题，请通过 GitHub Issues 反馈。

文转大师 – 让文档转换更简单、更安全。


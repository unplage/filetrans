📄 文转大师 · 文档格式转换器 (PWA)
一个纯前端、离线可用的文档格式转换工具，支持 PDF、EPUB、TXT、MOBI 之间的文字内容互转。所有处理均在浏览器本地完成，文件不上传任何服务器，保护您的隐私。

🌐 在线体验：https://unplage.github.io/filetrans/

✨ 功能特性
🔄 多格式互转：PDF ↔ EPUB ↔ TXT ↔ MOBI（仅提取纯文字内容）

🚀 完全前端处理：使用 WebAssembly 和纯 JS 库，无需后端服务器

📱 PWA 支持：可安装到桌面，离线使用（首次访问后缓存）

🎯 智能段落合并：PDF 转 TXT 时自动识别段落，避免每行成段

🧹 文本清洗：自动修复 PDF 中常见的编码乱码（如 country’s 识别问题）

📋 转换历史：保存最近 20 条转换记录，方便重新下载

🎨 现代化 UI：基于 Tailwind CSS，适配桌面和移动端

🔒 隐私安全：所有文件仅在本地处理，不上传任何数据

📂 支持的格式
输入格式	输出格式	说明
PDF	TXT, EPUB, MOBI	提取纯文本，自动合并段落
EPUB	TXT, PDF, MOBI	解析章节内容
TXT	PDF, EPUB, MOBI	直接转换
MOBI	TXT, PDF, EPUB	提取文本（简化解析）
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
PDF 转 TXT 段落合并
采用自适应行高阈值算法：

计算页面内文本项的中位行高。

当相邻行 Y 坐标差 > avgHeight * 1.5 时，插入双换行符（段落分隔）。

有效避免《经济学人》等专业排版 PDF 每行独立成段的问题。

MOBI 生成策略
当前生成 HTML 结构文件（MIME 类型 application/x-mobipocket-ebook）。

适用于 Kindle 邮箱推送：亚马逊服务端会自动将 HTML 转换为原生 MOBI。

若需原生 MOBI，推荐先转 EPUB，再通过 Calibre 或“发送至 Kindle”服务转换。

文本清洗
修复 PDF 中常见的 UTF-8/Windows-1252 乱码（如 â€™ → '）。

统一智能引号、破折号为 ASCII 字符。

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


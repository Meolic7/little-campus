# 拾光校园 Android / Pixel Campus Android

独立 Android 应用：无需运行电脑端 Python 服务。支持简体中文、English、跟随系统；AI 总结和任务建议采用所选语言，原始课程、任务及转录文本不会被自动翻译。

## 安装与使用

编译后的测试 APK 位于 `releases/pixel-campus-debug.apk`（成功构建后生成）。复制到 Android 手机安装，首次录音时允许麦克风权限。

本次已生成并验证测试 APK，支持 Android 6.0+；建议更新 Android System WebView。校验值见 `releases/SHA256SUMS.txt`，自动化测试与真实设备验证边界见 [VERIFICATION.md](VERIFICATION.md)。

1. 在右上角 **设置 / Settings** 选择语言。
2. 在模型连接中分别配置语言、视觉和语音服务的 HTTPS 地址、模型名称、API Key；点击保存或“保存并测试”。Base URL 可以以 `/v1` 结尾。
3. 语言/视觉使用兼容的 `POST /v1/chat/completions`；语音使用 `POST /v1/audio/transcriptions`，接受 multipart 文件并返回 `{ "text": "..." }`。服务必须支持这些协议；接口调用由你自己的账号计费。
4. 无模型配置时仍可使用手动课表、待办、番茄钟和手动课堂笔记。

## 功能边界

- **课表**：周次与单双周、手动增删改、冲突提示；HTML/TXT/图片/PDF 导入后编辑确认。课表文件上限 10 MB、PDF 最多 10 页。PDF 会渲染为图片以保留列布局，需要视觉模型。HTML 不执行脚本、不加载外部图片。
- **任务**：优先级、截止日期、备注、完成状态；AI 拆解或总结中的候选任务编辑确认后才加入列表。
- **专注**：自定义专注/休息时长，暂停和重启恢复，完成一轮种一棵像素树；下一阶段手动开始。没有后台/锁屏响铃服务。
- **课堂**：Android 原生 PCM 录音，按停顿或最长 12 秒切段；先保存 WAV，再串行调用云端 ASR。网络慢时排队，失败片段可重试、回听。切到后台或锁屏会停止录音并保存尾段；最多连续录制 4 小时。系统强制终止时可恢复已提交的音频块，尚在缓冲区的最后几秒可能丢失。
- **音频导入**：WAV/MP3/M4A/WebM，最多 20 MB。上传文件不在手机转码或拆分，仍受服务商文件格式和大小限制。
- **笔记**：原始转录与编辑稿分开保存；长文本分段总结后归并；分段总结进度保存。音频和整条笔记可以分别删除。
- **本机模型**：Android 版不运行电脑端 faster-whisper；语音采用你配置的云端兼容接口。知识库和研究助手仅显示未来计划。

## 数据与密钥

结构化数据通过 Capacitor Preferences 存放在应用私有目录，录音通过 Filesystem 存为私有 WAV/音频文件。API 设置使用 Android Keystore 的 AES-GCM 加密，不进入普通数据存储。禁用 Android 自动备份和明文 HTTP。

卸载应用会删除本机数据。当前没有跨设备同步、导出或自动备份。网页预览用浏览器存储模拟本机数据；密钥仅在当前页面内存保留，刷新后需重新填写，原生录音需要安装 Android 版。

## 编译

需要 Node.js 20+、JDK 21、Android SDK Platform 35 / Build Tools 35。可通过 Android Studio 安装 SDK；或使用项目根目录 `.tools` 中已下载的工具。

```powershell
cd mobile
npm.cmd ci
.\build-android.ps1
```

脚本会构建网页资源、同步原生插件并编译 debug APK。手动开发：

```powershell
npm.cmd run dev          # 127.0.0.1:5174，浏览器预览
npm.cmd run sync         # 构建并同步 Android 资源
npm.cmd run android      # Android Studio 打开原生工程
npm.cmd test             # 业务与双语契约测试
npm.cmd run test:ui      # 使用本机 Edge 的移动尺寸浏览器测试
```

正式发布使用 `build-android.ps1 -Release`，生成未签名 APK；需自行配置发布签名。测试版不用于应用商店发布。生产 Android 包的 HTTPS 页面和原生 HTTP 桥接支持跨域模型调用；网页预览仍受模型服务 CORS 限制。

## MiMo ASR 配置

使用小米 MiMo 语音识别时，在 Android 设置中填写：

- 服务地址：`https://api.xiaomimimo.com/v1`
- 模型名称：`mimo-v2.5-asr`
- API 密钥：你的 MiMo API 密钥

MiMo ASR 使用 `/v1/chat/completions` 的 `input_audio` JSON 请求，音频格式支持 WAV 和 MP3。Android 端会自动使用该协议；其他服务仍使用 OpenAI 兼容的 `/v1/audio/transcriptions` 接口。

## English

A standalone Android app with Chinese/English UI and AI output selection. It keeps schedules, tasks, focus records and lecture notes on the device; no desktop server is required. Enter your own HTTPS model endpoints in Settings. Android keys use Keystore encryption.

Recording is **foreground only**. Leaving the app stops recording and preserves completed chunks; audio is transcribed through your cloud provider. Uploaded audio is limited to 20 MB. Local desktop ASR is not included. Uninstalling deletes local data.

Build with Node 20+, JDK 21 and Android SDK 35: `npm ci`, then `build-android.ps1`. Install the resulting debug APK from `releases/`. Release APKs require your own signing configuration.

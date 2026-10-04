# EduTrans 学堂译

面向学校、老师与学习场景的**上下文感知双语翻译** Chrome 扩展(MV3)。
对标沉浸式翻译的核心体验;配置保存在本机，无账号、无遥测；使用自定义 AI 或在线引擎时，待译文本发送到对应服务。

## 为什么做这个

- 2025 年 8 月沉浸式翻译"网页快照"事件:用户分享的快照短网址被搜索引擎收录,
  泄露交易与身份信息。闭源 + 云端附加功能 = 不可接受的隐私风险。
- 学校场景的真实需求:术语一致(教材/学科词汇统一)、代码可审计、配置可控,
  以及**不依赖外部服务**的核心翻译能力。

## 特性(v0.3.3)

- **设备端离线翻译(初始默认引擎)**:使用 Chrome 自带本地翻译模型
  (Translator API),首次使用某语言对时由 Chrome 下载语言包,
  之后翻译全部在本机完成,不依赖任何外部服务、无需 API Key、无配额。
- **双语对照 / 仅译文**两种显示模式,视口渐进翻译,长页面不卡顿,Alt+A 一键开关。
- **上下文感知 AI 翻译**:页面标题 + 分句批次 + 术语表一起参与翻译,
  整页人名/地名/术语保持一致。
- **术语表**:每行 `原文 = 译文`;AI 服务严格遵循,免费引擎整词替换。
- **AI 摘要**:Alt+S 或弹窗按钮随时唤起,悬浮面板展示,
  内容只发送给你自己配置的 AI 接口。
- **YouTube 双语字幕(实验)**:弹窗一键开启,拦截字幕轨批量翻译,双语叠加。
- **输入框翻译**:输入框聚焦时出现"翻译"按钮,一键翻译/还原。
- **悬浮翻译**:按住 Ctrl(⌘)悬停段落即可翻译。
- **划词翻译 + 生词本**:气泡翻译、一键收藏、CSV 导出。
- **内置广告拦截(ABP 式)**:EasyList China / EasyList 开源规则,
  本地转换为 Chrome 声明式拦截,不联网更新。
- **未成年人内容过滤**:StevenBlack 开源 hosts,默认拦截成人/赌博站点,可关闭。
- **自定义 OpenAI 兼容服务**:智谱 GLM / DeepSeek / OpenRouter / vLLM / Ollama,
  可添加多个并按角色分配普通、复杂文本；多个 key 共用账户并发上限。简单文本优先设备端，云端漏译会定向补译，再由已就绪的本地模型复译失败项。
- 全部配置保存在本机 `chrome.storage.local`,随扩展卸载一并清除。

## 安装(开发者模式)

1. 克隆或下载本项目
2. 打开 `chrome://extensions`,右上角开启"开发者模式"
3. 点击"加载已解压的扩展程序",选择本项目根目录(含 manifest.json)
4. 首次使用设备端翻译时,Chrome 会提示下载对应语言包(一次性,之后离线可用)

## 快速上手:自定义智谱 GLM 服务(可选的 AI 增强)

1. 注册智谱开放平台 open.bigmodel.cn,在 API Keys 页面创建一个 Key
2. EduTrans 设置页 → 翻译服务 → "+ 添加自定义 AI 翻译服务":
   - 接口地址:`https://open.bigmodel.cn/api/paas/v4`
   - 模型名称:填写该通路支持的模型，例如 `glm-4.5-flash`
   - API Key:粘贴你的 Key(只保存在本机)
3. 点击"测试连接"确认可用 → 保存 → 按需设为默认

> 模型计费以提供方当前说明和你获准的接入通路为准，不要仅凭名称含 Flash 判断免费。Coding Plan 与普通 API 的计费、支持环境和账户额度不同；此扩展不会自动更换通路或启用未分配角色的模型。AI 摘要需要配置一个自定义 AI 服务。

## 术语表示例(老师/学生)

```
alliance = 联盟
deterrence = 威慑
hegemony = 霸权
```

AI 翻译服务会把整张术语表注入系统提示词,并强制整页输出一致;
Google / 微软免费引擎则在译文上做整词替换。

## 广告与内容过滤规则重建

规则已打包在 `filters/` 目录。如需重新生成:

```bash
HTTPS_PROXY=http://127.0.0.1:17890 python3 tools/build_filters.py
```

- 广告:`easylistchina.txt` + `easylist.txt` → `filters/rules_ads.json`
- 未成年人:`StevenBlack gambling-porn hosts` → `filters/rules_adult.json`

## 目录结构

```
edutrans/
├── manifest.json
├── src/
│   ├── lib/        # common(设置模型) / engines(翻译引擎) / i18n(文案)
│   ├── background/ # service-worker:路由、回退、摘要、过滤开关
│   ├── content/    # content.js(页面翻译/划词/悬停/输入框/摘要)
│   │               # youtube.js(双语字幕)
│   ├── options/    # 设置页:服务/基本/过滤/术语表/生词本/隐私
│   └── popup/      # 工具栏弹窗
├── filters/        # 生成的 DNR 规则(勿手改,用 tools 重建)
├── tools/          # build_filters.py
├── gen_icons.py    # 图标生成脚本(纯 Python,无第三方依赖)
├── docs/COMPARISON.md  # 与沉浸式翻译逐项对比
├── PRIVACY.md
└── LICENSE
```

## 使用

- `Alt + A`:翻译 / 恢复当前页面;`Alt + S`:AI 摘要
  (可在 chrome://extensions/shortcuts 修改)
- 右键菜单:翻译选中文本 / 翻译整个页面 / AI 摘要此页面
- 工具栏弹窗:切换引擎与显示模式、本站自动翻译、AI 摘要、YouTube 字幕开关

## 局限与 Roadmap

免费引擎为逐句直翻;设备端引擎质量取决于 Chrome 本地模型;
追求整页一致与最佳质量请配置 AI 服务。欢迎 PR。

- [ ] PDF / EPUB 翻译
- [ ] 漫画/图片翻译
- [ ] 悬浮球
- [ ] 设置导入/导出
- [ ] 翻译记忆 / 双语对照导出

## License

MIT,见 LICENSE。

## 0.3.3 完整性与速度

优先翻译当前可见段落，提前处理下方 1500 像素；长段按句保序拆分，每块最多 280 字符，每请求最多 4 项 / 900 字符。通过检查的批次先显示，并标明“本段尚未完成”；全部成功才计入完成。普通英文词残留、明确的比较方向反转、空项、类型或数量错误、截断会触发一次批量补译。持续失败会显示原因和“重试本段”，保留已经通过检查的部分，不重翻已完成段落。完整性检测属于启发式检查，无法保证每个译文的语义质量。

GLM 翻译默认关闭混合深度思考，并使用原生 JSON 对象输出及逐句编号，拒绝缺项和位置不明的回复。正文和标题优先于导航、侧栏、作者简介等内容；云端请求默认错开 180 毫秒启动，共用账户队列，客户端默认上限 2；这不是官方保证的并发额度。429 会降低并发、增加请求间隔并尊重 Retry-After，503 会降低并发，连续成功后逐步恢复到配置上限。密钥失效暂时停用该 key，多个 key 不叠加同一账户的配额。默认单次网络 20 秒、排队及重试总等待 30 秒，停止按标签页和本轮翻译取消请求。标题、复杂句和术语内容用云端；简单内容在本地模型已就绪时独立处理，本地漏词会发给当前云端服务补译；云端质量补译仍失败时，已就绪的本地模型仅复译失败项，保留合格的邻句，并重新检查结果。未下载本地语言包时不会让自动分流等待下载。

设置页可以录入多个 key、同账户分组和模型角色：普通文本 / 复杂文本 / 通用。只有明确分配角色且同账户组的服务参与自动选择；手动选择某个服务会遵守该选择。配置获准的 Base URL 和模型后才会启用对应通路，不会将现有免费 API 自动切换成 Coding Plan 或其他收费服务。

[智谱当前 Coding Plan 使用说明](https://docs.bigmodel.cn/cn/coding-plan/usage-notes)规定并发随套餐和负载调整，没有固定“每 key”额度。请按你获准的通路设置接口、模型和账户组；不要把客户端上限当作服务方配额。

Coding Plan 标准 OpenAI Chat Completion 端点为 `https://open.bigmodel.cn/api/coding/paas/v4`，与普通 API 的 `/api/paas/v4` 不同。按用户要求接入时，先验证该通路上的密钥和两个明确模型名称，再分配 `glm-5.3-flash` 为普通文本角色、`glm-5.3` 为复杂文本与复审角色，共用一个账户组。不要将旧别名被映射的响应算作不同模型；界面记录服务实际返回的模型名。配置和密钥只保存本机，下载包不含接入密钥。

带重音符号的拉丁姓名按完整 Unicode 词识别，例如 Jędrzej 不会被拆成 drzej。简单内容逐条校验和显示，单项需要云端补译时只把该项放入云端队列，不影响其他本地结果。带转述的新闻摘要使用云端模型，明确的季节信息也参与完整性检查。隐藏菜单及包含子段落的父级容器不重复收集。网站页头、导航和菜单保持原有布局，不插入段落译文；文章内的标题仍参与翻译。

[官方快速开始](https://docs.bigmodel.cn/cn/coding-plan/quick-start)及[模型切换说明](https://docs.bigmodel.cn/cn/coding-plan/latest-model)用于核对协议、端点和可用模型；套餐适用环境以官方说明和你获准的通路为准。

本地回归（模拟响应，不联网、不需要 API Key）：

```sh
node --test tests/pipeline.test.mjs tests/translation.contract.test.mjs
node tests/engines.smoke.full.js
node tests/split.smoke.full.js
node tests/options.smoke.js
node tests/content.load.js
```

真实 Chrome 页面、真实接口延迟与模拟多模型/多 key 场景的验收分别记录在交付的验收 JSON。下载包不含私人配置链接或 API Key；现有浏览器里的服务配置保留。


## 下载与分发

[GitHub Releases](https://github.com/morningwind128/edutrans/releases) 提供签名 CRX3 和 ZIP。公开源码和包不含 API Key、私人配置、浏览器数据或签名私钥。

CRX 是签名分发包；普通 Chrome 在 Windows/macOS 上可能限制商店外 CRX 安装。没有企业策略或商店安装通路时，请下载 ZIP 并解压，在 `chrome://extensions` 开启“开发者模式”，选择“加载已解压的扩展程序”并选中含 `manifest.json` 的目录。不要修改 Chrome 安全策略。

首次安装默认使用设备端翻译。需要云端翻译时，在设置页填写自己的接口和令牌；令牌仅保存在本机。

Chrome 网上应用店上传请使用 `edutrans-0.3.3-webstore.zip`（manifest 位于 ZIP 根目录），并填写开发者后台的隐私/权限用途声明；GitHub 发布不等于已经通过应用店审核。

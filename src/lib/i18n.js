// EduTrans UI strings (Simplified Chinese).
(function (global) {
  'use strict';
  global.EduTransI18n = {
    appName: 'EduTrans 学堂译',
    bg: {
      menuSelection: '翻译选中的文本',
      menuPage: '翻译 / 恢复此页面',
      menuSummary: 'AI 摘要此页面'
    },
    content: {
      translateBtn: '翻译',
      translating: '翻译中…',
      failed: '翻译失败',
      retry: '重试',
      fellBack: '默认引擎不可用,已自动切换:',
      collect: '收藏生词',
      collected: '已收藏',
      copy: '复制',
      copied: '已复制',
      blacklist: '此站点在黑名单中,可在设置中移除',
      summaryTitle: 'AI 摘要',
      summarizing: '正在生成摘要…',
      noAi: '未配置 AI 服务:请先在设置中添加自定义 AI 翻译服务(如智谱 GLM)',
      noText: '本页没有可摘要的正文',
      inputRestore: '原',
      deviceOld: '此 Chrome 版本不支持设备端翻译(需要 138+)',
      devicePair: '设备端暂不支持该语言对,可改用其他翻译服务',
      deviceDownload: '离线语言包首次使用需下载,请稍候…',
      ytNoTrack: '未找到可翻译的字幕轨道',
      ytLoading: '字幕翻译中'
    },
    popup: {
      enable: '翻译此页',
      disable: '恢复原文',
      engine: '翻译服务',
      mode: '显示模式',
      bilingual: '双语对照',
      translation: '仅译文',
      settings: '设置',
      vocab: '生词本',
      siteAuto: '本站自动翻译',
      summarize: 'AI 摘要',
      ytSubs: '翻译字幕',
      ytSubsOff: '关闭字幕',
      reloadNeeded: '请刷新页面后重试',
      deviceEngine: '设备端翻译(离线)',
      googleEngine: 'Google 免费翻译',
      msEngine: '微软免费翻译',
      tagAI: '大模型'
    },
    options: {
      engineDevice: '设备端翻译',
      engineGoogle: '谷歌翻译',
      engineMs: '微软翻译',
      tagOffline: '离线免费',
      tagFree: '免费',
      tagAI: '大模型',
      tagDefault: '当前默认',
      autoSaved: '已自动保存',
      edit: '编辑',
      del: '删除',
      delConfirm: '确定删除这个翻译服务吗?',
      needUrl: '请填写接口地址',
      testing: '测试中…',
      testOk: '连接成功,译文:',
      testFail: '连接失败:',
      saved: '已保存',
      vocabEmpty: '生词本还是空的。划词翻译后点击"收藏生词"即可加入。',
      vocabClearConfirm: '确定清空生词本吗?',
      cfgImported: '配置已导入并生效'
    }
  };
})(typeof self !== 'undefined' ? self : this);

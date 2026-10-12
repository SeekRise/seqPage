/**
 * 首次启动的演示数据。
 *
 * 结构说明：
 * - 这里只声明「蓝图」（页面 → 分区 → 网站），运行时会转换成带 ID 与 order 的实体。
 * - 安全设备分区使用通用产品名称 + 示例地址，便于用户理解结构后自行替换；
 *   演示数据中不包含任何真实设备地址、账号或凭据。
 * - 用户已有配置时不会覆盖，详见 services/navigation.ts 的 ensureInitialized。
 */
import type { IconType } from '@/types';

export interface DemoWebsiteBlueprint {
  name: string;
  url: string;
  description: string;
  favorite?: boolean;
  iconType?: IconType;
  icon?: string;
}

export interface DemoSectionBlueprint {
  name: string;
  icon: string;
  color: string;
  websites: DemoWebsiteBlueprint[];
}

export interface DemoPageBlueprint {
  name: string;
  icon: string;
  sections: DemoSectionBlueprint[];
}

export const DEMO_BLUEPRINT: readonly DemoPageBlueprint[] = [
  {
    name: '工作台',
    icon: 'briefcase',
    sections: [
      {
        name: '常用网站',
        icon: 'star',
        color: '#3B6FE0',
        websites: [
          {
            name: 'Google',
            url: 'https://www.google.com/',
            description: '全球通用搜索引擎',
            favorite: true,
          },
          {
            name: 'Bing',
            url: 'https://www.bing.com/',
            description: '微软搜索引擎，国内可直连',
          },
          {
            name: '百度',
            url: 'https://www.baidu.com/',
            description: '中文搜索引擎',
          },
          {
            name: 'DuckDuckGo',
            url: 'https://duckduckgo.com/',
            description: '不追踪用户的搜索引擎',
          },
          {
            name: 'GitHub',
            url: 'https://github.com/',
            description: '代码托管与开源协作平台',
            favorite: true,
          },
        ],
      },
      {
        name: '办公协作',
        icon: 'users',
        color: '#1E9E5A',
        websites: [
          {
            name: '飞书',
            url: 'https://www.feishu.cn/',
            description: '团队协作与文档',
          },
          {
            name: '腾讯文档',
            url: 'https://docs.qq.com/',
            description: '在线文档与表格',
          },
          {
            name: 'WPS 云文档',
            url: 'https://www.kdocs.cn/',
            description: '在线 Office 文档',
          },
          {
            name: '石墨文档',
            url: 'https://shimo.im/',
            description: '轻量在线协作文档',
          },
        ],
      },
      {
        name: '信息查询',
        icon: 'search',
        color: '#0E7490',
        websites: [
          {
            name: '知乎',
            url: 'https://www.zhihu.com/',
            description: '中文问答社区',
          },
          {
            name: '维基百科',
            url: 'https://zh.wikipedia.org/',
            description: '自由的百科全书',
          },
          {
            name: '中国天气网',
            url: 'https://www.weather.com.cn/',
            description: '按需手动查看，扩展不采集地理位置',
          },
        ],
      },
    ],
  },
  {
    name: '开发工具',
    icon: 'code',
    sections: [
      {
        name: '开发环境',
        icon: 'terminal',
        color: '#4F46E5',
        websites: [
          {
            name: 'Visual Studio Code',
            url: 'https://code.visualstudio.com/',
            description: 'VS Code 官方网站与下载',
            favorite: true,
          },
          {
            name: 'Docker',
            url: 'https://www.docker.com/',
            description: '容器平台官网',
          },
          {
            name: 'Docker Hub',
            url: 'https://hub.docker.com/',
            description: '镜像仓库',
          },
          {
            name: 'Node.js',
            url: 'https://nodejs.org/',
            description: 'Node.js 官方网站',
          },
        ],
      },
      {
        name: '代码托管',
        icon: 'code',
        color: '#2F6FEB',
        websites: [
          {
            name: 'GitHub',
            url: 'https://github.com/',
            description: '全球最大代码托管平台',
            favorite: true,
          },
          {
            name: 'Gitee 码云',
            url: 'https://gitee.com/',
            description: '国内代码托管平台',
          },
          {
            name: 'GitLab',
            url: 'https://gitlab.com/',
            description: 'DevOps 一体化平台',
          },
        ],
      },
      {
        name: 'API 调试',
        icon: 'activity',
        color: '#E08A1E',
        websites: [
          {
            name: 'Postman',
            url: 'https://www.postman.com/',
            description: 'API 调试与协作',
          },
          {
            name: 'Apifox',
            url: 'https://apifox.com/',
            description: 'API 设计、调试、Mock 一体化',
          },
          {
            name: 'Swagger Editor',
            url: 'https://editor.swagger.io/',
            description: '在线 OpenAPI 编辑与预览',
          },
          {
            name: 'JSON 格式化',
            url: 'https://www.json.cn/',
            description: 'JSON 在线校验与格式化',
          },
        ],
      },
      {
        // 与「AI 工具」合并为一个分区：每页最多 4 个分区（CREATION_LIMITS），
        // 演示数据本身要示范这个上限，不能自己先超
        name: '文档与 AI',
        icon: 'book',
        color: '#8E5BD9',
        websites: [
          {
            name: 'MDN Web Docs',
            url: 'https://developer.mozilla.org/zh-CN/',
            description: 'Web 技术权威文档',
            favorite: true,
          },
          {
            name: 'Vue 3 文档',
            url: 'https://cn.vuejs.org/',
            description: 'Vue 3 官方中文文档',
          },
          {
            name: 'Vite 文档',
            url: 'https://cn.vitejs.dev/',
            description: 'Vite 官方中文文档',
          },
          {
            name: 'DevDocs',
            url: 'https://devdocs.io/',
            description: '多语言文档聚合查询',
          },
          {
            name: '语雀',
            url: 'https://www.yuque.com/',
            description: '知识库与笔记',
          },
          {
            name: 'ChatGPT',
            url: 'https://chatgpt.com/',
            description: 'AI 对话助手',
          },
          {
            name: 'Claude',
            url: 'https://claude.ai/',
            description: 'Anthropic AI 助手',
          },
          {
            name: 'DeepSeek',
            url: 'https://www.deepseek.com/',
            description: 'DeepSeek 官方站点',
          },
        ],
      },
    ],
  },
  {
    name: '安全运营',
    icon: 'shield',
    sections: [
      {
        name: '安全设备',
        icon: 'server',
        color: '#D9534F',
        websites: [
          {
            name: 'WAF 管理控制台',
            url: 'https://waf.example.com/',
            description: '示例地址，请替换为内部 Web 应用防火墙控制台',
          },
          {
            name: 'TDP 威胁检测平台',
            url: 'https://tdp.example.com/',
            description: '示例地址，请替换为内部流量检测平台地址',
          },
          {
            name: 'HIDS 主机入侵检测',
            url: 'https://hids.example.com/',
            description: '示例地址，请替换为主机安全控制台地址',
          },
          {
            name: '堡垒机',
            url: 'https://jumpserver.example.com/',
            description: '示例地址，请替换为运维审计系统地址',
          },
        ],
      },
      {
        name: '威胁情报',
        icon: 'globe',
        color: '#E08A1E',
        websites: [
          {
            name: 'VirusTotal',
            url: 'https://www.virustotal.com/',
            description: '文件与 URL 多引擎检测',
            favorite: true,
          },
          {
            name: '微步在线情报社区',
            url: 'https://x.threatbook.com/',
            description: 'IP / 域名 / 样本情报查询',
          },
          {
            name: '奇安信威胁情报中心',
            url: 'https://ti.qianxin.com/',
            description: '威胁情报查询与报告',
          },
          {
            name: 'MITRE ATT&CK',
            url: 'https://attack.mitre.org/',
            description: '攻击技战术知识库',
          },
          {
            name: 'Shodan',
            url: 'https://www.shodan.io/',
            description: '互联网设备搜索引擎',
          },
        ],
      },
      {
        name: '资产管理',
        icon: 'database',
        color: '#0E7490',
        websites: [
          {
            name: 'FOFA',
            url: 'https://fofa.info/',
            description: '网络空间资产测绘',
          },
          {
            name: 'Hunter 鹰图平台',
            url: 'https://hunter.qianxin.com/',
            description: '资产测绘与暴露面发现',
          },
          {
            name: 'Censys Search',
            url: 'https://search.censys.io/',
            description: '互联网资产检索',
          },
          {
            name: 'NVD 漏洞库',
            url: 'https://nvd.nist.gov/',
            description: '美国国家漏洞数据库',
          },
          {
            name: 'CNNVD',
            url: 'https://www.cnnvd.org.cn/',
            description: '国家信息安全漏洞库',
          },
        ],
      },
      {
        name: '应急响应',
        icon: 'activity',
        color: '#8E5BD9',
        websites: [
          {
            name: 'CISA 已知被利用漏洞目录',
            url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
            description: '在野利用漏洞清单',
          },
          {
            name: '安全客',
            url: 'https://www.anquanke.com/',
            description: '安全资讯与漏洞分析',
          },
          {
            name: 'FreeBuf',
            url: 'https://www.freebuf.com/',
            description: '安全行业资讯',
          },
          {
            name: 'Exploit-DB',
            url: 'https://www.exploit-db.com/',
            description: '公开漏洞利用库',
          },
        ],
      },
    ],
  },
  {
    name: '日常生活',
    icon: 'home',
    sections: [
      {
        name: '视频影音',
        icon: 'video',
        color: '#D9534F',
        websites: [
          {
            name: '哔哩哔哩',
            url: 'https://www.bilibili.com/',
            description: '视频弹幕网站',
            favorite: true,
          },
          {
            name: 'YouTube',
            url: 'https://www.youtube.com/',
            description: '全球视频平台',
          },
          {
            name: '腾讯视频',
            url: 'https://v.qq.com/',
            description: '影视综艺',
          },
          {
            name: '网易云音乐',
            url: 'https://music.163.com/',
            description: '在线音乐',
          },
        ],
      },
      {
        name: '社区资讯',
        icon: 'users',
        color: '#1E9E5A',
        websites: [
          {
            name: '微博',
            url: 'https://weibo.com/',
            description: '社交媒体',
          },
          {
            name: '豆瓣',
            url: 'https://www.douban.com/',
            description: '书影音评分与社区',
          },
          {
            name: 'V2EX',
            url: 'https://www.v2ex.com/',
            description: '开发者社区',
          },
          {
            name: '掘金',
            url: 'https://juejin.cn/',
            description: '技术内容社区',
          },
        ],
      },
      {
        name: '实用工具',
        icon: 'wrench',
        color: '#64748B',
        websites: [
          {
            name: '高德地图',
            url: 'https://www.amap.com/',
            description: '地图与路线规划',
          },
          {
            name: '12306',
            url: 'https://www.12306.cn/',
            description: '铁路客票服务',
          },
          {
            name: '草料二维码',
            url: 'https://cli.im/',
            description: '二维码生成与解析',
          },
          {
            name: 'TinyPNG',
            url: 'https://tinypng.com/',
            description: '图片在线压缩',
          },
        ],
      },
    ],
  },
] as const;

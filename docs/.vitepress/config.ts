import { defineConfig } from 'vitepress'

const pagesBase = process.env.PAGES_BASE_PATH ?? '/neuro-book/'

// 中文（root locale）导航与侧栏
const zhNav = [
  { text: '官网预览', link: '/official/' },
  { text: '文档首页', link: '/' },
  { text: '快速开始', link: '/quick-start' },
  { text: '教程', link: '/tutorials/' },
  { text: '核心能力', link: '/core/world-engine' },
  { text: '部署', link: '/deployment' },
  { text: '更新日志', link: '/changelog/' },
  { text: '理念', link: '/blog-agent-rp-harness' },
  { text: 'Agent', link: '/agent/' },
  { text: 'Profile', link: '/profile/' },
  { text: 'Reference', link: 'https://github.com/JecoShen/NovelBook/blob/main/reference/README.md' },
  { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
]

const zhSidebar = [
  {
    text: '开始使用',
    items: [
      { text: '介绍', link: '/introduction' },
      { text: '快速开始', link: '/quick-start' }
    ]
  },
  {
    text: '基础教程',
    items: [
      { text: '总览', link: '/tutorials/' },
      { text: '开始前检查', link: '/tutorials/00-before-you-start' },
      { text: '认识工作台', link: '/tutorials/01-studio-tour' },
      { text: '创建第一本书', link: '/tutorials/02-first-project' },
      { text: '用 Skill 点燃故事', link: '/tutorials/03-skills-bootstrap' },
      { text: '写出前三章', link: '/tutorials/04-first-three-chapters' },
      { text: '导入角色卡', link: '/tutorials/05-import-character-card' }
    ]
  },
  {
    text: '核心能力',
    items: [
      { text: 'World Engine 世界引擎', link: '/core/world-engine' },
      { text: 'Plot 剧情工坊', link: '/core/plot-workbench' },
      { text: 'Markdown Studio', link: '/core/markdown-studio' },
      { text: 'llmlint 文风检查', link: '/core/llmlint' }
    ]
  },
  {
    text: '使用指南',
    items: [
      { text: '设置中心', link: '/guide/settings' },
      { text: '主题与配色', link: '/guide/theme' },
      { text: '变更与文件历史', link: '/guide/file-history' },
      { text: '账号与云备份', link: '/guide/account' }
    ]
  },
  {
    text: 'Agent',
    items: [
      { text: 'Agent 心智模型', link: '/agent/' },
      { text: '工具', link: '/agent/tools' },
      { text: 'Skill', link: '/agent/skills' },
      { text: 'Workflow 与 Job', link: '/agent/workflow' },
      { text: '三种模式', link: '/agent/modes' },
      { text: 'Agent Harness', link: '/agent/advanced' },
      { text: 'Subject RAG 记忆（历史系统）', link: '/agent/subject-rag-memory' }
    ]
  },
  {
    text: 'Profile',
    items: [
      { text: 'Profile 介绍', link: '/profile/' },
      { text: 'Leader', link: '/profile/leader' },
      { text: 'Writer', link: '/profile/writer' },
      { text: '其他 Profile', link: '/profile/other-profiles' }
    ]
  },
  {
    text: 'Profile TSX',
    items: [
      { text: 'Profile TSX 介绍', link: '/profile-tsx/' },
      { text: '从零写一个 Profile', link: '/profile-tsx/authoring' },
      { text: '节点说明', link: '/profile-tsx/nodes' },
      { text: '示例', link: '/profile-tsx/examples' }
    ]
  },
  {
    text: '部署与运维',
    items: [
      { text: '部署方式', link: '/deployment' },
      { text: '运行、数据与隐私', link: '/operations' },
      { text: '交付与运维桥梁', link: '/operator-bridge' }
    ]
  },
  {
    text: '更新日志',
    items: [
      { text: '历史版本', link: '/changelog/' },
      { text: '0.8.x', link: '/changelog/v0.8' },
      { text: '0.7.x', link: '/changelog/v0.7' },
      { text: '0.5.x', link: '/changelog/v0.5' }
    ]
  },
  {
    text: '设计文章',
    items: [
      { text: 'Agent、创意写作与角色扮演', link: '/blog-agent-rp-harness' }
    ]
  }
]

// 英文 locale 导航与侧栏。链接一律带 /en 前缀，页面文件在 docs/en/ 下同名镜像。
const enNav = [
  { text: 'Website', link: '/official/en/' },
  { text: 'Docs Home', link: '/en/' },
  { text: 'Quick Start', link: '/en/quick-start' },
  { text: 'Tutorials', link: '/en/tutorials/' },
  { text: 'Core', link: '/en/core/world-engine' },
  { text: 'Deployment', link: '/en/deployment' },
  { text: 'Changelog', link: '/en/changelog/' },
  { text: 'Concepts', link: '/en/blog-agent-rp-harness' },
  { text: 'Agent', link: '/en/agent/' },
  { text: 'Profile', link: '/en/profile/' },
  { text: 'Reference', link: 'https://github.com/JecoShen/NovelBook/blob/main/reference/README.md' },
  { text: 'GitHub', link: 'https://github.com/notnotype/neuro-book' }
]

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Introduction', link: '/en/introduction' },
      { text: 'Quick Start', link: '/en/quick-start' }
    ]
  },
  {
    text: 'Tutorials',
    items: [
      { text: 'Overview', link: '/en/tutorials/' },
      { text: 'Before You Start', link: '/en/tutorials/00-before-you-start' },
      { text: 'Tour of the Studio', link: '/en/tutorials/01-studio-tour' },
      { text: 'Create Your First Book', link: '/en/tutorials/02-first-project' },
      { text: 'Ignite the Story with Skills', link: '/en/tutorials/03-skills-bootstrap' },
      { text: 'Write the First Three Chapters', link: '/en/tutorials/04-first-three-chapters' },
      { text: 'Import a Character Card', link: '/en/tutorials/05-import-character-card' }
    ]
  },
  {
    text: 'Core Capabilities',
    items: [
      { text: 'World Engine', link: '/en/core/world-engine' },
      { text: 'Plot Workbench', link: '/en/core/plot-workbench' },
      { text: 'Markdown Studio', link: '/en/core/markdown-studio' },
      { text: 'llmlint Prose Linting', link: '/en/core/llmlint' }
    ]
  },
  {
    text: 'Guides',
    items: [
      { text: 'Settings', link: '/en/guide/settings' },
      { text: 'Themes and Colors', link: '/en/guide/theme' },
      { text: 'Changes and File History', link: '/en/guide/file-history' },
      { text: 'Account and Cloud Backup', link: '/en/guide/account' }
    ]
  },
  {
    text: 'Agent',
    items: [
      { text: 'Mental Model', link: '/en/agent/' },
      { text: 'Tools', link: '/en/agent/tools' },
      { text: 'Skills', link: '/en/agent/skills' },
      { text: 'Workflows and Jobs', link: '/en/agent/workflow' },
      { text: 'Three Modes', link: '/en/agent/modes' },
      { text: 'Agent Harness', link: '/en/agent/advanced' },
      { text: 'Subject RAG Memory (legacy)', link: '/en/agent/subject-rag-memory' }
    ]
  },
  {
    text: 'Profile',
    items: [
      { text: 'What Is a Profile', link: '/en/profile/' },
      { text: 'Leader', link: '/en/profile/leader' },
      { text: 'Writer', link: '/en/profile/writer' },
      { text: 'Other Profiles', link: '/en/profile/other-profiles' }
    ]
  },
  {
    text: 'Profile TSX',
    items: [
      { text: 'Introduction', link: '/en/profile-tsx/' },
      { text: 'Write a Profile from Scratch', link: '/en/profile-tsx/authoring' },
      { text: 'Node Reference', link: '/en/profile-tsx/nodes' },
      { text: 'Examples', link: '/en/profile-tsx/examples' }
    ]
  },
  {
    text: 'Deployment and Operations',
    items: [
      { text: 'Deployment', link: '/en/deployment' },
      { text: 'Running, Data and Privacy', link: '/en/operations' },
      { text: 'Operator Bridge', link: '/en/operator-bridge' }
    ]
  },
  {
    text: 'Release Notes',
    items: [
      { text: 'Release History', link: '/en/changelog/' },
      { text: '0.8.x', link: '/en/changelog/v0.8' },
      { text: '0.7.x', link: '/en/changelog/v0.7' },
      { text: '0.5.x', link: '/en/changelog/v0.5' }
    ]
  },
  {
    text: 'Design Notes',
    items: [
      { text: 'Agents, Creative Writing and Roleplay', link: '/en/blog-agent-rp-harness' }
    ]
  }
]

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: pagesBase,
  title: "NeuroBook",
  srcExclude: [
    'README.md',
    'adr/**',
    'api-examples.md',
    'archived/**',
    'drafts/**',
    'markdown-examples.md',
    'modules/**',
    'research/**',
    'tasks/**',
    'writing-mode-world-engine-practice.md'
  ],
  markdown: {
    config(md) {
      // ```mermaid 代码块渲染成 <Mermaid> 组件（见 .vitepress/theme/Mermaid.vue）。
      // 图源用 encodeURIComponent 塞进属性，避免引号、尖括号和换行破坏 HTML。
      const defaultFence = md.renderer.rules.fence
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        if (token.info.trim().toLowerCase() === 'mermaid') {
          return `<Mermaid code="${encodeURIComponent(token.content)}" />`
        }
        return defaultFence
          ? defaultFence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options)
      }
    }
  },
  vite: {
    plugins: [
      {
        name: 'official-static-index',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = request.url?.split('?', 1)[0]
            // 官网静态页有中英两份，dev server 下都要补 index.html 重定向
            for (const route of [`${pagesBase}official`, `${pagesBase}official/en`]) {
              if (pathname === route || pathname === `${route}/`) {
                response.statusCode = 302
                response.setHeader('Location', `${route}/index.html`)
                response.end()
                return
              }
            }
            next()
          })
        },
      },
    ],
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-Hans',
      description: "NeuroBook：让你写完长篇的创意写作 IDE。世界状态由引擎推算而不是靠模型记忆，伏笔像技术债一样记账追踪，成稿用规则做 lint。作品是本地 Markdown 文件与 SQLite，随时带走。",
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        // 默认主题的界面文案默认是英文，root locale 是中文所以整套覆盖
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        langMenuLabel: '切换语言'
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: "NeuroBook is a creative writing IDE built to help you actually finish a long-form novel. World state is computed by an engine instead of remembered by a model, setups are tracked like technical debt, and finished prose is linted against rules. Your work stays as local Markdown files and SQLite.",
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar
      }
    }
  },
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        locales: {
          // 站点 root locale 是中文，本地搜索的界面文案也要跟着换
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '展开详情',
                resetButtonTitle: '清除查询条件',
                backButtonTitle: '返回',
                noResultsText: '无法找到相关结果',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
              }
            }
          }
        }
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notnotype/neuro-book' }
    ]
  }
})

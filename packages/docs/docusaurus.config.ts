import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'fastworker',
  tagline: 'Opinionated Code, Agnostic Infrastructure',
  favicon: 'img/favicon.svg',

  // Set the production url of your site here
  url: 'https://fastworker.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'playfriendlegends', // Usually your GitHub org/user name.
  projectName: 'fastworker-js', // Usually your repo name.

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/playfriendlegends/fastworker-js/tree/main/packages/docs/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'fastworker',

      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/playfriendlegends/fastworker-js',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/fastworker-js',
          label: 'NPM',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'Architecture',
              to: '/docs/architecture',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/playfriendlegends/fastworker-js',
            },
            {
              label: 'NPM',
              href: 'https://www.npmjs.com/package/fastworker-js',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} fastworker contributors. Licensed under MIT.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'json', 'toml', 'bash'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

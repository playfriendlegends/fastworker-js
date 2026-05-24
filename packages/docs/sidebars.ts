import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'introduction',
        'getting-started',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'routing',
        'rpc',
        'configuration',
      ],
    },
    {
      type: 'category',
      label: 'Architecture & Ops',
      collapsed: false,
      items: [
        'architecture',
        'deployment',
        'skills',
      ],
    },
  ],
};

export default sidebars;

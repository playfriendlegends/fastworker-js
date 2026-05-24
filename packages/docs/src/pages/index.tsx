import React, { useState } from 'react';
import type { JSX } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import styles from './index.module.css';

// SVG Icons for professional look
const IconServer = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
);

const IconZap = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
);

const IconShield = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
);

const IconCpu = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
);

const IconGlobe = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
);

const IconCode = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
);

const IconCopy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
);

const IconCheck = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
);

function InstallBox({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npx create-fastworker@latest');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className={clsx(styles.installBox, className)} 
      onClick={handleCopy}
      title="Click to copy"
    >
      <span className={styles.installPrefix}>$</span>
      <code className={styles.installCommand}>npx create-fastworker@latest</code>
      <div className={clsx(styles.installCopyIcon, copied && styles.copied)}>
        {copied ? <IconCheck /> : <IconCopy />}
      </div>
    </div>
  );
}

function HeroSection() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <div className={styles.heroTextContainer}>
          <div className={styles.badge}>v0.1.6 Released</div>
          <Heading as="h1" className={styles.heroTitle}>
            The ultimate serverless framework for Cloud Backend JS Workers.
          </Heading>
          <p className={styles.heroSubtitle}>
            Fastworker is opinionated in how you write code to keep your team disciplined and your codebase clean.
            Yet, it is 100% agnostic in infrastructure, allowing you to freely switch between Monolith and Microservices, and migrate from Cloudflare Workers to any VPS without rewriting a single line of code.
          </p>
          <div className={styles.buttons}>
            <InstallBox />
            <Link className="button button--secondary button--lg" to="/docs/introduction">
              Read the Documentation
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function ArchitectureSection() {
  return (
    <section className={styles.architectureSection}>
      <div className="container">
        <div className="row">
          <div className="col col--6">
            <Heading as="h2" className={styles.sectionTitle}>Stop juggling repositories.</Heading>
            <p className={styles.sectionDescription}>
              Managing microservices usually means managing EADDRINUSE errors, complex Docker compose files, and sprawling mono/poly-repos. Fastworker eliminates infrastructure overhead. 
            </p>
            <p className={styles.sectionDescription}>
              You write your application in a single repository, grouping business logic into discrete <strong>Modules</strong>. At build time, the Fastworker compiler orchestrates the separation, generating isolated bundles and `wrangler.toml` definitions.
            </p>
          </div>
          <div className="col col--6">
             <div className={styles.archDiagram}>
                <div className={styles.archBox}>Monolith Source (src/modules/*)</div>
                <div className={styles.archArrow}>↓ Compiler ↓</div>
                <div className={styles.archSplit}>
                  <div className={styles.archBoxMini}>Auth Service (Port 8001)</div>
                  <div className={styles.archBoxMini}>Billing Service (Port 8002)</div>
                  <div className={styles.archBoxMini}>User Service (Port 8003)</div>
                </div>
                <div className={styles.archArrow}>↓ Service Bindings / Proxy ↓</div>
                <div className={styles.archBoxMain}>Edge Gateway</div>
             </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RpcSection() {
  return (
    <section className={styles.rpcSection}>
      <div className="container">
        <Heading as="h2" className={clsx(styles.sectionTitle, 'text--center')}>100% Type-Safe Inter-Service RPC</Heading>
        <p className={clsx(styles.sectionDescription, 'text--center', styles.rpcDesc)}>
          No GraphQL. No manual OpenAPI schemas. No string-based fetch calls. Communicate across service boundaries using end-to-end TypeScript safety. Under the hood, Fastworker uses Cloudflare Service Bindings or local HTTP proxies automatically.
        </p>
        
        <div className="row" style={{marginTop: '3rem'}}>
          <div className="col col--6">
            <div className={styles.codeWindow}>
              <div className={styles.codeHeader}>The Old Way (Error-Prone)</div>
              <CodeBlock language="typescript" className={styles.codeBlockOverride}>
{`// Untyped fetch, manual parsing, broken schemas
const res = await fetch('http://billing-service/api/charge', {
  method: 'POST',
  body: JSON.stringify({ userId, amount })
});

const data = await res.json(); // Type is 'any'
if (!data.success) {
  throw new Error('Failed');
}`}
              </CodeBlock>
            </div>
          </div>
          <div className="col col--6">
             <div className={clsx(styles.codeWindow, styles.codeWindowPrimary)}>
              <div className={styles.codeHeaderPrimary}>The Fastworker Way (Type-Safe)</div>
              <CodeBlock language="typescript" className={styles.codeBlockOverride}>
{`import type { FastworkerContext } from 'fastworker-js';

export async function POST(ctx: FastworkerContext) {
  const { userId, amount } = await ctx.req.json();

  // Fully typed RPC. Jumps the network boundary safely.
  const billingRes = await ctx.call('billing', 'charge', { 
    userId, 
    amount 
  });
  
  return Response.json(billingRes);
}`}
              </CodeBlock>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features = [
    {
      title: 'Built for the Edge',
      icon: <IconGlobe />,
      description: 'Strict adherence to WinterCG standards. Your backend code runs natively on Cloudflare Workers, Vercel Edge, or anywhere the standard is supported.'
    },
    {
      title: 'Node.js Auto-Fallback',
      icon: <IconServer />,
      description: 'Local development proxies simulate Edge bindings by spinning up discrete Node.js servers with intelligent port management to avoid EADDRINUSE conflicts.'
    },
    {
      title: 'Zero-Config Routing',
      icon: <IconZap />,
      description: 'Filesystem-based routing automatically translates your folder structure (e.g., modules/users/[id]/api.ts) into optimized regex route tables.'
    },
    {
      title: 'End-to-End Type Safety',
      icon: <IconShield />,
      description: 'Inter-service communication is statically typed. If you change a parameter in the Billing service, the Auth service fails to compile immediately.'
    },
    {
      title: 'Microservices Compiler',
      icon: <IconCpu />,
      description: 'The internal esbuild pipeline generates ultra-lean service workers, stripping away dead code and Node-specific dependencies for edge deployments.'
    },
    {
      title: 'Wrangler Orchestration',
      icon: <IconCode />,
      description: 'Automatically generates wrangler.toml manifests and binds your microservices together. Deployment is a single command without manual configuration.'
    }
  ];

  return (
    <section className={styles.featuresSection}>
      <div className="container">
        <Heading as="h2" className={clsx(styles.sectionTitle, 'text--center')} style={{marginBottom: '4rem'}}>
          Enterprise-Grade Features
        </Heading>
        <div className="row">
          {features.map((f, idx) => (
            <div key={idx} className="col col--4">
              <div className={styles.featureCard}>
                <div className={styles.featureIcon}>{f.icon}</div>
                <Heading as="h3">{f.title}</Heading>
                <p>{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className={styles.ctaSection}>
      <div className="container">
        <div className={styles.ctaCard}>
          <div className={styles.ctaContent}>
            <Heading as="h2" className={styles.ctaTitle}>Ready to build your worker?</Heading>
            <p className={styles.ctaSubtitle}>
              Deploy your first stateless microservice architecture in less than two minutes.
            </p>
            <div className={styles.ctaButtons}>
              <Link className="button button--primary button--lg" to="/docs/introduction">
                Read the Documentation
              </Link>
              <InstallBox className={styles.ctaInstallBox} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - The Framework for JS Workers`}
      description="Opinionated Code, Agnostic Infrastructure. The ultimate serverless framework for Cloud Backend JS Workers.">
      <HeroSection />
      <main>
        <ArchitectureSection />
        <RpcSection />
        <FeatureGrid />
        <CtaSection />
      </main>
    </Layout>
  );
}

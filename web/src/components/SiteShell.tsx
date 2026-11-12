import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import { Tag } from './ui';
import { useReducedMotionVariants } from '../lib/motion';

const links = [
  { href: '#/', label: 'Overview' },
  { href: '#how', label: 'How it works' },
  { href: '#/console', label: 'Console' },
  { href: '#/tests', label: 'Security tests' },
  { href: '#/preferences', label: 'Preferences' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState(typeof window === 'undefined' ? '#/' : window.location.hash || '#/');
  const motionPrefs = useReducedMotionVariants();
  useEffect(() => {
    const update = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const activeHref = hash === '#how' ? '#how' : hash.startsWith('#/console') ? '#/console' : hash.startsWith('#/tests') ? '#/tests' : hash.startsWith('#/preferences') ? '#/preferences' : '#/';
  return <header className="site-header">
    <a className="wordmark" href="#/" aria-label="MandateGuard home"><span>Mandate</span><span>Guard</span></a>
    <nav className="desktop-nav" aria-label="Main navigation">{links.map(link => <a className="desktop-nav-link" aria-current={activeHref === link.href ? 'page' : undefined} key={link.label} href={link.href}>{activeHref === link.href && <motion.span className="nav-highlight" layoutId="navHighlight" transition={motionPrefs.navTransition} aria-hidden="true" />}<span className="nav-label">{link.label}</span></a>)}</nav>
    <div className="header-tools"><Tag variant="sandbox">Sandbox</Tag><a href="#/console" className="button button-primary button-md">Open console</a></div>
    <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Dialog.Trigger asChild><button className="menu-toggle" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}>{menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}</button></Dialog.Trigger>
      <Dialog.Portal forceMount><AnimatePresence initial={false}>{menuOpen && <Dialog.Content forceMount asChild><motion.div key="mobile-navigation" className="mobile-nav" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={motionPrefs.fadeTransition}>
        <Dialog.Title className="visually-hidden">Main navigation</Dialog.Title>
        <nav aria-label="Mobile navigation">{links.map(link => <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)}>{link.label}</a>)}<a href="#/console" className="button button-primary button-md" onClick={() => setMenuOpen(false)}>Open console</a></nav>
      </motion.div></Dialog.Content>}</AnimatePresence></Dialog.Portal>
    </Dialog.Root>
  </header>;
}

export function Footer() {
  return <footer className="site-footer">
    <div className="container footer-content">
      <a className="wordmark" href="#/" aria-label="MandateGuard home"><span>Mandate</span><span>Guard</span></a>
      <nav aria-label="Footer navigation"><a href="#/console">Console</a><a href="#how">How it works</a><a href="#/tests">Security tests</a><a href="https://github.com/AkshatSharma-cs/mandateguard" target="_blank" rel="noopener noreferrer">GitHub</a><span>License MIT</span></nav>
      <p>MandateGuard is an independent hackathon project. It uses the PayPal sandbox and is not affiliated with or endorsed by PayPal.</p>
      <small>(c) 2026 MandateGuard</small>
    </div>
  </footer>;
}

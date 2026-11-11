import { useMemo } from 'react';
import { useReducedMotion, type Variants } from 'motion/react';

export const expoOut = [0.16, 1, 0.3, 1] as const;
export const snappy = [0.2, 0, 0, 1] as const;
export const spring = { type: 'spring', stiffness: 500, damping: 30 } as const;
export const navSpring = spring;

export const heroParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};
export const sectionParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};
export const heroFadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: expoOut } },
};
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: expoOut } },
};

const reducedParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
};
const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

export function useReducedMotionVariants() {
  const prefersReducedMotion = useReducedMotion();
  return useMemo(() => ({
    prefersReducedMotion: Boolean(prefersReducedMotion),
    heroParent: prefersReducedMotion ? reducedParent : heroParent,
    sectionParent: prefersReducedMotion ? reducedParent : sectionParent,
    heroFadeUp: prefersReducedMotion ? reducedFade : heroFadeUp,
    fadeUp: prefersReducedMotion ? reducedFade : fadeUp,
    fadeTransition: { duration: prefersReducedMotion ? 0.15 : 0.3, ease: expoOut },
    carouselTransition: { duration: prefersReducedMotion ? 0.15 : 0.8, ease: expoOut },
    navTransition: prefersReducedMotion ? { duration: 0 } : navSpring,
    sectionViewport: { once: true, amount: 0.3 },
  }), [prefersReducedMotion]);
}

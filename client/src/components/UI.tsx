import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Check, CircleHelp, Info } from 'lucide-react';
import type { DecisionName, MandateStatus } from '../types';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-header-action">{action}</div>}</div>;
}
export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`button button-primary ${props.className ?? ''}`} />; }
export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`button button-secondary ${props.className ?? ''}`} />; }
export function StatusBadge({ status }: { status: DecisionName | MandateStatus | 'SANDBOX' | string }) {
  const normalized = status.toLowerCase();
  const type = status === 'SANDBOX' ? 'info' : normalized.includes('allow') || normalized === 'active' || normalized === 'captured' ? 'success' : normalized.includes('block') || normalized === 'revoked' || normalized === 'expired' ? 'danger' : normalized.includes('review') || normalized.includes('pending') ? 'warning' : 'neutral';
  const Icon = type === 'success' ? Check : type === 'danger' ? AlertCircle : type === 'warning' ? CircleHelp : Info;
  return <span className={`status-badge status-${type}`}><Icon size={14} aria-hidden="true" />{status.replaceAll('_', ' ')}</span>;
}
export function ErrorBanner({ children, title = 'Something needs attention' }: { children: ReactNode; title?: string }) { return <div className="error-banner" role="alert"><AlertCircle size={18} /><div><strong>{title}</strong><div>{children}</div></div></div>; }
export function LoadingState({ label = 'Loading' }: { label?: string }) { return <div className="loading-state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>; }
export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) { return <div className="empty-state">{icon && <div className="empty-icon">{icon}</div>}<h3>{title}</h3>{children && <p>{children}</p>}</div>; }
export function Field({ label, children, hint, id }: { label: string; children: ReactNode; hint?: string; id?: string }) { return <div className="form-field"><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>; }
export function ConfirmDialog({ title, description, onCancel, onConfirm, confirmText = 'Confirm' }: { title: string; description: string; onCancel: () => void; onConfirm: () => void; confirmText?: string }) {
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef(onCancel); cancel.current = onCancel;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable(); if (!elements.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); opener?.focus(); };
  }, []);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="confirm-dialog" tabIndex={-1}><h2 id="dialog-title">{title}</h2><p>{description}</p><div className="dialog-actions"><SecondaryButton onClick={onCancel}>Cancel</SecondaryButton><PrimaryButton onClick={onConfirm}>{confirmText}</PrimaryButton></div></section></div>;
}
export function Money({ cents, currency = 'USD' }: { cents: number; currency?: string }) { return <>{new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)}</>; }

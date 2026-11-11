import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { AlertCircle, Ban, Check, Copy as CopyIcon, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger-outline' | 'on-dark';
type ButtonSize = 'sm' | 'md' | 'lg';
export function Button({ variant = 'primary', size = 'md', className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={clsx('button', `button-${variant}`, `button-${size}`, className)} {...props}>{children}</button>;
}

export function Tag({ variant = 'neutral', children, className }: { variant?: 'neutral' | 'brand' | 'sandbox'; children: ReactNode; className?: string }) {
  return <span className={clsx('tag', `tag-${variant}`, className)}>{children}</span>;
}

export function StatusPill({ status }: { status: 'ALLOW' | 'REVIEW' | 'BLOCK' }) {
  const config = {
    ALLOW: { label: 'Allowed', Icon: Check, className: 'status-allow' },
    REVIEW: { label: 'Needs review', Icon: TriangleAlert, className: 'status-review' },
    BLOCK: { label: 'Blocked', Icon: Ban, className: 'status-block' },
  }[status];
  return <span className={clsx('status-pill', config.className)}><config.Icon size={16} aria-hidden="true" />{config.label}</span>;
}

export function SourceTag({ children }: { children: 'Rule' | 'AI' }) { return <span className="source-tag">{children}</span>; }

export function Panel({ title, action, children, className, headingLevel = 3 }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <section className={clsx('panel', className)}>{(title || action) && <header className="panel-header">{title && <Heading>{title}</Heading>}{action}</header>}{children}</section>;
}

export function Input({ label, error, className, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const inputId = id ?? props.name;
  return <div className="field"><label className="label" htmlFor={inputId}>{label}</label><input id={inputId} className={clsx('form-control', error && 'has-error', className)} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />{error && <span id={`${inputId}-error`} className="field-error"><CircleError />{error}</span>}</div>;
}

export function Textarea({ label, error, className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const inputId = id ?? props.name;
  return <div className="field"><label className="label" htmlFor={inputId}>{label}</label><textarea id={inputId} className={clsx('form-control', error && 'has-error', className)} aria-invalid={!!error} aria-describedby={error ? `${inputId}-error` : undefined} {...props} />{error && <span id={`${inputId}-error`} className="field-error"><CircleError />{error}</span>}</div>;
}
function CircleError() { return <AlertCircle size={16} aria-hidden="true" />; }

export function KeyValueList({ rows }: { rows: Array<{ label: ReactNode; value: ReactNode }> }) {
  return <dl className="kv-list">{rows.map((row, index) => <div className="kv-row" key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}

export function Money({ cents, currency = 'USD' }: { cents: number; currency?: string }) {
  return <span className="money">{new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)}</span>;
}

export function Mono({ children, copyable = false, label = 'Copy' }: { children: ReactNode; copyable?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(String(children));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return <span className="mono-copy"><span className="mono">{children}</span>{copyable && <button className="copy-button" type="button" aria-label={label} onClick={() => void copy()} title={copied ? 'Copied' : label}><CopyIcon size={16} aria-hidden="true" /></button>}</span>;
}

export function EmptyState({ sentence, hint }: { sentence: string; hint?: string }) {
  return <div className="empty-state"><p>{sentence}</p>{hint && <p className="hint">{hint}</p>}</div>;
}

export function Table({ children, className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={clsx('data-table', className)} {...props}>{children}</table>;
}
export function TableHeader({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) { return <th className={className} {...props}>{children}</th>; }
export function TableCell({ children, numeric, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) { return <td className={clsx(numeric && 'numeric', className)} {...props}>{children}</td>; }

export function Skeleton({ width = '100%', height = 16, label = 'Loading' }: { width?: string; height?: number; label?: string }) {
  return <span className="skeleton" role="status" aria-label={label} style={{ width, height }} />;
}

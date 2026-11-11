export function BrandMark({ small = false }: { small?: boolean }) {
  return <svg aria-hidden="true" width={small ? 28 : 34} height={small ? 28 : 34} viewBox="0 0 40 40" fill="none">
    <path d="M20 3.5 34 9v9.2c0 8.3-5.6 14.8-14 18.3C11.6 33 6 26.5 6 18.2V9l14-5.5Z" fill="#002994" />
    <path d="m13 20 4.4 4.2L27.5 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
export function BrandLockup() { return <div className="brand-lockup"><BrandMark /><span>Mandate<span className="brand-guard">Guard</span></span></div>; }

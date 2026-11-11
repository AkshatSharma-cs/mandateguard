import { marketplaceSearches } from '../lib/marketplaces';

export default function MarketplaceLinks({ title }: { title: string }) {
  return <nav className="marketplace-links" aria-label={`Search marketplaces for ${title}`}>
    {marketplaceSearches(title).map(({ name, href }) => <a key={name} href={href} target="_blank" rel="noreferrer">{name}</a>)}
  </nav>;
}

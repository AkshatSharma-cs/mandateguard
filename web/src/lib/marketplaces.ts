export type MarketplaceSearch = { name: string; href: string };

export function marketplaceSearches(title: string): MarketplaceSearch[] {
  const query = encodeURIComponent(title);
  return [
    { name: 'Amazon', href: `https://www.amazon.com/s?k=${query}` },
    { name: 'Walmart', href: `https://www.walmart.com/search?q=${query}` },
    { name: 'Target', href: `https://www.target.com/s?searchTerm=${query}` },
    { name: 'Best Buy', href: `https://www.bestbuy.com/site/searchpage.jsp?st=${query}` },
    { name: 'eBay', href: `https://www.ebay.com/sch/i.html?_nkw=${query}` },
  ];
}

export const JOINED_ROUTE_KEYS = Object.freeze(['volume_joined','volume_joined_size','volume_joined_resolution','volume_joined_budget','volume_joined_wall','volume_joined_bounds']);

export function joinedRouteParams(location) {
  const result=new URLSearchParams(location.search);
  for(const [key,value] of new URLSearchParams(location.hash.replace(/^#/,''))) {
    if(JOINED_ROUTE_KEYS.includes(key))result.set(key,value);
  }
  return new URLSearchParams([...result].filter(([key])=>JOINED_ROUTE_KEYS.includes(key)));
}

export function writeJoinedRoute(href, values) {
  const url=new URL(href), hash=new URLSearchParams(url.hash.slice(1));
  for(const key of JOINED_ROUTE_KEYS) {
    hash.delete(key);
    if(values[key]!==undefined)url.searchParams.set(key,String(values[key]));
  }
  url.hash=hash.toString();
  return url.href;
}

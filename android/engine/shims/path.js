export const join = (...p) => p.join('/').replace(/\/+/g, '/');
export const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
export const resolve = (p) => p;
